import os
import json
from langchain_chroma import Chroma
from database import query_db, db_type
from .config import get_embeddings, RBI_CHROMA_PATH
from .state import CustomerSupportState

def retrieve_customer_data_node(state: CustomerSupportState) -> CustomerSupportState:
    print("--- CUSTOMER RETRIEVAL NODE ---")
    intent = state.get("intent")
    
    if intent not in ["CUSTOMER_QUERY", "CUSTOMER_PLUS_RBI_QUERY"]:
        state["customer_data"] = []
        return state

    filters = state.get("structured_filters", {})
    customer_id = state.get("customer_id")
    
    # Security: If a customer ID is provided in session, enforce it
    if customer_id and customer_id != "admin":
        # Overwrite any attempt to query a different ID
        filters["id"] = customer_id

    # Build SQL query dynamically
    base_sql = "SELECT * FROM applications"
    conditions = []
    params = []

    # Map filter keys to JSON paths for SQLite/Postgres compatibility
    # e.g., 'city' is inside 'address' json
    field_mappings = {
        "city": ("address", "city"),
        "status": (None, "status"),
        "id": (None, "id"),
        "name": ("applicant", "full_name")
    }

    param_idx = 1
    for k, v in filters.items():
        if k in field_mappings:
            json_col, field_name = field_mappings[k]
            if json_col:
                if "SQLite" in db_type:
                    conditions.append(f"json_extract({json_col}, '$.{field_name}') LIKE ?")
                else:
                    conditions.append(f"{json_col}->>'{field_name}' ILIKE ?")
                params.append(f"%{v}%")
            else:
                if "SQLite" in db_type:
                    conditions.append(f"{field_name} LIKE ?")
                else:
                    conditions.append(f"{field_name} ILIKE ?")
                params.append(f"%{v}%")

    if conditions:
        base_sql += " WHERE " + " AND ".join(conditions)

    base_sql += " LIMIT 500"  # Protect against massive queries

    try:
        rows = query_db(base_sql, tuple(params))
        
        parsed_rows = []
        for r in rows:
            # Reconstruct the flat representation for the LLM
            applicant = json.loads(r["applicant"]) if isinstance(r["applicant"], str) else r["applicant"]
            address = json.loads(r["address"]) if isinstance(r["address"], str) else r["address"]
            loan = json.loads(r["loan"]) if isinstance(r["loan"], str) else r["loan"]
            
            parsed_rows.append({
                "application_id": r["id"],
                "status": r["status"],
                "customer_name": applicant.get("full_name"),
                "city": address.get("city"),
                "loan_amount": loan.get("requested_amount")
            })
        state["customer_data"] = parsed_rows
        print(f"Retrieved {len(parsed_rows)} structured customer records.")
    except Exception as e:
        print(f"Error retrieving customer data: {e}")
        state["customer_data"] = []

    return state


def retrieve_rbi_data_node(state: CustomerSupportState) -> CustomerSupportState:
    print("--- RBI RETRIEVAL NODE ---")
    intent = state.get("intent")
    
    if intent not in ["RBI_QUERY", "CUSTOMER_PLUS_RBI_QUERY"]:
        state["rbi_documents"] = []
        return state

    if not os.path.exists(RBI_CHROMA_PATH):
        print("RBI ChromaDB not found.")
        state["rbi_documents"] = []
        return state

    try:
        embeddings = get_embeddings()
        db = Chroma(persist_directory=RBI_CHROMA_PATH, embedding_function=embeddings)
        retriever = db.as_retriever(search_kwargs={"k": 5})
        docs = retriever.invoke(state["query"])
        
        state["rbi_documents"] = [{"content": d.page_content, "metadata": d.metadata} for d in docs]
        print(f"Retrieved {len(docs)} RBI documents.")
    except Exception as e:
        print(f"Error retrieving RBI data: {e}")
        state["rbi_documents"] = []

    return state
