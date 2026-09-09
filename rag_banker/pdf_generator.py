import os
from datetime import datetime
from fpdf import FPDF

def generate_rag_report_pdf(query: str, ai_response: str) -> str:
    """Generates a PDF report of the RAG query and response, returns file path."""
    pdf = FPDF()
    pdf.add_page()
    
    # Fonts
    pdf.set_font("Arial", 'B', 16)
    pdf.cell(0, 10, "AI Customer Intelligence Report", ln=True, align='C')
    
    pdf.set_font("Arial", 'I', 10)
    pdf.cell(0, 10, f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", ln=True, align='C')
    pdf.ln(10)
    
    # Query Section
    pdf.set_font("Arial", 'B', 12)
    pdf.cell(0, 10, "Banker Query:", ln=True)
    pdf.set_font("Arial", '', 11)
    pdf.multi_cell(0, 8, query)
    pdf.ln(5)
    
    # Response Section
    pdf.set_font("Arial", 'B', 12)
    pdf.cell(0, 10, "AI Analysis:", ln=True)
    pdf.set_font("Arial", '', 11)
    
    # Clean up response for PDF (FPDF doesn't handle some unicode well without specific fonts)
    clean_response = ai_response.encode('latin-1', 'replace').decode('latin-1')
    pdf.multi_cell(0, 8, clean_response)
    
    os.makedirs("./rag_storage", exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filepath = f"./rag_storage/rag_report_{timestamp}.pdf"
    
    pdf.output(filepath)
    return filepath
