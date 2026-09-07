import os
import pandas as pd
from langchain_chroma import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

CHROMA_PATH = os.path.abspath("./rag_storage/chroma_db")
CSV_PATH = os.path.abspath("./csv_data/master_applications_data.csv")

def ingest_data(limit: int = 1000):
    """
    Ingests data from the CSV file, chunks it, and indexes it into ChromaDB.
    For this MVP, we use HuggingFace embeddings for speed and zero-cost, 
    and we limit to `limit` rows (set to 0 for all) to avoid taking hours on 2 million rows.
    """
    if not os.path.exists(CSV_PATH):
        print(f"Data file not found at {CSV_PATH}")
        return

    print("Loading embedding model (sentence-transformers/all-MiniLM-L6-v2)...")
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

    print(f"Loading CSV data from {CSV_PATH}...")
    df = pd.read_csv(CSV_PATH)
    
    if limit > 0:
        print(f"Limiting to first {limit} records for testing...")
        df = df.head(limit)
    else:
        print(f"Processing all {len(df)} records. This may take a while...")

    # Convert rows to text documents
    raw_documents = []
    for _, row in df.iterrows():
        # Create a structured text representation of each customer
        doc = " | ".join([f"{col}: {val}" for col, val in row.items() if pd.notnull(val)])
        raw_documents.append(doc)

    print("Chunking documents...")
    # Use a text splitter just in case some rows are extremely large
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=100,
        length_function=len
    )
    
    docs = text_splitter.create_documents(raw_documents)
    print(f"Created {len(docs)} chunks.")

    print(f"Indexing into ChromaDB at {CHROMA_PATH}...")
    db = Chroma.from_documents(
        docs,
        embeddings,
        persist_directory=CHROMA_PATH
    )
    
    print("Ingestion complete. ChromaDB is ready.")

def ingest_single_record(app_data: dict):
    """
    Ingests a single application record into ChromaDB dynamically.
    Used for real-time updates when an application is saved or submitted.
    """
    if not os.path.exists(CHROMA_PATH):
        # Database hasn't been built yet, so skip real-time sync for now.
        return

    try:
        # 1. Flatten dictionary into string representation
        doc = " | ".join([f"{k}: {v}" for k, v in app_data.items() if v is not None and v != ""])
        
        # 2. Chunk it
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=100,
            length_function=len
        )
        docs = text_splitter.create_documents([doc])
        
        # 3. Load embeddings
        embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
        
        # 4. Add to Chroma
        db = Chroma(
            persist_directory=CHROMA_PATH,
            embedding_function=embeddings
        )
        db.add_documents(docs)
        print(f"[RAG] Successfully updated vector DB for application: {app_data.get('application_id', 'Unknown')}")
    except Exception as e:
        print(f"[RAG ERROR] Failed to ingest single record: {e}")

if __name__ == "__main__":
    # Note: Processing all records.
    ingest_data(limit=0)
