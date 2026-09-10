import pytest
import os
import sys
import sqlite3
import json

# Add parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Set test environment
os.environ["DATA_DIR"] = "./test_data"
if not os.path.exists("./test_data"):
    os.makedirs("./test_data")

import database
import m0_core
from m0_core import CanonicalState, StateTransitionService, RulesEngine, IdempotencyService, TimelineService, AuditService

@pytest.fixture(autouse=True)
def setup_db():
    # Force sqlite local
    database.sqlite_path = os.path.join("./test_data", "test_loan_erp.db")
    database._cached_engine = 'sqlite'
    database.db_type = 'Local SQLite Database'
    
    # Remove old test DB
    if os.path.exists(database.sqlite_path):
        os.remove(database.sqlite_path)
        
    database.init_database()
    yield
    if os.path.exists(database.sqlite_path):
        try:
            os.remove(database.sqlite_path)
        except Exception:
            pass

def test_initial_state_and_transition():
    # Create an app directly in DB
    case_id = "CASE-2026-000001"
    database.query_db("INSERT INTO applications (id, applicant, address, employment, loan, financial, status, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (case_id, '{}', '{}', '{}', '{}', '{}', 'DRAFT', '2026-09-10'), commit=True)
    
    # Valid transition
    res = StateTransitionService.transition(case_id, CanonicalState.LEAD_CREATED, "system", "TEST", "test reason")
    assert res["success"] == True
    assert res["new_state"] == CanonicalState.LEAD_CREATED
    
    # Check DB
    app = database.query_db("SELECT status FROM applications WHERE id = ?", (case_id,), one=True)
    assert app["status"] == CanonicalState.LEAD_CREATED

def test_invalid_transition():
    case_id = "CASE-2026-000002"
    database.query_db("INSERT INTO applications (id, applicant, address, employment, loan, financial, status, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (case_id, '{}', '{}', '{}', '{}', '{}', 'IDENTITY_PENDING', '2026-09-10'), commit=True)
    
    # IDENTITY_PENDING -> DISBURSED is invalid
    with pytest.raises(ValueError, match="Invalid state transition"):
        StateTransitionService.transition(case_id, CanonicalState.DISBURSED, "system", "TEST")

def test_audit_and_timeline_creation():
    case_id = "CASE-2026-000003"
    database.query_db("INSERT INTO applications (id, applicant, address, employment, loan, financial, status, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (case_id, '{}', '{}', '{}', '{}', '{}', 'DECISION_PENDING', '2026-09-10'), commit=True)
    
    StateTransitionService.transition(case_id, CanonicalState.APPROVED, "manager", "LOAN_APPROVAL", "Looks good")
    
    # Check Audit
    audits = database.query_db("SELECT * FROM m0_state_transitions WHERE case_id = ?", (case_id,))
    assert len(audits) == 1
    assert audits[0]["old_state"] == "DECISION_PENDING"
    assert audits[0]["new_state"] == "APPROVED"
    assert audits[0]["actor"] == "manager"
    
    # Check Timeline
    timelines = database.query_db("SELECT * FROM m0_timeline_events WHERE case_id = ?", (case_id,))
    assert len(timelines) == 1
    assert timelines[0]["event_type"] == "LOAN_APPROVAL"

def test_idempotency():
    case_id = "CASE-2026-000004"
    database.query_db("INSERT INTO applications (id, applicant, address, employment, loan, financial, status, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (case_id, '{}', '{}', '{}', '{}', '{}', 'APPROVED', '2026-09-10'), commit=True)
    
    # First call
    res1 = StateTransitionService.transition(case_id, CanonicalState.OFFER_ISSUED, "system", idempotency_key="key-123")
    assert res1["success"] == True
    
    # Second call with same key
    res2 = StateTransitionService.transition(case_id, CanonicalState.OFFER_ACCEPTED, "system", idempotency_key="key-123")
    assert res2["success"] == True
    assert res2["new_state"] == CanonicalState.OFFER_ISSUED # Returned from idempotency cache
    
    # DB state should still be OFFER_ISSUED
    app = database.query_db("SELECT status FROM applications WHERE id = ?", (case_id,), one=True)
    assert app["status"] == CanonicalState.OFFER_ISSUED
    
    # Audit should only have 1 event
    audits = database.query_db("SELECT * FROM m0_state_transitions WHERE case_id = ?", (case_id,))
    assert len(audits) == 1

def test_complete_happy_path_lifecycle():
    case_id = "CASE-2026-000005"
    database.query_db("INSERT INTO applications (id, applicant, address, employment, loan, financial, status, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (case_id, '{}', '{}', '{}', '{}', '{}', 'DRAFT', '2026-09-10'), commit=True)
    
    lifecycle = [
        CanonicalState.LEAD_CREATED,
        CanonicalState.ALLOCATED,
        CanonicalState.IDENTITY_PENDING,
        CanonicalState.IDENTITY_VERIFIED,
        CanonicalState.DOCS_PENDING,
        CanonicalState.DOCS_EXTRACTED,
        CanonicalState.FINANCIALS_PENDING,
        CanonicalState.FINANCIALS_READY,
        CanonicalState.DECISION_PENDING,
        CanonicalState.APPROVED,
        CanonicalState.OFFER_ISSUED,
        CanonicalState.OFFER_ACCEPTED,
        CanonicalState.AGREEMENT_SIGNED,
        CanonicalState.MANDATE_ACTIVE,
        CanonicalState.DISBURSAL_QUEUED,
        CanonicalState.DISBURSED,
        CanonicalState.REPAYMENT_ACTIVE,
        CanonicalState.CLOSED
    ]
    
    for state in lifecycle:
        res = StateTransitionService.transition(case_id, state, "system")
        assert res["success"] == True
        assert res["new_state"] == state
        
    audits = database.query_db("SELECT * FROM m0_state_transitions WHERE case_id = ?", (case_id,))
    assert len(audits) == len(lifecycle)

def test_webhook_idempotency():
    res1 = m0_core.WebhookFramework.process_webhook("kyc", "evt_999", {"status": "verified"})
    assert res1["status"] == "success"
    assert res1["hub_result"]["module"] == "kyc"
    
    res2 = m0_core.WebhookFramework.process_webhook("kyc", "evt_999", {"status": "verified"})
    assert res2["status"] == "ignored"

def test_case_id_generation():
    id1 = database.get_next_case_id()
    id2 = database.get_next_case_id()
    assert id1 != id2
    assert id1.startswith("CASE-2026-")
    assert id2.startswith("CASE-2026-")
    num1 = int(id1.split("-")[-1])
    num2 = int(id2.split("-")[-1])
    assert num2 > num1

def test_alternate_branches():
    case_id_1 = "CASE-2026-ALT001"
    database.query_db("INSERT INTO applications (id, applicant, address, employment, loan, financial, status, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (case_id_1, '{}', '{}', '{}', '{}', '{}', 'DECISION_PENDING', '2026-09-10'), commit=True)
    
    # DECISION_PENDING -> REJECTED
    res1 = StateTransitionService.transition(case_id_1, CanonicalState.REJECTED, "system")
    assert res1["success"] == True
    
    case_id_2 = "CASE-2026-ALT002"
    database.query_db("INSERT INTO applications (id, applicant, address, employment, loan, financial, status, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (case_id_2, '{}', '{}', '{}', '{}', '{}', 'REPAYMENT_ACTIVE', '2026-09-10'), commit=True)
    
    # REPAYMENT_ACTIVE -> DELINQUENT
    res2 = StateTransitionService.transition(case_id_2, CanonicalState.DELINQUENT, "system")
    assert res2["success"] == True

import threading
def test_idempotency_concurrency():
    case_id = "CASE-2026-CONC01"
    database.query_db("INSERT INTO applications (id, applicant, address, employment, loan, financial, status, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (case_id, '{}', '{}', '{}', '{}', '{}', 'APPROVED', '2026-09-10'), commit=True)
    
    results = []
    def transition_task():
        try:
            res = StateTransitionService.transition(case_id, CanonicalState.OFFER_ISSUED, "system", idempotency_key="conc-key-1")
            results.append(res)
        except Exception as e:
            results.append(e)

    threads = [threading.Thread(target=transition_task) for _ in range(5)]
    for t in threads: t.start()
    for t in threads: t.join()

    # Should have 5 results, all showing success or some being returned from cache
    success_count = sum(1 for r in results if isinstance(r, dict) and r.get("success") == True)
    assert success_count == 5

    audits = database.query_db("SELECT * FROM m0_state_transitions WHERE case_id = ?", (case_id,))
    assert len(audits) == 1
