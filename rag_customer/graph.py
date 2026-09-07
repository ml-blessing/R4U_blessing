from langgraph.graph import START, END, StateGraph
from .state import CustomerSupportState
from .router import route_query_node
from .retrieval import retrieve_customer_data_node, retrieve_rbi_data_node
from .nodes import generate_node, validate_node

def build_graph():
    workflow = StateGraph(CustomerSupportState)
    
    # Add nodes
    workflow.add_node("route_query", route_query_node)
    workflow.add_node("retrieve_customer", retrieve_customer_data_node)
    workflow.add_node("retrieve_rbi", retrieve_rbi_data_node)
    workflow.add_node("generate", generate_node)
    workflow.add_node("validate", validate_node)
    
    # Add edges
    workflow.add_edge(START, "route_query")
    
    # Since nodes run sequentially in this simplified linear workflow, 
    # we can run both retrieval nodes (they internally check the intent).
    # In a more advanced graph, we'd use conditional edges.
    workflow.add_edge("route_query", "retrieve_customer")
    workflow.add_edge("retrieve_customer", "retrieve_rbi")
    workflow.add_edge("retrieve_rbi", "generate")
    workflow.add_edge("generate", "validate")
    workflow.add_edge("validate", END)
    
    return workflow.compile()

app = build_graph()

def run_customer_rag(query: str, customer_id: str, session_id: str) -> str:
    initial_state = {
        "query": query,
        "customer_id": customer_id,
        "session_id": session_id,
        "intent": "",
        "requested_fields": [],
        "structured_filters": {},
        "customer_data": [],
        "rbi_documents": [],
        "generation": "",
        "error": ""
    }
    
    final_state = app.invoke(initial_state)
    return final_state.get("generation", "Error processing request.")
