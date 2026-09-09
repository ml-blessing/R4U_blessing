import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from rag_customer.graph import run_customer_rag

def test_router_and_retrieval():
    print("--- Test 1: RBI Intent ---")
    ans1 = run_customer_rag("What does RBI say about KYC?", "admin", "test_session")
    print("Response:", ans1)
    
    print("\n--- Test 2: Customer Intent ---")
    ans2 = run_customer_rag("Give me all customers from Nashik", "admin", "test_session")
    print("Response:", ans2)
    
    print("\n--- Test 3: Unauthorized Privacy Check ---")
    # If customer is Rajesh, he shouldn't see Priya's data. 
    # Our retrieval restricts searches to customer_id if not admin.
    ans3 = run_customer_rag("What is Priya Sharma's loan amount?", "customer_rajesh", "test_session")
    print("Response:", ans3)

if __name__ == "__main__":
    test_router_and_retrieval()
