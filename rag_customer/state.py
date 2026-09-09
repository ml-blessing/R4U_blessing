from typing import TypedDict, List, Dict, Any, Optional

class CustomerSupportState(TypedDict):
    query: str
    customer_id: str
    session_id: str
    
    # Router Outputs
    intent: str  # CUSTOMER_QUERY, RBI_QUERY, CUSTOMER_PLUS_RBI_QUERY, GENERAL_SUPPORT_QUERY, UNSUPPORTED_QUERY
    requested_fields: List[str]  # fields the user is asking for (e.g. 'loan_amount', 'name')
    structured_filters: Dict[str, Any]  # e.g., {'city': 'Nashik', 'status': 'Approved'}
    
    # Retrieval Outputs
    customer_data: List[Dict[str, Any]]
    rbi_documents: List[Dict[str, Any]]
    
    # Generation Output
    generation: str
    error: str
