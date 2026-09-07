import json
from langchain_core.prompts import PromptTemplate
from .config import get_llm
from .state import CustomerSupportState

def route_query_node(state: CustomerSupportState) -> CustomerSupportState:
    print("--- ROUTER NODE ---")
    query = state["query"]
    llm = get_llm(temperature=0)
    
    if not llm:
        state["error"] = "LLM not configured"
        return state

    router_prompt = PromptTemplate(
        template="""
You are an intelligent banking query router. Analyze the user's query and extract JSON information.

Classify the intent into ONE of these:
1. CUSTOMER_QUERY (e.g. "What is my loan status?", "Show Nashik customers")
2. RBI_QUERY (e.g. "What are RBI KYC guidelines?")
3. CUSTOMER_PLUS_RBI_QUERY (e.g. "Why is my loan pending and what does RBI say?")
4. GENERAL_SUPPORT_QUERY (e.g. "How to contact support?")
5. UNSUPPORTED_QUERY (e.g. "Tell me the weather")

Also, extract 'requested_fields' the user explicitly asked for (e.g. ['name', 'application_id', 'status', 'city']). If they ask for 'everything' or 'details', put ['all'].

Also, extract 'structured_filters' for exact matching. Common filters are 'city', 'status', 'id', 'name'. If the user says "customers from Nashik", set structured_filters to {{"city": "Nashik"}}.

Return ONLY valid JSON in this format:
{{
    "intent": "CUSTOMER_QUERY",
    "requested_fields": ["name", "status"],
    "structured_filters": {{"city": "Nashik"}}
}}

Query: {query}
""",
        input_variables=["query"]
    )
    
    chain = router_prompt | llm
    try:
        response = chain.invoke({"query": query})
        content = response.content
        if isinstance(content, list):
            content = "".join([c.get("text", "") if isinstance(c, dict) else str(c) for c in content])
        elif not isinstance(content, str):
            content = str(content)

        # clean markdown if present
        if content.startswith("```json"):
            content = content[7:-3]
        elif content.startswith("```"):
            content = content[3:-3]
            
        parsed = json.loads(content.strip())
        state["intent"] = parsed.get("intent", "UNSUPPORTED_QUERY")
        state["requested_fields"] = parsed.get("requested_fields", [])
        state["structured_filters"] = parsed.get("structured_filters", {})
    except Exception as e:
        print(f"Router error: {e}")
        state["intent"] = "UNSUPPORTED_QUERY"
        state["requested_fields"] = []
        state["structured_filters"] = {}

    print(f"Intent: {state['intent']} | Filters: {state['structured_filters']} | Fields: {state['requested_fields']}")
    return state
