import os
from langchain_chroma import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from config import get_embeddings, RBI_CHROMA_PATH

def ingest_rbi_mock_data():
    if not os.path.exists("./rbi_data/official_rbi_documents"):
        os.makedirs("./rbi_data/official_rbi_documents", exist_ok=True)
    
    # Mock RBI Knowledge
    mock_rbi_guidelines = [
       {
        "id": "RBI-KYC-001",
        "category": "KYC",
        "title": "RBI Master Direction on KYC",
        "content": (
            "Customer Due Diligence (CDD) procedures require regulated "
            "entities to verify the identity of customers using "
            "permitted officially valid documents and applicable "
            "verification procedures."
        ),
        "source": "RBI",
        "document_type": "Master Direction",
    },

    {
        "id": "RBI-DL-001",
        "category": "DIGITAL_LENDING",
        "title": "RBI Digital Lending Guidelines",
        "content": (
            "Loan disbursement and repayment processes must follow "
            "the applicable RBI requirements concerning the borrower, "
            "regulated entity, and permitted accounts and intermediaries."
        ),
        "source": "RBI",
        "document_type": "Guideline",
    },

    {
        "id": "RBI-FPC-001",
        "category": "FAIR_PRACTICES",
        "title": "RBI Fair Practices Code",
        "content": (
            "Banks should provide borrowers with appropriate information "
            "regarding sanctioned loan amounts, terms and conditions, "
            "and applicable interest-rate information in accordance with "
            "the relevant RBI requirements."
        ),
        "source": "RBI",
        "document_type": "Guideline",
    },

    {
        "id": "RBI-GRM-001",
        "category": "GRIEVANCE",
        "title": "RBI Grievance Redressal Mechanism",
        "content": (
            "Customers should first approach the concerned regulated "
            "entity for resolution of a complaint. Where the complaint "
            "is not resolved within the applicable period or the customer "
            "is dissatisfied with the response, the customer may be "
            "eligible to approach the RBI Ombudsman mechanism, subject "
            "to the applicable scheme and maintainability conditions."
        ),
        "source": "RBI",
        "document_type": "Grievance Guidance",
    }
    ]
    docs = []
    for i, text in enumerate(mock_rbi_guidelines):
        docs.append(Document(
            page_content=text,
            metadata={"source": f"RBI_Master_Direction_v{i}.pdf", "type": "Regulatory"}
        ))
        
    print("Chunking RBI documents...")
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
    split_docs = text_splitter.split_documents(docs)
    
    print(f"Indexing {len(split_docs)} RBI chunks into ChromaDB...")
    embeddings = get_embeddings()
    db = Chroma.from_documents(split_docs, embeddings, persist_directory=RBI_CHROMA_PATH)
    
    print("RBI Ingestion complete. Vector DB ready.")

if __name__ == "__main__":
    ingest_rbi_mock_data()
