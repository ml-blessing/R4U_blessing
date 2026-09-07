"""
kyc_ocr.py - Resilient Multi-Format KYC Document Extraction & RAG Verification Engine
Supports:
  - Images: JPG, JPEG, PNG, WEBP, BMP, TIFF
  - PDFs: DigiLocker PDFs (digital text extraction), Scanned/rasterized PDFs (page rendering + OCR)
  - Engines: EasyOCR (with CPU/GPU auto-detection) + Fallback to PyTesseract
  - RBI OVD: Aadhaar, PAN Card, Passport, Driving Licence, Voter ID, Deemed OVD (Utility Bills)
  - Verification: Name token matching, DOB multi-format alignment, Document ID cross-check, PIN code matching
"""
import os
import re
import csv
import io
import uuid
import json
import logging
import threading
from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple

logger = logging.getLogger("kyc_ocr")
logger.setLevel(logging.INFO)

# Thread synchronization
_ocr_reader = None
_ocr_lock = threading.Lock()
_csv_lock = threading.Lock()

KYC_CSV_PATH = os.path.abspath("./csv_data/kyc_data.csv")
KYC_CSV_HEADERS = [
    "kyc_id", "application_id", "submitted_by", "submitted_at",
    "document_type", "extracted_name", "extracted_dob",
    "extracted_doc_number", "extracted_address", "extracted_gender",
    "raw_ocr_text", "kyc_status", "verification_notes", "match_score"
]

def _ensure_kyc_csv():
    os.makedirs(os.path.dirname(KYC_CSV_PATH), exist_ok=True)
    with _csv_lock:
        if not os.path.exists(KYC_CSV_PATH):
            with open(KYC_CSV_PATH, mode="w", newline="", encoding="utf-8-sig") as f:
                csv.writer(f).writerow(KYC_CSV_HEADERS)

def get_ocr_reader():
    """Lazily load EasyOCR Reader with safe GPU/CPU fallback and error isolation."""
    global _ocr_reader
    with _ocr_lock:
        if _ocr_reader is None:
            import easyocr
            use_gpu = False
            try:
                import torch
                use_gpu = torch.cuda.is_available()
            except Exception:
                use_gpu = False

            try:
                _ocr_reader = easyocr.Reader(['en'], gpu=use_gpu, verbose=False)
            except Exception as e:
                logger.warning(f"EasyOCR init with gpu={use_gpu} failed: {e}. Falling back to CPU.")
                _ocr_reader = easyocr.Reader(['en'], gpu=False, verbose=False)
    return _ocr_reader


# ==============================================================================
# DOCUMENT INGESTION & TEXT EXTRACTION (PDF + IMAGE)
# ==============================================================================

def extract_text_from_document(file_bytes: bytes, filename: str = "") -> str:
    """
    Extracts text from any supported document (PDF or Image).
    - If PDF: extracts native digital text first (instant for DigiLocker).
      If digital text is absent/scanned, renders pages to images and runs OCR.
    - If Image: runs OCR with dual-stage OpenCV / PIL fallback and auto-scaling.
    """
    if not file_bytes:
        return ""

    is_pdf = file_bytes.startswith(b"%PDF") or filename.lower().endswith(".pdf")

    if is_pdf:
        return _extract_from_pdf(file_bytes)
    else:
        return _extract_from_image(file_bytes)


def _extract_from_pdf(pdf_bytes: bytes) -> str:
    """Extracts text from PDF bytes via PyMuPDF (fitz), with OCR fallback for raster pages."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        text_chunks = []
        num_pages = min(len(doc), 6)  # Process up to first 6 pages

        for page_idx in range(num_pages):
            page = doc[page_idx]
            page_text = page.get_text("text").strip()

            if len(page_text) >= 40:
                # Page contains rich digital text (e.g. DigiLocker PDF)
                text_chunks.append(page_text)
            else:
                # Scanned or image-based PDF page -> Render to image and OCR
                try:
                    pix = page.get_pixmap(dpi=150)
                    img_png = pix.tobytes("png")
                    ocr_text = _extract_from_image(img_png)
                    if ocr_text.strip():
                        text_chunks.append(ocr_text)
                except Exception as render_err:
                    logger.warning(f"Failed to render PDF page {page_idx} for OCR: {render_err}")

        doc.close()
        return "\n\n".join(text_chunks).strip()
    except Exception as e:
        logger.error(f"PyMuPDF failed to process PDF: {e}")
        # Try fallback to image decoding if fitz fails
        return _extract_from_image(pdf_bytes)


def _extract_from_image(image_bytes: bytes) -> str:
    """
    Decodes an image using OpenCV (or PIL fallback), auto-resizes to prevent OOM,
    and runs EasyOCR (with PyTesseract fallback).
    """
    img = None
    try:
        import numpy as np
        import cv2
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as cv_err:
        logger.debug(f"OpenCV decode error: {cv_err}")

    # Fallback to PIL if OpenCV decode returned None
    if img is None:
        try:
            from PIL import Image
            import numpy as np
            pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            img = np.array(pil_img)
        except Exception as pil_err:
            logger.error(f"Image decode failed with both OpenCV and PIL: {pil_err}")
            return ""

    # Downscale excessive resolutions (e.g. 4K phone photos) to max 1800px to maintain fast OCR & low memory
    try:
        import cv2
        h, w = img.shape[:2]
        max_dim = 1800
        if max(h, w) > max_dim:
            scale = max_dim / float(max(h, w))
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    except Exception:
        pass

    # Primary OCR: EasyOCR
    try:
        reader = get_ocr_reader()
        results = reader.readtext(img, detail=0, paragraph=True)
        ocr_text = "\n".join(results).strip()
        if ocr_text:
            return ocr_text
    except Exception as easyocr_err:
        logger.warning(f"EasyOCR failed during text recognition: {easyocr_err}")

    # Secondary OCR: PyTesseract fallback
    try:
        import pytesseract
        from PIL import Image
        pil_img = Image.open(io.BytesIO(image_bytes))
        tess_text = pytesseract.image_to_string(pil_img).strip()
        if tess_text:
            return tess_text
    except Exception:
        pass

    return ""


# ==============================================================================
# ROBUST REGEX FIELD PARSERS
# ==============================================================================

EXCLUDED_NAME_WORDS = {
    "government", "govt", "india", "income", "tax", "department", "unique",
    "identification", "authority", "card", "account", "number", "permanent",
    "signature", "male", "female", "transgender", "date", "birth", "republic",
    "passport", "election", "commission", "driving", "licence", "license",
    "father", "mother", "husband", "wife", "address", "holder", "elector", "ovd"
}

def _find_name(text: str, doc_type: str = "") -> str:
    """Extract applicant name handling uppercase names, multilingual headers, and OVD layouts."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    # 1. Explicit labels: "Name: John Doe", "Name / नाम: John Doe"
    explicit_patterns = [
        r"(?:(?:Elector'?s|Holder'?s|Applicant'?s)?\s*Name|नाम)\s*[:\-\.]+\s*([A-Za-z\s\.]{3,40})",
        r"(?:Given\s*Name\(s\)|Given\s*Name)\s*[:\-\.]+\s*([A-Za-z\s\.]{3,40})",
    ]
    for p in explicit_patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            cand = m.group(1).strip()
            # Verify candidate doesn't match excluded stop words
            cand_words = set(cand.lower().split())
            if not cand_words.intersection(EXCLUDED_NAME_WORDS) and len(cand) >= 3:
                return cand.title()

    # 2. PAN Card specific: Name is typically the line directly above "Father's Name"
    # or the line below "INCOME TAX DEPARTMENT / GOVT. OF INDIA"
    if "pan" in (doc_type or "").lower():
        for i, line in enumerate(lines):
            if re.search(r"father'?s?\s*name", line, re.IGNORECASE) and i > 0:
                candidate = lines[i - 1].strip()
                words = candidate.split()
                if 2 <= len(words) <= 4 and all(w.isalpha() for w in words):
                    if not set(candidate.lower().split()).intersection(EXCLUDED_NAME_WORDS):
                        return candidate.title()

    # 3. Line-by-line heuristic: Find 2-4 word alphabetic line that is NOT a header/stop-word
    for line in lines:
        cleaned = re.sub(r"[^A-Za-z\s]", "", line).strip()
        words = cleaned.split()
        if 2 <= len(words) <= 4:
            word_set = set(w.lower() for w in words)
            if not word_set.intersection(EXCLUDED_NAME_WORDS) and all(len(w) >= 2 for w in words):
                return cleaned.title()

    return ""


def _find_dob(text: str) -> str:
    """Extracts Date of Birth or Year of Birth in multiple formats."""
    # 1. Labelled DOB patterns (highest confidence)
    labeled_patterns = [
        r"(?:DOB|Date\s*of\s*Birth|D\.O\.B|Birth\s*Date)\s*[:\-\.]*\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})",
        r"(?:Year\s*of\s*Birth|YOB)\s*[:\-\.]*\s*(\d{4})",
        r"(?:DOB|Date\s*of\s*Birth)\s*[:\-\.]*\s*(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})",
    ]
    for p in labeled_patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            return m.group(1).strip()

    # 2. General standalone dates DD/MM/YYYY or YYYY-MM-DD
    date_matches = re.findall(r"\b(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\b", text)
    if date_matches:
        return date_matches[0]

    date_iso = re.findall(r"\b((?:19|20)\d{2}[\/\-\.]\d{2}[\/\-\.]\d{2})\b", text)
    if date_iso:
        return date_iso[0]

    # 3. Fallback: 4-digit Year between 1940 and 2010
    year_match = re.search(r"\b(19[4-9]\d|20[0-1]\d)\b", text)
    if year_match:
        return year_match.group(1)

    return ""


def _find_doc_number(text: str, doc_type: str) -> str:
    """Extracts official document identifier based on RBI OVD specifications."""
    d = (doc_type or "").lower()

    # Aadhaar: 12 digits, often 4-4-4, or masked XXXX-XXXX-1234
    if "aadhaar" in d:
        m = re.search(r"\b(\d{4}\s?\d{4}\s?\d{4})\b", text)
        if m:
            return m.group(1).replace(" ", "")
        m_masked = re.search(r"\b([X\d]{4}[\s\-]?[X\d]{4}[\s\-]?\d{4})\b", text, re.IGNORECASE)
        if m_masked:
            return m_masked.group(1).replace(" ", "").replace("-", "")

    # PAN: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)
    if "pan" in d:
        m = re.search(r"\b([A-Z]{5}[0-9]{4}[A-Z])\b", text)
        if m:
            return m.group(1)

    # Passport: 1 letter + 7 digits (e.g. Z1234567 or J1234567)
    if "passport" in d:
        m = re.search(r"\b([A-PR-WYa-pr-wy][1-9]\d{6,7})\b", text)
        if m:
            return m.group(1).upper()

    # Driving Licence: e.g. DL-0120180001234 or MH12 20180001234
    if "driving" in d or "licence" in d or "license" in d:
        m = re.search(r"\b([A-Z]{2}[-\s]?\d{2}[-\s]?(?:19|20)?\d{2}[-\s]?\d{7,11})\b", text)
        if m:
            return m.group(1).replace(" ", "").replace("-", "").upper()

    # Voter ID (EPIC): 3 letters + 7 digits (e.g. ABC1234567)
    if "voter" in d or "epic" in d:
        m = re.search(r"\b([A-Z]{3}[0-9]{7})\b", text)
        if m:
            return m.group(1).upper()

    # Utility Bill / Deemed OVD: Account or Consumer Number
    if "utility" in d or "bill" in d or "nrega" in d:
        m = re.search(r"(?:Consumer|Account|CA|BP|K)\s*(?:No|Number|#)?\s*[:\-\.]*\s*([A-Z0-9\-]{6,20})", text, re.IGNORECASE)
        if m:
            return m.group(1).strip()

    # General Fallback: look for PAN or Aadhaar format across all text
    pan_fallback = re.search(r"\b([A-Z]{5}[0-9]{4}[A-Z])\b", text)
    if pan_fallback:
        return pan_fallback.group(1)

    aadhaar_fallback = re.search(r"\b(\d{4}\s\d{4}\s\d{4})\b", text)
    if aadhaar_fallback:
        return aadhaar_fallback.group(1).replace(" ", "")

    return ""


def _find_address(text: str) -> str:
    """Extracts address or location cues including 6-digit Indian PIN codes."""
    # 1. Search for 6-digit Indian Postal Code
    pincode = ""
    pin_match = re.search(r"\b([1-9][0-9]{5})\b", text)
    if pin_match:
        pincode = pin_match.group(1)

    # 2. Look for labelled address blocks
    patterns = [
        r"(?:Address|Addr|पता)\s*[:\-\.]+\s*((?:.+\n?){1,3})",
        r"(?:S/O|D/O|W/O|C/O)\s*[:\-\.]*\s*.+\n?((?:.+\n?){1,2})"
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            addr = m.group(1).strip().replace("\n", ", ")
            addr = re.sub(r"\s+", " ", addr)
            if len(addr) > 8:
                return addr

    # 3. If PIN code found, extract surrounding line
    if pincode:
        for line in text.splitlines():
            if pincode in line:
                return line.strip()
        return f"Postal Code: {pincode}"

    return ""


def _find_gender(text: str) -> str:
    """Extracts gender from document text."""
    u = text.upper()
    if re.search(r"\b(?:FEMALE|महिला|WOMAN)\b", u):
        return "Female"
    if re.search(r"\b(?:TRANSGENDER)\b", u):
        return "Transgender"
    if re.search(r"\b(?:MALE|पुरुष|MAN)\b", u):
        return "Male"
    return ""


def parse_ocr_fields(raw_text: str, doc_type: str) -> Dict[str, str]:
    """Parses all required KYC fields from raw document text."""
    return {
        "extracted_name": _find_name(raw_text, doc_type),
        "extracted_dob": _find_dob(raw_text),
        "extracted_doc_number": _find_doc_number(raw_text, doc_type),
        "extracted_address": _find_address(raw_text),
        "extracted_gender": _find_gender(raw_text),
    }


# ==============================================================================
# SMART CROSS-VERIFICATION ENGINE
# ==============================================================================

def _tokenize(s: str) -> List[str]:
    """Tokenize string into lowercase alphanumeric words, filtering single chars and honorifics."""
    words = re.findall(r"[a-z0-9]+", (s or "").lower())
    ignore = {"mr", "mrs", "ms", "dr", "shri", "smt", "kumar", "sh", "kumari"}
    return [w for w in words if len(w) > 1 and w not in ignore]


def _parse_date_components(date_str: str) -> Optional[Tuple[str, str, str]]:
    """Returns normalized (year, month, day) tuple from various date string formats."""
    if not date_str:
        return None
    s = date_str.strip()
    # YYYY-MM-DD
    m_iso = re.search(r"\b(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})\b", s)
    if m_iso:
        return (m_iso.group(1), m_iso.group(2).zfill(2), m_iso.group(3).zfill(2))
    # DD/MM/YYYY
    m_dmy = re.search(r"\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\b", s)
    if m_dmy:
        return (m_dmy.group(3), m_dmy.group(2).zfill(2), m_dmy.group(1).zfill(2))
    # 4-digit Year only
    m_y = re.search(r"\b(19\d{2}|20\d{2})\b", s)
    if m_y:
        return (m_y.group(1), "", "")
    return None


def verify_against_application(extracted: Dict[str, str], application_id: str) -> Tuple[str, str, float]:
    """
    Cross-verifies extracted document details against the application record in the database.
    Performs multi-criteria matching:
      - Document Number (35%)
      - Name Token Overlap (30%)
      - DOB/YOB Alignment (20%)
      - Address/PIN Matching (10%)
      - Gender Alignment (5%)
    """
    try:
        import database
        clean_id = (application_id or "").strip()
        row = database.query_db(
            "SELECT * FROM applications WHERE UPPER(TRIM(id)) = UPPER(TRIM($1))",
            (clean_id,),
            one=True
        )
        if not row:
            return "Application Not Found", f"Application ID '{application_id}' does not exist in records.", 0.0

        # Parse application JSON columns safely
        applicant = row.get("applicant", {})
        if isinstance(applicant, str):
            try: applicant = json.loads(applicant)
            except Exception: applicant = {}

        addr_data = row.get("address", {})
        if isinstance(addr_data, str):
            try: addr_data = json.loads(addr_data)
            except Exception: addr_data = {}

        doc_data = row.get("document", {})
        if isinstance(doc_data, str):
            try: doc_data = json.loads(doc_data)
            except Exception: doc_data = {}

        notes: List[str] = []
        earned_score = 0.0
        total_possible = 0.0

        raw_text_lower = (extracted.get("raw_ocr_text") or "").lower()

        # -------------------------------------------------------------
        # 1. Document Number Verification (Weight: 0.35)
        # -------------------------------------------------------------
        app_pan = (doc_data.get("pan_number") or "").replace(" ", "").upper()
        app_aadhaar = (doc_data.get("aadhaar_number") or "").replace(" ", "").replace("-", "").upper()
        extracted_doc_num = (extracted.get("extracted_doc_number") or "").replace(" ", "").replace("-", "").upper()

        doc_checked = False
        doc_weight = 0.35

        if app_pan:
            doc_checked = True
            total_possible += doc_weight
            if app_pan == extracted_doc_num or app_pan.lower() in raw_text_lower:
                earned_score += doc_weight
                notes.append(f"✓ PAN Number matched application record ({app_pan}).")
            else:
                notes.append(f"✗ PAN mismatch: Document='{extracted_doc_num}' vs Application='{app_pan}'.")

        elif app_aadhaar:
            doc_checked = True
            total_possible += doc_weight
            last4 = app_aadhaar[-4:] if len(app_aadhaar) >= 4 else app_aadhaar
            if last4 and (last4 in extracted_doc_num or last4 in raw_text_lower):
                earned_score += doc_weight
                notes.append(f"✓ Aadhaar last 4 digits matched ({last4}).")
            else:
                notes.append(f"✗ Aadhaar mismatch: Document='{extracted_doc_num}' vs Application='{app_aadhaar}'.")

        # -------------------------------------------------------------
        # 2. Name Verification (Weight: 0.30)
        # -------------------------------------------------------------
        name_weight = 0.30
        total_possible += name_weight
        app_name = (applicant.get("full_name") or "").strip()
        kyc_name = (extracted.get("extracted_name") or "").strip()

        app_tokens = _tokenize(app_name)
        kyc_tokens = _tokenize(kyc_name)

        if app_tokens and kyc_tokens:
            intersection = set(app_tokens).intersection(set(kyc_tokens))
            # Also check if application tokens appear in the entire raw OCR text
            raw_intersection = set(app_tokens).intersection(set(_tokenize(raw_text_lower)))

            if len(intersection) >= max(1, len(app_tokens) - 1) or len(raw_intersection) >= len(app_tokens):
                earned_score += name_weight
                notes.append(f"✓ Name matched application record ('{app_name}').")
            elif intersection:
                earned_score += (name_weight * 0.5)
                notes.append(f"~ Partial name match: Document='{kyc_name}' vs Application='{app_name}'.")
            else:
                notes.append(f"✗ Name mismatch: Document='{kyc_name}' vs Application='{app_name}'.")
        elif app_name and any(tok in raw_text_lower for tok in app_tokens):
            earned_score += (name_weight * 0.8)
            notes.append(f"✓ Applicant name detected in document text ('{app_name}').")
        else:
            notes.append(f"~ Name unverified: App='{app_name}', Document='{kyc_name or 'Not detected'}'.")

        # -------------------------------------------------------------
        # 3. Date of Birth Verification (Weight: 0.20)
        # -------------------------------------------------------------
        dob_weight = 0.20
        total_possible += dob_weight
        app_dob = applicant.get("dob") or ""
        kyc_dob = extracted.get("extracted_dob") or ""

        app_date_parts = _parse_date_components(app_dob)
        kyc_date_parts = _parse_date_components(kyc_dob)

        if app_date_parts and kyc_date_parts:
            y1, m1, d1 = app_date_parts
            y2, m2, d2 = kyc_date_parts

            if y1 == y2 and m1 and m2 and m1 == m2 and d1 == d2:
                # Full exact match (Year, Month, Day)
                earned_score += dob_weight
                notes.append(f"✓ DOB matched application record ({app_dob}).")
            elif y1 == y2 and (d1 == d2 or not m2):
                # Year and Day match, or only Year of Birth available on doc
                earned_score += (dob_weight * 0.85)
                notes.append(f"✓ Year of birth matched ({y1}).")
            elif y1 == y2:
                earned_score += (dob_weight * 0.6)
                notes.append(f"~ Birth year matched ({y1}), date partially verified.")
            else:
                notes.append(f"✗ DOB mismatch: Document='{kyc_dob}' vs Application='{app_dob}'.")
        elif app_dob and str(app_dob[:4]) in raw_text_lower:
            earned_score += (dob_weight * 0.7)
            notes.append(f"✓ Birth year ({app_dob[:4]}) detected in document.")
        else:
            notes.append(f"~ DOB not verified: Document='{kyc_dob or 'None'}', App='{app_dob}'.")

        # -------------------------------------------------------------
        # 4. Address & Postal Code Verification (Weight: 0.10)
        # -------------------------------------------------------------
        addr_weight = 0.10
        total_possible += addr_weight
        app_pin = str(addr_data.get("pincode") or "").strip()
        app_city = (addr_data.get("city") or "").strip().lower()

        if app_pin and app_pin in raw_text_lower:
            earned_score += addr_weight
            notes.append(f"✓ Postal PIN code matched ({app_pin}).")
        elif app_city and app_city in raw_text_lower:
            earned_score += (addr_weight * 0.7)
            notes.append(f"✓ City location matched ({addr_data.get('city')}).")
        else:
            notes.append("~ Address could not be automatically confirmed from document.")

        # -------------------------------------------------------------
        # 5. Gender Verification (Weight: 0.05)
        # -------------------------------------------------------------
        gender_weight = 0.05
        total_possible += gender_weight
        app_gender = (applicant.get("gender") or "").strip().lower()
        kyc_gender = (extracted.get("extracted_gender") or "").strip().lower()

        if app_gender and kyc_gender:
            if app_gender == kyc_gender:
                earned_score += gender_weight
                notes.append(f"✓ Gender matched ({applicant.get('gender')}).")
            else:
                notes.append(f"✗ Gender mismatch: Document='{extracted.get('extracted_gender')}' vs Application='{applicant.get('gender')}'.")
        else:
            earned_score += (gender_weight * 0.5)

        # Normalize score
        final_score = round(earned_score / total_possible, 2) if total_possible > 0 else 0.0

        if final_score >= 0.65:
            status = "Verified"
            msg = "KYC verified successfully. " + " ".join(notes)
        elif final_score >= 0.35:
            status = "Partially Verified"
            msg = "KYC partial match. " + " ".join(notes)
        else:
            status = "Mismatch Detected"
            msg = "Significant discrepancies detected between document and application. " + " ".join(notes)

        return status, msg, final_score

    except Exception as e:
        logger.exception(f"Verification error for application {application_id}: {e}")
        return "Verification Error", f"Verification encountered an internal error: {str(e)}", 0.0


# ==============================================================================
# PERSISTENCE & ENTRY POINT
# ==============================================================================

def save_kyc_record(record: Dict[str, Any]):
    """Thread-safe persistence of KYC records to CSV."""
    _ensure_kyc_csv()
    with _csv_lock:
        try:
            with open(KYC_CSV_PATH, mode="a", newline="", encoding="utf-8-sig") as f:
                w = csv.DictWriter(f, fieldnames=KYC_CSV_HEADERS, extrasaction="ignore")
                clean_row = {k: str(record.get(k, "")) for k in KYC_CSV_HEADERS}
                w.writerow(clean_row)
        except Exception as e:
            logger.error(f"Failed to persist KYC record: {e}")


def read_all_kyc_records() -> List[Dict[str, str]]:
    """Reads all records from the KYC CSV safely."""
    _ensure_kyc_csv()
    with _csv_lock:
        try:
            if not os.path.exists(KYC_CSV_PATH):
                return []
            with open(KYC_CSV_PATH, mode="r", encoding="utf-8-sig") as f:
                records = list(csv.DictReader(f))
                # Return newest first
                return list(reversed(records))
        except Exception as e:
            logger.error(f"Failed to read KYC CSV: {e}")
            return []


def process_kyc_document(
    file_bytes: bytes,
    document_type: str,
    application_id: str,
    submitted_by: str,
    filename: str = ""
) -> Dict[str, Any]:
    """
    Main entry point for KYC processing.
    Extracts text, parses fields, cross-verifies against database, and saves to CSV.
    """
    raw_text = extract_text_from_document(file_bytes, filename=filename)

    if not raw_text.strip():
        # Handle unreadable document gracefully without throwing 500
        kyc_id = f"KYC-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"
        record = {
            "kyc_id": kyc_id,
            "application_id": application_id,
            "submitted_by": submitted_by,
            "submitted_at": datetime.now().isoformat(),
            "document_type": document_type,
            "extracted_name": "",
            "extracted_dob": "",
            "extracted_doc_number": "",
            "extracted_address": "",
            "extracted_gender": "",
            "raw_ocr_text": "",
            "kyc_status": "Unreadable Document",
            "verification_notes": "Could not detect legible text in the uploaded file. Please ensure the document is clear, well-lit, and unblurred.",
            "match_score": "0.0",
        }
        save_kyc_record(record)
        return record

    # Parse fields
    fields = parse_ocr_fields(raw_text, document_type)
    fields["raw_ocr_text"] = raw_text

    # Cross-verify against application
    kyc_status, verification_notes, match_score = verify_against_application(fields, application_id)

    kyc_id = f"KYC-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"
    record = {
        "kyc_id": kyc_id,
        "application_id": application_id,
        "submitted_by": submitted_by,
        "submitted_at": datetime.now().isoformat(),
        "document_type": document_type,
        "extracted_name": fields.get("extracted_name", ""),
        "extracted_dob": fields.get("extracted_dob", ""),
        "extracted_doc_number": fields.get("extracted_doc_number", ""),
        "extracted_address": fields.get("extracted_address", ""),
        "extracted_gender": fields.get("extracted_gender", ""),
        "raw_ocr_text": raw_text[:2000],  # store up to 2000 chars in CSV
        "kyc_status": kyc_status,
        "verification_notes": verification_notes,
        "match_score": str(match_score),
    }

    save_kyc_record(record)
    return {**record, "raw_ocr_text": raw_text}
