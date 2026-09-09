from langgraph.graph import START, END, StateGraph
from rag_banker.state import RagState
from rag_banker.nodes import retrieve, generate

# Define the graph
workflow = StateGraph(RagState)

# Add nodes
workflow.add_node("retrieve", retrieve)
workflow.add_node("generate", generate)

# Add edges
workflow.add_edge(START, "retrieve")
workflow.add_edge("retrieve", "generate")
workflow.add_edge("generate", END)

# Compile graph
rag_app = workflow.compile()

def run_rag_query(query: str) -> str:
    """Helper function to execute the LangGraph pipeline."""
    initial_state = {"query": query, "documents": [], "generation": "", "error": ""}
    
    final_state = rag_app.invoke(initial_state)
    
    return final_state.get("generation", "Error in generation")
