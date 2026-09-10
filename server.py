import os
from dotenv import load_dotenv
load_dotenv()
import io
import cv2
import csv
import json
import uuid
from datetime import datetime
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Response, status, Request, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi import UploadFile, File
from pydantic import BaseModel

import easyocr
import re
from PIL import Image
import numpy as np
import base64
import openai

# Directory for storing KYC document images and CSV
KYC_DOC_DIR = os.path.abspath("./data/kyc_documents")
KYC_CSV_PATH = os.path.abspath("./csv_data/kyc_extracted_data.csv")
os.makedirs(KYC_DOC_DIR, exist_ok=True)
os.makedirs(os.path.dirname(KYC_CSV_PATH), exist_ok=True)

# Initialize EasyOCR reader (English)
try:
    reader = easyocr.Reader(['en'], verbose=False)
except Exception as e:
    print(f"Failed to initialize EasyOCR: {e}")
    reader = None

# ─── Document type detection & field extraction helpers ────────────────────────

def detect_doc_type_and_fields(text: str) -> dict:
    """Detect document type from OCR text and extract key fields."""
    t = text.upper()
    info = {
        "doc_type": "Unknown",
        "pan_number": "",
        "aadhaar_number": "",
        "name": "",
        "dob": "",
        "dl_number": "",
        "passport_number": "",
        "voter_id": "",
        "raw_text": text,
    }

    # --- PAN Card ---
    pan_match = re.search(r'[A-Z]{5}[0-9]{4}[A-Z]{1}', t)
    if pan_match:
        info["pan_number"] = pan_match.group(0)
        info["doc_type"] = "PAN Card"

    # --- Aadhaar Card (12-digit with optional spaces/dashes) ---
    aadhaar_match = re.search(r'[2-9]{1}\d{3}[\s\-]?\d{4}[\s\-]?\d{4}', t)
    if aadhaar_match:
        info["aadhaar_number"] = re.sub(r'[\s\-]', '', aadhaar_match.group(0))
        if info["doc_type"] == "Unknown":
            info["doc_type"] = "Aadhaar Card"

    # --- Driving License (Indian format: XX00-XXXXXXXXXXXXXXX) ---
    dl_match = re.search(r'[A-Z]{2}[\s\-]?\d{2}[\s\-]?\d{4}\d{7}', t)
    if dl_match:
        info["dl_number"] = re.sub(r'[\s\-]', '', dl_match.group(0))
        if info["doc_type"] == "Unknown":
            info["doc_type"] = "Driving License"

    # --- Passport (Letter + 7 digits) ---
    pp_match = re.search(r'[A-Z][0-9]{7}', t)
    if pp_match and any(kw in t for kw in ["PASSPORT", "REPUBLIC OF INDIA", "NATIONALITY"]):
        info["passport_number"] = pp_match.group(0)
        if info["doc_type"] == "Unknown":
            info["doc_type"] = "Passport"

    # --- Voter ID (3 letters + 7 digits) ---
    vid_match = re.search(r'[A-Z]{3}[0-9]{7}', t)
    if vid_match and any(kw in t for kw in ["EPIC", "VOTER", "ELECTION", "ELECTOR"]):
        info["voter_id"] = vid_match.group(0)
        if info["doc_type"] == "Unknown":
            info["doc_type"] = "Voter ID"

    # --- Try extracting name (line after NAME on PAN / before dob on Aadhaar) ---
    name_match = re.search(r'(?:NAME[:\s]+)([A-Z][A-Z\s]{2,40})', t)
    if name_match:
        info["name"] = name_match.group(1).strip()

    # --- DOB in various formats ---
    dob_match = re.search(r'(\d{2}[/\-\.]\d{2}[/\-\.]\d{4})', t)
    if dob_match:
        info["dob"] = dob_match.group(1)

    return info


def preprocess_image_for_ocr(img_np: np.ndarray) -> np.ndarray:
    """Enhance a document image for better OCR accuracy."""
    gray = cv2.cvtColor(img_np, cv2.COLOR_BGR2GRAY)
    # Denoise
    gray = cv2.fastNlMeansDenoising(gray, h=10)
    # Adaptive threshold
    thresh = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
    )
    # Slight sharpening kernel
    kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
    sharpened = cv2.filter2D(thresh, -1, kernel)
    return sharpened


def append_to_kyc_csv(row: dict):
    """Append a KYC extraction result row to kyc_extracted_data.csv."""
    fieldnames = [
        "timestamp", "application_id", "doc_type", "pan_number",
        "aadhaar_number", "name", "father_name", "dob", "gender", "address",
        "dl_number", "passport_number", "voter_id", "image_path", "raw_text"
    ]
    file_exists = os.path.isfile(KYC_CSV_PATH)
    with open(KYC_CSV_PATH, mode="a", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
        if not file_exists:
            writer.writeheader()
        writer.writerow({k: row.get(k, "") for k in fieldnames})

IMPORTANT_NUMBERS_CSV_PATH = os.path.abspath("./csv_data/kyc_important_numbers.csv")

def append_to_important_numbers_csv(row: dict):
    """Append only the important extracted numbers and image path to a dedicated CSV file."""
    fieldnames = [
        "application_id", "doc_type", "extracted_numbers", "image_path", "timestamp"
    ]
    file_exists = os.path.isfile(IMPORTANT_NUMBERS_CSV_PATH)
    
    # Extract only the numbers into a clean string
    numbers = []
    if row.get("pan_number"): numbers.append(f"PAN: {row['pan_number']}")
    if row.get("aadhaar_number"): numbers.append(f"Aadhaar: {row['aadhaar_number']}")
    if row.get("dl_number"): numbers.append(f"DL: {row['dl_number']}")
    if row.get("passport_number"): numbers.append(f"Passport: {row['passport_number']}")
    if row.get("voter_id"): numbers.append(f"Voter ID: {row['voter_id']}")
    
    extracted_numbers_str = " | ".join(numbers)
    
    with open(IMPORTANT_NUMBERS_CSV_PATH, mode="a", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerow({
            "application_id": row.get("application_id", ""),
            "doc_type": row.get("doc_type", ""),
            "extracted_numbers": extracted_numbers_str,
            "image_path": row.get("image_path", ""),
            "timestamp": row.get("timestamp", "")
        })


import database
from rag_banker.graph import run_rag_query
from rag_customer import run_customer_rag
from rag_banker.pdf_generator import generate_rag_report_pdf

@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_database()
    sync_all_applications_to_data_folder()
    sync_all_datasets_to_csv_data_folder()
    print("Python FastAPI server ready with segmented CSV datasets in ./csv_data and ./data folders.")
    yield

app = FastAPI(title="R4U - Ruppee4U Loan ERP API", version="2.1.0", lifespan=lifespan)

from fastapi import Request

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error", "error": str(exc)}
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def verify_name_match_py(expected: str, extracted: str, father: str = "") -> bool:
    """Deterministic, lenient Python verification for Indian identity documents."""
    if not expected or expected.strip().lower() in ("", "unknown", "none", "temp_session", "n/a"):
        return True
    if not extracted or not extracted.strip():
        return True  # Do not block if OCR was partial or unread

    def clean_tokens(s):
        s = s.lower()
        s = re.sub(r'\b(mr|mrs|ms|shri|smt|dr|late|kumar|kumari)\b', '', s)
        s = re.sub(r'[^a-z0-9\s]', ' ', s)
        return [t for t in s.split() if len(t) > 1]

    exp_tokens = clean_tokens(expected)
    ext_tokens = clean_tokens(extracted)

    if not exp_tokens or not ext_tokens:
        return True

    # 1. Any common token (e.g. first name or last name matches)
    common = set(exp_tokens).intersection(set(ext_tokens))
    if common:
        return True

    # 2. Token-level fuzzy similarity (handles minor OCR typos, e.g. Mohit vs Mohith or Dhumal vs Dhoomal)
    from difflib import SequenceMatcher
    for t1 in exp_tokens:
        for t2 in ext_tokens:
            if SequenceMatcher(None, t1, t2).ratio() >= 0.75:
                return True

    # 3. Substring matching of compacted strings
    exp_compact = "".join(exp_tokens)
    ext_compact = "".join(ext_tokens)
    if (len(exp_compact) >= 4 and exp_compact in ext_compact) or (len(ext_compact) >= 4 and ext_compact in exp_compact):
        return True

    # 4. Check if extracted matches father_name mistakenly or shares family name
    if father:
        father_tokens = clean_tokens(father)
        if set(exp_tokens).intersection(set(father_tokens)):
            return True

    return False

@app.post("/api/ocr/extract")
async def extract_ocr(
    request: Request,
    file: UploadFile = File(...),
    application_id: Optional[str] = Query(None),
    applicant_name: Optional[str] = Query(None)
):
    """OCR a document image, classify it, extract fields, save image + row to CSV."""
    try:
        contents = await file.read()

        # Check both query parameters and form body
        try:
            form_data = await request.form()
        except Exception:
            form_data = {}

        app_id = (application_id or form_data.get("application_id") or "").strip()
        app_name = (applicant_name or form_data.get("applicant_name") or "").strip()

        # Decode with OpenCV to save the image
        img_array = np.frombuffer(contents, np.uint8)
        img_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img_cv is None:
            return JSONResponse(status_code=400, content={"error": "Invalid image"})

        # Save original image
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        uid = str(uuid.uuid4())[:8]
        doc_id = f"{app_id or 'noapp'}_{ts}_{uid}"
        img_filename = f"{doc_id}.jpg"
        img_path = os.path.join(KYC_DOC_DIR, img_filename)
        cv2.imwrite(img_path, img_cv)

        # Get Applicant Name from DB if not provided directly
        import database
        if not app_name and app_id:
            try:
                app_record = database.query_db("SELECT applicant FROM applications WHERE id = $1", (app_id,), one=True)
                if app_record and app_record["applicant"]:
                    applicant_data = json.loads(app_record["applicant"]) if isinstance(app_record["applicant"], str) else app_record["applicant"]
                    app_name = applicant_data.get('full_name', '').strip()
            except Exception as e:
                print(f"Error fetching application for name matching: {e}")

        has_expected_name = bool(app_name and app_name.lower() not in ("unknown", "none", "temp_session", "n/a", ""))

        # Encode image as JPEG for OpenAI
        success, encoded_image = cv2.imencode('.jpg', img_cv)
        if not success:
            return JSONResponse(status_code=500, content={"error": "Failed to encode image"})
        
        base64_image = base64.b64encode(encoded_image.tobytes()).decode('utf-8')

        # Use OpenAI Vision
        client = openai.OpenAI()
        
        system_prompt = f"""
You are an expert KYC verification agent for an Indian banking institution.
Your task is to analyze the provided identity document (PAN Card, Aadhaar Card, Driving License, Passport, Voter ID, or Income Proof) and extract all details accurately.

Expected Applicant Name: "{app_name if has_expected_name else 'N/A (Not Provided)'}"

CRITICAL INSTRUCTIONS FOR NAME EXTRACTION & MATCHING:
1. PAN CARDS:
   - PAN cards have "INCOME TAX DEPARTMENT" at the top.
   - The first name below the header is the APPLICANT'S FULL NAME (e.g. "MOHIT DHUMAL").
   - The second name below is the FATHER'S NAME (or Guardian's Name).
   - You MUST extract the Applicant's Name into "name", and the Father's Name into "father_name".
   - NEVER confuse Father's Name with the Applicant's Name!
2. AADHAAR / DL / PASSPORT / VOTER ID:
   - Extract the cardholder's name into "name".
   - Extract any guardian/father/spouse name into "father_name" if present.
3. NAME MATCHING LOGIC ("name_match"):
   - If Expected Applicant Name is "N/A (Not Provided)" or empty, set "name_match": true.
   - If Expected Applicant Name is provided:
     * Compare the extracted cardholder "name" (NOT father_name!) against the expected name "{app_name}".
     * Be LENIENT and case-insensitive.
     * Allow for missing or added middle names, initials, or father's initial (e.g. "Mohit D. Dhumal" matches "Mohit Dhumal").
     * Allow reversed name order (e.g. "Dhumal Mohit" matches "Mohit Dhumal").
     * Allow minor spelling or phonetic variations.
     * If the core identity matches, set "name_match": true.
     * ONLY set "name_match": false if the document clearly belongs to an entirely different individual.
4. EXTRACT ALL AVAILABLE FIELDS:
   - Document numbers (pan_number, aadhaar_number, dl_number, passport_number, voter_id).
   - Date of Birth (dob) in DD/MM/YYYY format if readable.
   - Gender (gender) e.g. Male/Female if present.
   - Address (address) if present on the document.

Return ONLY a valid JSON object with the following schema:
{{
  "doc_type": "PAN Card" | "Aadhaar Card" | "Driving License" | "Passport" | "Voter ID" | "Income Proof" | "Unknown",
  "pan_number": "extracted or empty string",
  "aadhaar_number": "extracted or empty string",
  "name": "extracted applicant name or empty string",
  "father_name": "extracted father or guardian name or empty string",
  "dob": "extracted DOB in DD/MM/YYYY or empty string",
  "gender": "extracted gender or empty string",
  "address": "extracted address or empty string",
  "dl_number": "extracted or empty string",
  "passport_number": "extracted or empty string",
  "voter_id": "extracted or empty string",
  "is_genuine": true or false,
  "name_match": true or false,
  "fraud_reason": "Provide reason ONLY if is_genuine is false or genuine name_match failure, else empty string",
  "raw_text": "Extract all text found in the image for record keeping"
}}
"""
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Analyze this document image."},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}",
                                "detail": "high"
                            }
                        }
                    ]
                }
            ],
            response_format={"type": "json_object"}
        )

        result_text = response.choices[0].message.content
        result_json = json.loads(result_text)

        # Merge with existing expected info struct
        info = {
            "doc_type": result_json.get("doc_type", "Unknown"),
            "pan_number": result_json.get("pan_number", ""),
            "aadhaar_number": result_json.get("aadhaar_number", ""),
            "name": result_json.get("name", ""),
            "father_name": result_json.get("father_name", ""),
            "dob": result_json.get("dob", ""),
            "gender": result_json.get("gender", ""),
            "address": result_json.get("address", ""),
            "dl_number": result_json.get("dl_number", ""),
            "passport_number": result_json.get("passport_number", ""),
            "voter_id": result_json.get("voter_id", ""),
            "raw_text": result_json.get("raw_text", ""),
            "is_genuine": result_json.get("is_genuine", True),
            "name_match": result_json.get("name_match", True),
            "fraud_reason": result_json.get("fraud_reason", ""),
            "image_path": img_path,
            "timestamp": ts,
            "application_id": app_id or ""
        }

        # Apply Python name verification override
        if has_expected_name:
            py_match = verify_name_match_py(app_name, info["name"], info.get("father_name", ""))
            if py_match:
                info["name_match"] = True
                if "name" in info["fraud_reason"].lower():
                    info["fraud_reason"] = ""
        else:
            info["name_match"] = True
            if "name" in info["fraud_reason"].lower():
                info["fraud_reason"] = ""

        # Append to CSVs
        append_to_kyc_csv(info)
        append_to_important_numbers_csv(info)

        has_any_number = any([
            info["pan_number"], info["aadhaar_number"], info["dl_number"], 
            info["passport_number"], info["voter_id"]
        ])
        is_unclean = len(info["raw_text"].strip()) < 5 or (info["doc_type"] == "Unknown" and not has_any_number)

        if not is_unclean:
            image_blob = encoded_image.tobytes()
            # Save the extended verification JSON into raw_text field to avoid schema migrations
            verification_payload = json.dumps({
                "raw_text": info["raw_text"],
                "is_genuine": info["is_genuine"],
                "name_match": info["name_match"],
                "fraud_reason": info["fraud_reason"]
            })
            try:
                database.query_db(
                    """INSERT INTO kyc_documents 
                       (application_id, doc_type, pan_number, aadhaar_number, name, dob, dl_number, passport_number, voter_id, raw_text, image_data)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)""",
                    (
                        info["application_id"],
                        info["doc_type"],
                        info["pan_number"],
                        info["aadhaar_number"],
                        info["name"],
                        info["dob"],
                        info["dl_number"],
                        info["passport_number"],
                        info["voter_id"],
                        verification_payload,
                        image_blob
                    ),
                    commit=True
                )
            except Exception as db_err:
                print(f"Failed to save image to DB: {db_err}")

        return {
            "success": True,
            "is_unclean": is_unclean,
            "doc_type":        info["doc_type"],
            "pan_number":      info["pan_number"],
            "aadhaar_number":  info["aadhaar_number"],
            "name":            info["name"],
            "father_name":     info["father_name"],
            "dob":             info["dob"],
            "gender":          info["gender"],
            "address":         info["address"],
            "dl_number":       info["dl_number"],
            "passport_number": info["passport_number"],
            "voter_id":        info["voter_id"],
            "image_saved":     img_path,
            "raw_text":        info["raw_text"][:500],
            "is_genuine":      info["is_genuine"],
            "name_match":      info["name_match"],
            "fraud_reason":    info["fraud_reason"]
        }
    except Exception as e:
        import traceback
        return JSONResponse(status_code=500, content={"error": str(e), "trace": traceback.format_exc()[-500:]})


# Directories dedicated to application persistence and segmented datasets
DATA_DIR = os.path.abspath("./data")
CSV_DIR = DATA_DIR
RAG_DIR = DATA_DIR
CSV_DATA_DIR = os.path.abspath("./csv_data")

# Pydantic Schemas
class LoginRequest(BaseModel):
    username: str
    password: str
    login_type: Optional[str] = None # 'bank', 'customer', 'developer'

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    full_name: str
    role: Optional[str] = "Customer"
    user_type: Optional[str] = "customer"

class ApplicationData(BaseModel):
    applicant: Dict[str, Any] = {}
    address: Dict[str, Any] = {}
    employment: Dict[str, Any] = {}
    loan: Dict[str, Any] = {}
    financial: Dict[str, Any] = {}
    document: Dict[str, Any] = {}
    digital: Dict[str, Any] = {}
    status: Optional[str] = "Submitted"
    created_by: Optional[str] = "customer"

class RagQueryRequest(BaseModel):
    query: str

class RagReportRequest(BaseModel):
    query: str
    response: str

class CustomerChatRequest(BaseModel):
    message: str
    customer_id: str
    session_id: str = "default_session"

def parse_app_row(row: Dict[str, Any]) -> Dict[str, Any]:
    def parse_field(val):
        if isinstance(val, str):
            try:
                return json.loads(val)
            except Exception:
                return val
        return val

    return {
        "id": row.get("id"),
        "applicant": parse_field(row.get("applicant", {})),
        "address": parse_field(row.get("address", {})),
        "employment": parse_field(row.get("employment", {})),
        "loan": parse_field(row.get("loan", {})),
        "financial": parse_field(row.get("financial", {})),
        "document": parse_field(row.get("document", {})),
        "digital": parse_field(row.get("digital", {})),
        "status": row.get("status", "Draft"),
        "created_date": row.get("created_date", ""),
        "created_by": row.get("created_by", ""),
        "created_at": str(row.get("created_at", "")),
        "updated_at": str(row.get("updated_at", ""))
    }

# ==============================================================================
# AUTOMATIC CSV PERSISTENCE SYSTEM (SAVED DIRECTLY IN ./data FOLDER)
# Saves each application to ./data/{app_id}.csv and maintains
# ./data/all_applications_master.csv
# ==============================================================================

def save_application_csv_to_data_folder(app: Dict[str, Any]) -> str:
    """Auto-saves an application CSV file in ./data folder for persistence."""
    os.makedirs(DATA_DIR, exist_ok=True)
    app_id = app.get("id", "UNKNOWN")
    filepath = os.path.join(DATA_DIR, f"{app_id}.csv")

    applicant = app.get("applicant", {})
    address = app.get("address", {})
    employment = app.get("employment", {})
    loan = app.get("loan", {})
    financial = app.get("financial", {})

    # Generate a rich semantic text representation
    purpose_extra = f" ({loan.get('purpose_other')})" if loan.get('purpose_other') else ""
    summary_text = (
        f"Loan Application {app_id}: Applicant {applicant.get('full_name', 'N/A')} "
        f"(DOB: {applicant.get('dob', 'N/A')}, Gender: {applicant.get('gender', 'N/A')}, "
        f"Mobile: {applicant.get('mobile', 'N/A')}, Email: {applicant.get('email', 'N/A')}, "
        f"Marital: {applicant.get('marital_status', 'N/A')}) applied for a {loan.get('loan_type', 'Loan')} "
        f"of INR {float(loan.get('requested_amount', 0) or 0):,.2f} with a {loan.get('tenure', 'N/A')} tenure. "
        f"Loan purpose is '{loan.get('purpose', 'N/A')}'{purpose_extra}. "
        f"Employment: {employment.get('employment_type', 'N/A')} at {employment.get('employer_name', 'N/A')} "
        f"as {employment.get('designation', 'N/A')} with {employment.get('experience', 'N/A')} experience and "
        f"monthly income of INR {float(employment.get('monthly_income', 0) or 0):,.2f}. "
        f"Residential Temporary Address: {address.get('current_address', 'N/A')}, {address.get('city', 'N/A')}, "
        f"{address.get('state', 'N/A')} - {address.get('pincode', 'N/A')} ({address.get('residence_type', 'N/A')}). "
        f"Residential Permanent Address: {address.get('permanent_address', 'Same as Temporary')}, {address.get('permanent_city', '')}, "
        f"{address.get('permanent_state', '')} - {address.get('permanent_pincode', '')}. "
        f"Financial liabilities: Existing loans: {financial.get('existing_loans', 'No')}, "
        f"number of loans: {financial.get('number_of_loans', 0)}, current monthly EMI: INR {float(financial.get('existing_emi', 0) or 0):,.2f}, "
        f"monthly expenses: INR {float(financial.get('monthly_expenses', 0) or 0):,.2f}. "
        f"Current status is '{app.get('status', 'Submitted')}' recorded on {app.get('created_date', 'N/A')} "
        f"by user '{app.get('created_by', 'customer')}."
    )

    with open(filepath, mode="w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["section", "field_key", "field_label", "field_value", "context_chunk"])

        # Metadata Section
        writer.writerow(["Metadata", "id", "Application ID", app_id, f"Application reference identifier is {app_id}."])
        writer.writerow(["Metadata", "status", "Status", app.get("status", "Submitted"), f"Application {app_id} current processing status is {app.get('status')}."])
        writer.writerow(["Metadata", "created_date", "Creation Date", app.get("created_date", ""), f"Application {app_id} was submitted on {app.get('created_date')}."])
        writer.writerow(["Metadata", "created_by", "Created By User", app.get("created_by", ""), f"Application was initiated by user account {app.get('created_by')}."])

        # Applicant Details
        writer.writerow(["Applicant", "full_name", "Full Name", applicant.get("full_name", ""), f"Applicant legal name is {applicant.get('full_name')}."])
        writer.writerow(["Applicant", "dob", "Date of Birth", applicant.get("dob", ""), f"Applicant date of birth is {applicant.get('dob')}."])
        writer.writerow(["Applicant", "gender", "Gender", applicant.get("gender", ""), f"Applicant gender is {applicant.get('gender')}."])
        writer.writerow(["Applicant", "mobile", "Mobile Number", applicant.get("mobile", ""), f"Applicant verified mobile number is {applicant.get('mobile')}."])
        writer.writerow(["Applicant", "email", "Email Address", applicant.get("email", ""), f"Applicant contact email address is {applicant.get('email')}."])
        writer.writerow(["Applicant", "marital_status", "Marital Status", applicant.get("marital_status", ""), f"Applicant marital status is {applicant.get('marital_status')}."])

        # Address Details
        writer.writerow(["Address", "current_address", "Current Residential Address", address.get("current_address", ""), f"Applicant residential address: {address.get('current_address')}."])
        writer.writerow(["Address", "city", "City", address.get("city", ""), f"Applicant resides in city {address.get('city')}."])
        writer.writerow(["Address", "state", "State", address.get("state", ""), f"Applicant resides in state {address.get('state')}."])
        writer.writerow(["Address", "pincode", "Pincode", address.get("pincode", ""), f"Applicant residence postal pincode is {address.get('pincode')}."])
        writer.writerow(["Address", "residence_type", "Residence Type", address.get("residence_type", ""), f"Applicant home ownership/residence type is {address.get('residence_type')}."])
        writer.writerow(["Address", "sameAsPermanent", "Same as Permanent", address.get("sameAsPermanent", True), f"Temporary address is same as permanent: {address.get('sameAsPermanent', True)}."])
        writer.writerow(["Address", "permanent_address", "Permanent Address", address.get("permanent_address", ""), f"Applicant permanent address: {address.get('permanent_address')}."])
        writer.writerow(["Address", "permanent_city", "Permanent City", address.get("permanent_city", ""), f"Applicant permanent city {address.get('permanent_city')}."])
        writer.writerow(["Address", "permanent_state", "Permanent State", address.get("permanent_state", ""), f"Applicant permanent state {address.get('permanent_state')}."])
        writer.writerow(["Address", "permanent_pincode", "Permanent Pincode", address.get("permanent_pincode", ""), f"Applicant permanent pincode is {address.get('permanent_pincode')}."])

        # Employment & Income Details
        writer.writerow(["Employment", "employment_type", "Employment Type", employment.get("employment_type", ""), f"Applicant employment classification is {employment.get('employment_type')}."])
        writer.writerow(["Employment", "employer_name", "Employer or Business Name", employment.get("employer_name", ""), f"Applicant employer or organization is {employment.get('employer_name')}."])
        writer.writerow(["Employment", "designation", "Designation", employment.get("designation", ""), f"Applicant job title/position is {employment.get('designation')}."])
        writer.writerow(["Employment", "experience", "Work Experience", employment.get("experience", ""), f"Applicant work experience is {employment.get('experience')}."])
        writer.writerow(["Employment", "monthly_income", "Monthly Income (INR)", employment.get("monthly_income", 0), f"Applicant gross monthly income is INR {employment.get('monthly_income', 0)}."])

        # Loan Requirement Details
        writer.writerow(["Loan", "loan_type", "Loan Type", loan.get("loan_type", ""), f"Applicant requested loan type is {loan.get('loan_type')}."])
        writer.writerow(["Loan", "requested_amount", "Requested Loan Amount (INR)", loan.get("requested_amount", 0), f"Requested loan principal amount is INR {loan.get('requested_amount', 0)}."])
        writer.writerow(["Loan", "tenure", "Loan Tenure", loan.get("tenure", ""), f"Requested repayment tenure is {loan.get('tenure')}."])
        writer.writerow(["Loan", "purpose", "Loan Purpose", loan.get("purpose", ""), f"Purpose of this loan is {loan.get('purpose')}."])
        if loan.get("purpose_other"):
            writer.writerow(["Loan", "purpose_other", "Purpose Specifics", loan.get("purpose_other", ""), f"Detailed loan purpose notes: {loan.get('purpose_other')}."])

        # Financial Liabilities Details
        writer.writerow(["Financial", "existing_loans", "Has Existing Loans", financial.get("existing_loans", "No"), f"Applicant declares existing loan liabilities: {financial.get('existing_loans')}."])
        writer.writerow(["Financial", "number_of_loans", "Active Loans Count", financial.get("number_of_loans", 0), f"Number of existing loans running is {financial.get('number_of_loans', 0)}."])
        writer.writerow(["Financial", "existing_emi", "Total Existing Monthly EMI (INR)", financial.get("existing_emi", 0), f"Current monthly EMI commitment is INR {financial.get('existing_emi', 0)}."])
        writer.writerow(["Financial", "monthly_expenses", "Estimated Monthly Expenses (INR)", financial.get("monthly_expenses", 0), f"Estimated monthly living expenses are INR {financial.get('monthly_expenses', 0)}."])

        # Document & KYC Verification Details
        document = app.get("document", {})
        writer.writerow(["Document", "pan_number", "PAN Number", document.get("pan_number", ""), f"Applicant PAN number is {document.get('pan_number')}."])
        writer.writerow(["Document", "aadhaar_number", "Aadhaar ID", document.get("aadhaar_number", ""), f"Applicant Aadhaar number is {document.get('aadhaar_number')}."])
        writer.writerow(["Document", "extracted_name", "KYC Extracted Name", document.get("extracted_name", ""), f"Extracted name from KYC document is {document.get('extracted_name')}."])
        writer.writerow(["Document", "extracted_dob", "KYC Extracted DOB", document.get("extracted_dob", ""), f"Extracted DOB from KYC document is {document.get('extracted_dob')}."])
        writer.writerow(["Document", "father_name", "Father's Name", document.get("father_name", ""), f"Father's name: {document.get('father_name')}."])
        writer.writerow(["Document", "id_proof_type", "Primary ID Proof", document.get("id_proof_type", "PAN Card"), f"Primary ID proof document: {document.get('id_proof_type', 'PAN Card')}."])
        writer.writerow(["Document", "address_proof_type", "Address Proof", document.get("address_proof_type", "Aadhaar Card"), f"Address proof document: {document.get('address_proof_type', 'Aadhaar Card')}."])
        writer.writerow(["Document", "income_proof_type", "Income Proof Category", document.get("income_proof_type", ""), f"Income proof type: {document.get('income_proof_type')}."])
        writer.writerow(["Document", "bank_statement_type", "Bank Statement Category", document.get("bank_statement_type", ""), f"Bank statement category: {document.get('bank_statement_type')}."])
        writer.writerow(["Document", "kyc_verified", "Video KYC Verified", document.get("kyc_verified", False), f"Video KYC verified: {document.get('kyc_verified', False)}."])

        # Full Summary Profile chunk
        writer.writerow(["Summary_Profile", "summary_profile", "Complete Profile", summary_text, summary_text])

    print(f"[CSV Auto-Saved] Full application CSV saved to: {filepath}")
    update_master_csv_in_data_folder()
    sync_all_datasets_to_csv_data_folder()

    flat_app = {
        "application_id": app.get("id", ""),
        "status": app.get("status", ""),
        "created_date": app.get("created_date", ""),
        "created_by": app.get("created_by", ""),
        "applicant_name": applicant.get("full_name", ""),
        "dob": applicant.get("dob", ""),
        "gender": applicant.get("gender", ""),
        "mobile": applicant.get("mobile", ""),
        "email": applicant.get("email", ""),
        "marital_status": applicant.get("marital_status", ""),
        "current_address": (address.get("current_address", "") or "").replace("\n", " "),
        "city": address.get("city", ""),
        "state": address.get("state", ""),
        "pincode": address.get("pincode", ""),
        "residence_type": address.get("residence_type", ""),
        "sameAsPermanent": address.get("sameAsPermanent", True),
        "permanent_address": (address.get("permanent_address", "") or "").replace("\n", " "),
        "permanent_city": address.get("permanent_city", ""),
        "permanent_state": address.get("permanent_state", ""),
        "permanent_pincode": address.get("permanent_pincode", ""),
        "employment_type": employment.get("employment_type", ""),
        "employer_name": employment.get("employer_name", ""),
        "designation": employment.get("designation", ""),
        "experience": employment.get("experience", ""),
        "monthly_income": employment.get("monthly_income", 0),
        "loan_type": loan.get("loan_type", ""),
        "requested_amount": loan.get("requested_amount", 0),
        "tenure": loan.get("tenure", ""),
        "purpose": loan.get("purpose", ""),
        "existing_loans": financial.get("existing_loans", ""),
        "existing_emi": financial.get("existing_emi", 0),
        "monthly_expenses": financial.get("monthly_expenses", 0)
    }
    
    # Fire and forget the ingestion process so it doesn't block the API
    try:
        from rag_banker.ingest import ingest_single_record
        import threading
        threading.Thread(target=ingest_single_record, args=(flat_app,), daemon=True).start()
    except Exception as e:
        print(f"[RAG ERROR] Could not start real-time ingestion thread: {e}")

    return filepath

# Alias for backwards-compatibility
save_application_csv_for_rag = save_application_csv_to_data_folder

def sync_all_datasets_to_csv_data_folder():
    """
    Categorizes all loan application data into distinct segmented CSV datasets:
    1. ./csv_data/personal_data.csv -> Customer personal & employment information
    2. ./csv_data/document_data.csv -> Customer document verification data (PAN, Aadhaar, Proofs)
    3. ./csv_data/digital_data.csv  -> Digital footprint (Device, Browser, Mobile, Location, Behavioral)
    4. ./csv_data/master_applications_data.csv -> Consolidated dataset
    """
    os.makedirs(CSV_DATA_DIR, exist_ok=True)
    rows = database.query_db("SELECT * FROM applications ORDER BY created_at DESC")
    apps = [parse_app_row(r) for r in rows]

    # 1. PERSONAL DATA CSV
    personal_file = os.path.join(CSV_DATA_DIR, "personal_data.csv")
    with open(personal_file, mode="w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([
            "application_id", "applicant_name", "dob", "gender", "mobile", "email",
            "marital_status", "current_address", "city", "state", "pincode", "residence_type",
            "sameAsPermanent", "permanent_address", "permanent_city", "permanent_state", "permanent_pincode",
            "employment_type", "employer_name", "designation", "experience", "monthly_income_inr",
            "loan_type", "requested_amount_inr", "tenure", "purpose",
            "existing_loans", "number_of_loans", "existing_emi_inr", "monthly_expenses_inr",
            "status", "created_date", "created_by"
        ])
        for a in apps:
            app_id = a.get("id", "")
            applicant = a.get("applicant", {})
            address = a.get("address", {})
            employment = a.get("employment", {})
            loan = a.get("loan", {})
            financial = a.get("financial", {})

            writer.writerow([
                app_id,
                applicant.get("full_name", ""),
                applicant.get("dob", ""),
                applicant.get("gender", ""),
                applicant.get("mobile", ""),
                applicant.get("email", ""),
                applicant.get("marital_status", ""),
                (address.get("current_address", "") or "").replace("\n", " "),
                address.get("city", ""),
                address.get("state", ""),
                address.get("pincode", ""),
                address.get("residence_type", ""),
                address.get("sameAsPermanent", True),
                (address.get("permanent_address", "") or "").replace("\n", " "),
                address.get("permanent_city", ""),
                address.get("permanent_state", ""),
                address.get("permanent_pincode", ""),
                employment.get("employment_type", ""),
                employment.get("employer_name", ""),
                employment.get("designation", ""),
                employment.get("experience", ""),
                employment.get("monthly_income", 0),
                loan.get("loan_type", ""),
                loan.get("requested_amount", 0),
                loan.get("tenure", ""),
                loan.get("purpose", ""),
                financial.get("existing_loans", "No"),
                financial.get("number_of_loans", 0),
                financial.get("existing_emi", 0),
                financial.get("monthly_expenses", 0),
                a.get("status", "Submitted"),
                a.get("created_date", ""),
                a.get("created_by", "")
            ])

    # 2. DOCUMENT DATA CSV
    document_file = os.path.join(CSV_DATA_DIR, "document_data.csv")
    with open(document_file, mode="w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([
            "application_id", "applicant_name", "applicant_mobile", "applicant_email",
            "pan_number", "aadhaar_number", "id_proof_type", "address_proof_type",
            "income_proof_type", "bank_statement_type", "verification_status",
            "doc_upload_timestamp", "status", "created_date", "created_by"
        ])
        for a in apps:
            app_id = a.get("id", "")
            applicant = a.get("applicant", {})
            doc = a.get("document", {})
            writer.writerow([
                app_id,
                applicant.get("full_name", ""),
                applicant.get("mobile", ""),
                applicant.get("email", ""),
                doc.get("pan_number", "PENDING_PAN"),
                doc.get("aadhaar_number", "PENDING_AADHAAR"),
                doc.get("id_proof_type", "National ID / PAN"),
                doc.get("address_proof_type", "Utility / Address Proof"),
                doc.get("income_proof_type", "Salary Slip / ITR"),
                doc.get("bank_statement_type", "Bank Statement (6M)"),
                doc.get("verification_status", "Verified" if a.get("status") == "Submitted" else "Pending Review"),
                doc.get("doc_upload_timestamp", a.get("created_date", "")),
                a.get("status", "Submitted"),
                a.get("created_date", ""),
                a.get("created_by", "")
            ])

    # 3. DIGITAL FOOTPRINT & BEHAVIORAL DATA CSV
    digital_file = os.path.join(CSV_DATA_DIR, "digital_data.csv")
    with open(digital_file, mode="w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([
            "application_id", "applicant_name", "device_type", "os", "platform",
            "screen_resolution", "hardware_concurrency", "browser_name", "browser_version",
            "user_agent", "language", "is_mobile", "connection_type", "online_status",
            "ip_address", "timezone", "approx_city", "approx_region", "country",
            "latitude", "longitude", "form_fill_time_seconds", "keystroke_count",
            "click_count", "paste_count", "hesitation_time_sec", "submission_timestamp",
            "status", "created_date", "created_by"
        ])
        for a in apps:
            app_id = a.get("id", "")
            applicant = a.get("applicant", {})
            digital = a.get("digital", {})
            writer.writerow([
                app_id,
                applicant.get("full_name", ""),
                digital.get("device_type", "Desktop"),
                digital.get("os", "Windows / Mac"),
                digital.get("platform", "Web Browser"),
                digital.get("screen_resolution", "1920x1080"),
                digital.get("hardware_concurrency", 8),
                digital.get("browser_name", "Chrome / WebKit"),
                digital.get("browser_version", "Latest"),
                digital.get("user_agent", "Mozilla/5.0"),
                digital.get("language", "en-IN"),
                digital.get("is_mobile", False),
                digital.get("connection_type", "Broadband / 5G"),
                digital.get("online_status", "Online"),
                digital.get("ip_address", "127.0.0.1"),
                digital.get("timezone", "Asia/Kolkata"),
                digital.get("approx_city", a.get("address", {}).get("city", "Bengaluru")),
                digital.get("approx_region", a.get("address", {}).get("state", "Karnataka")),
                digital.get("country", "India"),
                digital.get("latitude", digital.get("latitude", 12.9716)),
                digital.get("longitude", digital.get("longitude", 77.5946)),
                digital.get("form_fill_time_seconds", digital.get("form_fill_time_seconds", 180)),
                digital.get("keystroke_count", digital.get("keystroke_count", 320)),
                digital.get("click_count", digital.get("click_count", 25)),
                digital.get("paste_count", digital.get("paste_count", 1)),
                digital.get("hesitation_time_sec", digital.get("hesitation_time_sec", 12)),
                digital.get("submission_timestamp", f"{a.get('created_date', '')}T12:00:00Z"),
                a.get("status", "Submitted"),
                a.get("created_date", ""),
                a.get("created_by", "")
            ])

    # 4. MASTER CONSOLIDATED APPLICATIONS CSV
    master_csv_file = os.path.join(CSV_DATA_DIR, "master_applications_data.csv")
    with open(master_csv_file, mode="w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([
            "application_id", "status", "created_date", "created_by",
            "applicant_name", "dob", "gender", "mobile", "email", "marital_status",
            "current_address", "city", "state", "pincode", "residence_type",
            "sameAsPermanent", "permanent_address", "permanent_city", "permanent_state", "permanent_pincode",
            "employment_type", "employer_name", "designation", "experience", "monthly_income",
            "loan_type", "requested_amount", "tenure", "purpose",
            "existing_loans", "existing_emi", "monthly_expenses",
            "pan_number", "aadhaar_number", "id_proof_type", "income_proof_type", "doc_verification_status",
            "device_type", "os", "browser_name", "ip_address", "timezone", "form_fill_time_seconds"
        ])
        for a in apps:
            applicant = a.get("applicant", {})
            address = a.get("address", {})
            employment = a.get("employment", {})
            loan = a.get("loan", {})
            financial = a.get("financial", {})
            doc = a.get("document", {})
            digital = a.get("digital", {})

            writer.writerow([
                a.get("id", ""), a.get("status", ""), a.get("created_date", ""), a.get("created_by", ""),
                applicant.get("full_name", ""), applicant.get("dob", ""), applicant.get("gender", ""),
                applicant.get("mobile", ""), applicant.get("email", ""), applicant.get("marital_status", ""),
                (address.get("current_address", "") or "").replace("\n", " "), address.get("city", ""), address.get("state", ""), address.get("pincode", ""), address.get("residence_type", ""),
                address.get("sameAsPermanent", True), (address.get("permanent_address", "") or "").replace("\n", " "), address.get("permanent_city", ""), address.get("permanent_state", ""), address.get("permanent_pincode", ""),
                employment.get("employment_type", ""), employment.get("employer_name", ""), employment.get("designation", ""), employment.get("experience", ""), employment.get("monthly_income", 0),
                loan.get("loan_type", ""), loan.get("requested_amount", 0), loan.get("tenure", ""), loan.get("purpose", ""),
                financial.get("existing_loans", ""), financial.get("existing_emi", 0), financial.get("monthly_expenses", 0),
                doc.get("pan_number", ""), doc.get("aadhaar_number", ""), doc.get("id_proof_type", ""), doc.get("income_proof_type", ""), doc.get("verification_status", ""),
                digital.get("device_type", ""), digital.get("os", ""), digital.get("browser_name", ""), digital.get("ip_address", ""), digital.get("timezone", ""), digital.get("form_fill_time_seconds", "")
            ])

    print(f"[CSV Datasets Synchronized] Created personal_data.csv, document_data.csv, digital_data.csv, master_applications_data.csv in '{CSV_DATA_DIR}'")

def update_master_csv_in_data_folder():
    """Generates a master consolidated CSV file of all applications in ./data folder."""
    os.makedirs(DATA_DIR, exist_ok=True)
    master_path = os.path.join(DATA_DIR, "all_applications_master.csv")
    rows = database.query_db("SELECT * FROM applications ORDER BY created_at DESC")
    apps = [parse_app_row(r) for r in rows]

    with open(master_path, mode="w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([
            "application_id", "status", "created_date", "created_by",
            "applicant_name", "dob", "gender", "mobile", "email", "marital_status",
            "city", "state", "pincode", "residence_type",
            "employment_type", "employer_name", "designation", "monthly_income",
            "loan_type", "requested_amount", "tenure", "purpose",
            "existing_loans", "existing_emi", "monthly_expenses",
            "full_summary_document"
        ])

        for a in apps:
            app_id = a.get("id")
            applicant = a.get("applicant", {})
            address = a.get("address", {})
            employment = a.get("employment", {})
            loan = a.get("loan", {})
            financial = a.get("financial", {})

            req_amt = float(loan.get('requested_amount', 0) or 0)
            m_inc = float(employment.get('monthly_income', 0) or 0)
            ex_emi = float(financial.get('existing_emi', 0) or 0)

            doc_text = (
                f"Application {app_id}: {applicant.get('full_name')} applied for {loan.get('loan_type')} "
                f"amounting to INR {req_amt:,.2f} for {loan.get('tenure')} ({loan.get('purpose')}). "
                f"Income: INR {m_inc:,.2f} ({employment.get('employment_type')}). "
                f"Residence: {address.get('city')}, {address.get('state')} ({address.get('residence_type')}). "
                f"Existing EMI: INR {ex_emi:,.2f}. Status: {a.get('status')}."
            )

            writer.writerow([
                app_id, a.get("status"), a.get("created_date"), a.get("created_by"),
                applicant.get("full_name"), applicant.get("dob"), applicant.get("gender"),
                applicant.get("mobile"), applicant.get("email"), applicant.get("marital_status"),
                address.get("city"), address.get("state"), address.get("pincode"), address.get("residence_type"),
                employment.get("employment_type"), employment.get("employer_name"), employment.get("designation"), employment.get("monthly_income"),
                loan.get("loan_type"), loan.get("requested_amount"), loan.get("tenure"), loan.get("purpose"),
                financial.get("existing_loans"), financial.get("existing_emi"), financial.get("monthly_expenses"),
                doc_text
            ])

# Alias for backwards-compatibility
update_master_rag_csv = update_master_csv_in_data_folder

def sync_all_applications_to_data_folder():
    """Initializes and saves CSVs for all existing applications into ./data folder."""
    os.makedirs(DATA_DIR, exist_ok=True)
    rows = database.query_db("SELECT * FROM applications ORDER BY created_at DESC")
    apps = [parse_app_row(r) for r in rows]
    count = 0
    for a in apps:
        save_application_csv_to_data_folder(a)
        count += 1
    print(f"[CSV Auto-Save Ready] Synchronized {count} applications into '{DATA_DIR}'")

# Alias for backwards-compatibility
sync_all_applications_to_rag = sync_all_applications_to_data_folder

# ==============================================================================
# API ENDPOINTS
# ==============================================================================

# 1. Health & Database Engine Status
@app.get("/api/health")
def get_health():
    try:
        info = database.get_db_info()
        # Count files in RAG folder
        rag_files = [f for f in os.listdir(RAG_DIR) if f.endswith(".csv")] if os.path.exists(RAG_DIR) else []
        return {
            "status": "online",
            "backend": "Python FastAPI",
            "database": info,
            "rag": {
                "folder": RAG_DIR,
                "csv_files_count": len(rag_files),
                "status": "ready_for_rag"
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 2. Authentication: Login (Supports Bank, Customer, Developer)
@app.post("/api/auth/login")
def login(req: LoginRequest):
    username = req.username.strip()
    user = database.query_db(
        "SELECT id, username, email, password_hash, full_name, role, user_type, created_at FROM users WHERE username = $1 OR email = $1",
        (username,),
        one=True
    )

    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or email. Account not found.")

    if not database.verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid password. Please verify credentials.")

    user_data = {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "full_name": user["full_name"],
        "role": user["role"],
        "user_type": user["user_type"],
        "created_at": str(user["created_at"])
    }

    return {
        "message": f"Welcome back, {user['full_name']}!",
        "token": f"token-{user['id']}-{user['user_type']}",
        "user": user_data
    }

# 3. Authentication: Register
@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED)
def register(req: RegisterRequest):
    username = req.username.strip()
    email = req.email.strip().lower()

    existing = database.query_db(
        "SELECT id, username, email FROM users WHERE username = $1 OR email = $2",
        (username, email),
        one=True
    )
    if existing:
        field = "Username" if existing["username"].lower() == username.lower() else "Email"
        raise HTTPException(status_code=409, detail=f"{field} already registered in the database.")

    pwd_hash = database.hash_password(req.password)
    user_type = req.user_type if req.user_type in ["bank", "customer", "developer"] else "customer"
    role = req.role or ("Customer" if user_type == "customer" else "Loan Officer")

    new_id = database.query_db(
        "INSERT INTO users (username, email, password_hash, full_name, role, user_type) VALUES ($1, $2, $3, $4, $5, $6)",
        (username, email, pwd_hash, req.full_name.strip(), role, user_type),
        commit=True
    )

    created_user = database.query_db(
        "SELECT id, username, email, full_name, role, user_type, created_at FROM users WHERE username = $1",
        (username,),
        one=True
    )

    return {
        "message": f"Account '{username}' created successfully as {user_type.capitalize()}!",
        "user": {
            "id": created_user["id"],
            "username": created_user["username"],
            "email": created_user["email"],
            "full_name": created_user["full_name"],
            "role": created_user["role"],
            "user_type": created_user["user_type"],
            "created_at": str(created_user["created_at"])
        }
    }

# 4. Authentication: List Saved Credentials
@app.get("/api/auth/credentials")
def get_credentials():
    users = database.query_db(
        "SELECT id, username, email, full_name, role, user_type, created_at FROM users ORDER BY id ASC"
    )
    for u in users:
        u["created_at"] = str(u["created_at"])
    return {"credentials": users}

# 5. Applications: Query with filters
@app.get("/api/applications")
def get_applications(
    status: Optional[str] = None,
    loan_type: Optional[str] = None,
    search: Optional[str] = None,
    created_by: Optional[str] = None,
    user_type: Optional[str] = None
):
    rows = database.query_db("SELECT * FROM applications ORDER BY created_at DESC")
    apps = [parse_app_row(r) for r in rows]

    if user_type == "customer" and created_by:
        apps = [a for a in apps if a.get("created_by") == created_by or a.get("applicant", {}).get("email") == created_by]

    if status and status != "All":
        apps = [a for a in apps if a.get("status", "").lower() == status.lower()]

    if loan_type and loan_type != "All":
        apps = [a for a in apps if a.get("loan", {}).get("loan_type", "").lower() == loan_type.lower()]

    if search and search.strip():
        q = search.strip().lower()
        apps = [
            a for a in apps
            if q in a.get("id", "").lower()
            or q in a.get("applicant", {}).get("full_name", "").lower()
            or q in a.get("applicant", {}).get("email", "").lower()
            or q in a.get("applicant", {}).get("mobile", "")
        ]

    return {
        "total": len(apps),
        "applications": apps
    }

# 6. Applications: Get Single
@app.get("/api/applications/{app_id}")
def get_single_application(app_id: str):
    row = database.query_db("SELECT * FROM applications WHERE id = $1", (app_id,), one=True)
    if not row:
        raise HTTPException(status_code=404, detail=f"Application {app_id} not found")
    return parse_app_row(row)

# 7. Applications: Create / Submit New Application AND Automatically Save CSVs
@app.post("/api/applications", status_code=status.HTTP_201_CREATED)
def create_application(data: ApplicationData):
    count_row = database.query_db("SELECT COUNT(*) as count FROM applications", one=True)
    count = (count_row["count"] if count_row else 0) + 1
    app_id = f"APP-2026-{str(count).zfill(6)}"

    app_status = data.status or "Submitted"
    created_date = datetime.utcnow().strftime("%Y-%m-%d")
    created_by = data.created_by or "customer"

    database.query_db(
        """INSERT INTO applications (id, applicant, address, employment, loan, financial, document, digital, status, created_date, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)""",
        (
            app_id,
            json.dumps(data.applicant),
            json.dumps(data.address),
            json.dumps(data.employment),
            json.dumps(data.loan),
            json.dumps(data.financial),
            json.dumps(data.document or {}),
            json.dumps(data.digital or {}),
            app_status,
            created_date,
            created_by
        ),
        commit=True
    )

    # Link any KYC documents scanned during the session to this newly created application id
    kyc_session_id = (data.document or {}).get("kyc_session_id")
    if kyc_session_id:
        try:
            database.query_db(
                "UPDATE kyc_documents SET application_id = $1 WHERE application_id = $2",
                (app_id, kyc_session_id),
                commit=True
            )
        except Exception as kyc_link_err:
            print(f"Failed to link kyc documents to application {app_id}: {kyc_link_err}")

    created = database.query_db("SELECT * FROM applications WHERE id = $1", (app_id,), one=True)
    parsed_app = parse_app_row(created)

    # Automatically save CSV file in data folder and update segmented datasets in ./csv_data
    save_application_csv_to_data_folder(parsed_app)
    parsed_app["csv_saved"] = True

    return parsed_app

# 8. Applications: Update Draft AND Save CSV
@app.put("/api/applications/{app_id}")
def update_application(app_id: str, data: ApplicationData):
    existing = database.query_db("SELECT id, status FROM applications WHERE id = $1", (app_id,), one=True)
    if not existing:
        raise HTTPException(status_code=404, detail="Application not found")

    database.query_db(
        """UPDATE applications SET
           applicant = $1,
           address = $2,
           employment = $3,
           loan = $4,
           financial = $5,
           document = $6,
           digital = $7,
           updated_at = CURRENT_TIMESTAMP
           WHERE id = $8""",
        (
            json.dumps(data.applicant),
            json.dumps(data.address),
            json.dumps(data.employment),
            json.dumps(data.loan),
            json.dumps(data.financial),
            json.dumps(data.document or {}),
            json.dumps(data.digital or {}),
            app_id
        ),
        commit=True
    )

    updated = database.query_db("SELECT * FROM applications WHERE id = $1", (app_id,), one=True)
    parsed_app = parse_app_row(updated)
    save_application_csv_to_data_folder(parsed_app)
    return parsed_app

# 9. Applications: Submit Draft AND Save CSV
@app.post("/api/applications/{app_id}/submit")
def submit_application(app_id: str):
    database.query_db(
        "UPDATE applications SET status = 'Submitted', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        (app_id,),
        commit=True
    )
    updated = database.query_db("SELECT * FROM applications WHERE id = $1", (app_id,), one=True)
    if not updated:
        raise HTTPException(status_code=404, detail="Application not found")
    parsed_app = parse_app_row(updated)
    save_application_csv_to_data_folder(parsed_app)
    return parsed_app

# 10. Dashboard Statistics
@app.get("/api/dashboard/stats")
def get_dashboard_stats(user_type: Optional[str] = "bank", username: Optional[str] = None):
    rows = database.query_db("SELECT id, status, created_date, loan, created_by, applicant FROM applications")
    apps = [parse_app_row(r) for r in rows]
    today = datetime.utcnow().strftime("%Y-%m-%d")

    if user_type == "customer" and username:
        my_apps = [a for a in apps if a.get("created_by") == username]
        total_requested = sum(float(a.get("loan", {}).get("requested_amount", 0) or 0) for a in my_apps)
        return {
            "role": "customer",
            "total": len(my_apps),
            "draft": len([a for a in my_apps if a.get("status") == "Draft"]),
            "submitted": len([a for a in my_apps if a.get("status") == "Submitted"]),
            "totalLoanAmount": total_requested,
            "recent": my_apps[:5]
        }
    else:
        total = len(apps)
        draft = len([a for a in apps if a.get("status") == "Draft"])
        submitted = len([a for a in apps if a.get("status") == "Submitted"])
        today_count = len([a for a in apps if a.get("created_date") == today])
        total_loan_volume = sum(float(a.get("loan", {}).get("requested_amount", 0) or 0) for a in apps)

        return {
            "role": user_type or "bank",
            "total": total,
            "draft": draft,
            "submitted": submitted,
            "today": today_count,
            "totalLoanVolume": total_loan_volume,
            "recent": apps[:6]
        }

# 11. Auto-Save CSV to Data Folder Endpoint (Called on submission/sync)
@app.post("/api/applications/auto-save-csv")
def auto_save_application_csv_endpoint(data: Dict[str, Any]):
    """Auto-saves any application CSV file directly in the ./data repository folder and updates datasets in ./csv_data."""
    app_id = data.get("id")
    if not app_id:
        count_row = database.query_db("SELECT COUNT(*) as count FROM applications", one=True)
        count = (count_row["count"] if count_row else 0) + 1
        app_id = f"APP-2026-{str(count).zfill(6)}"
        data["id"] = app_id

    filepath = save_application_csv_to_data_folder(data)
    return {
        "status": "success",
        "message": f"Full application CSV auto-saved in ./data/{os.path.basename(filepath)} and synced to ./csv_data",
        "filepath": filepath,
        "filename": os.path.basename(filepath),
        "app_id": app_id
    }

# 12. Application CSV status & disk location endpoint
@app.get("/api/applications/{app_id}/csv-status")
def get_application_csv_status(app_id: str):
    csv_filename = f"{app_id}.csv"
    csv_path = os.path.join(DATA_DIR, csv_filename)
    exists = os.path.exists(csv_path)
    return {
        "app_id": app_id,
        "saved_in_data_folder": exists,
        "filepath": csv_path,
        "filename": csv_filename,
        "size_bytes": os.path.getsize(csv_path) if exists else 0
    }

# 13. Dedicated CSV Data Files Listing
@app.get("/api/data/csv-files")
def get_data_csv_files():
    """Lists all application CSV files stored directly in the ./data folder."""
    if not os.path.exists(DATA_DIR):
        return {"folder": DATA_DIR, "files": [], "total_files": 0}

    files = []
    for f in os.listdir(DATA_DIR):
        if f.endswith(".csv"):
            f_path = os.path.join(DATA_DIR, f)
            stat = os.stat(f_path)
            files.append({
                "filename": f,
                "path": f_path,
                "size_bytes": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            })

    return {
        "folder": DATA_DIR,
        "total_files": len(files),
        "files": files
    }

# 14. SEGMENTED CSV DATASETS ENDPOINTS (Saved in ./csv_data folder)
@app.get("/api/datasets/info")
def get_datasets_info():
    """
    Returns information on all segmented datasets stored in ./csv_data:
    - personal_data.csv
    - document_data.csv
    - digital_data.csv
    - master_applications_data.csv
    """
    os.makedirs(CSV_DATA_DIR, exist_ok=True)
    datasets_meta = [
        {
            "id": "personal_data",
            "name": "Personal Data CSV",
            "filename": "personal_data.csv",
            "description": "All customers personal profile, contact, residence & employment information",
            "icon": "user",
            "category": "Identity & Financial Profile"
        },
        {
            "id": "document_data",
            "name": "Document Data CSV",
            "filename": "document_data.csv",
            "description": "Document verification metrics: PAN, Aadhaar, Proof of Income, Bank Statements",
            "icon": "file-text",
            "category": "Compliance & KYC"
        },
        {
            "id": "digital_data",
            "name": "Digital & Behavioral Footprint CSV",
            "filename": "digital_data.csv",
            "description": "Device hardware, browser, mobile/OS, geolocation, and keystroke/behavioral telemetry",
            "icon": "laptop",
            "category": "Telemetry & Fraud Detection"
        },
        {
            "id": "master_applications_data",
            "name": "Master Consolidated Applications CSV",
            "filename": "master_applications_data.csv",
            "description": "Combined dataset containing all application fields for ML model training & analytics",
            "icon": "database",
            "category": "Master Dataset"
        }
    ]

    files_info = []
    total_apps = len(database.query_db("SELECT id FROM applications"))

    for ds in datasets_meta:
        file_path = os.path.join(CSV_DATA_DIR, ds["filename"])
        exists = os.path.exists(file_path)
        size = os.path.getsize(file_path) if exists else 0
        mod_time = datetime.fromtimestamp(os.stat(file_path).st_mtime).isoformat() if exists else ""
        
        # Read column count & row count
        row_count = 0
        columns = []
        if exists:
            try:
                with open(file_path, mode="r", encoding="utf-8-sig") as f:
                    r = csv.reader(f)
                    header = next(r, None)
                    if header:
                        columns = header
                        row_count = sum(1 for _ in r)
            except Exception:
                row_count = total_apps

        files_info.append({
            **ds,
            "exists": exists,
            "filepath": file_path,
            "size_bytes": size,
            "row_count": row_count,
            "columns_count": len(columns),
            "columns": columns,
            "last_modified": mod_time,
            "download_url": f"/api/datasets/download/{ds['id']}"
        })

    return {
        "folder": CSV_DATA_DIR,
        "total_applications": total_apps,
        "datasets": files_info
    }

@app.get("/api/datasets/download/{dataset_name}")
def download_dataset(dataset_name: str):
    """Downloads a segmented CSV dataset from ./csv_data folder."""
    # Ensure fresh sync before download
    sync_all_datasets_to_csv_data_folder()

    valid_names = {
        "personal_data": "personal_data.csv",
        "document_data": "document_data.csv",
        "digital_data": "digital_data.csv",
        "master_applications_data": "master_applications_data.csv"
    }

    clean_name = dataset_name.replace(".csv", "")
    if clean_name not in valid_names:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid dataset '{dataset_name}'. Available datasets: {list(valid_names.keys())}"
        )

    filename = valid_names[clean_name]
    filepath = os.path.join(CSV_DATA_DIR, filename)

    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail=f"Dataset file '{filename}' not found.")

    return FileResponse(
        path=filepath,
        media_type="text/csv",
        filename=filename,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache"
        }
    )

@app.post("/api/datasets/sync")
def sync_datasets_endpoint():
    """Forces synchronization of all datasets into ./csv_data and ./data folders."""
    sync_all_applications_to_data_folder()
    sync_all_datasets_to_csv_data_folder()
    return {
        "status": "success",
        "message": f"Successfully synchronized all datasets into {CSV_DATA_DIR} and {DATA_DIR}",
        "folder": CSV_DATA_DIR
    }

# Backwards compatibility alias for RAG file inspection
@app.get("/api/rag/files")
def get_rag_files():
    return get_data_csv_files()

@app.post("/api/rag/sync-all")
def trigger_rag_sync():
    """Explicitly triggers full synchronization of all database applications to ./data and ./csv_data."""
    sync_all_applications_to_data_folder()
    sync_all_datasets_to_csv_data_folder()
    files = [f for f in os.listdir(DATA_DIR) if f.endswith(".csv")]
    return {
        "message": f"Successfully synchronized {len(files)} CSV files into {DATA_DIR} and {CSV_DATA_DIR}",
        "folder": DATA_DIR,
        "files_count": len(files)
    }

@app.post("/api/rag/query")
def api_rag_query(req: RagQueryRequest):
    """Processes a natural language query against the dataset using Mistral RAG"""
    response = run_rag_query(req.query)
    return {"response": response}

@app.post("/api/rag/report")
def api_rag_report(req: RagReportRequest):
    """Generates a PDF report from the RAG query and response"""
    filepath = generate_rag_report_pdf(req.query, req.response)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=500, detail="Failed to generate PDF")
        
    return FileResponse(
        path=filepath,
        media_type="application/pdf",
        filename=os.path.basename(filepath),
        headers={
            "Content-Disposition": f'attachment; filename="{os.path.basename(filepath)}"'
        }
    )

class CustomerChatRequest(BaseModel):
    message: str
    customer_id: str
    session_id: str = "default_session"

@app.post("/api/customer-chat")
def api_customer_chat(req: CustomerChatRequest):
    """
    Production Customer Support Chatbot API.
    Routes queries to structured SQLite lookups or RBI vector search.
    Enforces authorization using the provided customer_id.
    """
    if req.customer_id != "admin":
        user_row = database.query_db("SELECT id FROM users WHERE username = ? OR CAST(id AS TEXT) = ?", (req.customer_id, req.customer_id), one=True)
        if not user_row:
            app_row = database.query_db("SELECT id FROM applications WHERE created_by = ?", (req.customer_id,), one=True)
            if not app_row:
                return {"answer": "Unauthorized: Invalid customer ID.", "intent": "ERROR"}

    try:
        answer = run_customer_rag(query=req.message, customer_id=req.customer_id, session_id=req.session_id)
        return {"answer": answer, "intent": "RAG_PROCESSED"}
    except Exception as e:
        print(f"Customer Chat Error: {e}")
        return {"answer": "An error occurred while processing your request.", "intent": "ERROR"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=5000, reload=False)
