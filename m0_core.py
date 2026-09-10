import json
from datetime import datetime
from typing import Optional, Dict, Any, Tuple
import database

# --- Canonical States ---
class CanonicalState:
    DRAFT = "DRAFT"
    LEAD_CREATED = "LEAD_CREATED"
    ALLOCATED = "ALLOCATED"
    IDENTITY_PENDING = "IDENTITY_PENDING"
    IDENTITY_VERIFIED = "IDENTITY_VERIFIED"
    DOCS_PENDING = "DOCS_PENDING"
    DOCS_EXTRACTED = "DOCS_EXTRACTED"
    FINANCIALS_PENDING = "FINANCIALS_PENDING"
    FINANCIALS_READY = "FINANCIALS_READY"
    DECISION_PENDING = "DECISION_PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    REVIEW_QUEUED = "REVIEW_QUEUED"
    OFFER_ISSUED = "OFFER_ISSUED"
    OFFER_ACCEPTED = "OFFER_ACCEPTED"
    AGREEMENT_SIGNED = "AGREEMENT_SIGNED"
    MANDATE_ACTIVE = "MANDATE_ACTIVE"
    DISBURSAL_QUEUED = "DISBURSAL_QUEUED"
    DISBURSED = "DISBURSED"
    REPAYMENT_ACTIVE = "REPAYMENT_ACTIVE"
    CLOSED = "CLOSED"
    DELINQUENT = "DELINQUENT"
    CLOSED_WRITEOFF = "CLOSED_WRITEOFF"

# --- Transition Map ---
TRANSITION_MAP = {
    CanonicalState.DRAFT: [CanonicalState.LEAD_CREATED],
    CanonicalState.LEAD_CREATED: [CanonicalState.ALLOCATED],
    CanonicalState.ALLOCATED: [CanonicalState.IDENTITY_PENDING],
    CanonicalState.IDENTITY_PENDING: [CanonicalState.IDENTITY_VERIFIED],
    CanonicalState.IDENTITY_VERIFIED: [CanonicalState.DOCS_PENDING],
    CanonicalState.DOCS_PENDING: [CanonicalState.DOCS_EXTRACTED],
    CanonicalState.DOCS_EXTRACTED: [CanonicalState.FINANCIALS_PENDING],
    CanonicalState.FINANCIALS_PENDING: [CanonicalState.FINANCIALS_READY],
    CanonicalState.FINANCIALS_READY: [CanonicalState.DECISION_PENDING],
    CanonicalState.DECISION_PENDING: [
        CanonicalState.APPROVED,
        CanonicalState.REJECTED,
        CanonicalState.REVIEW_QUEUED
    ],
    CanonicalState.APPROVED: [CanonicalState.OFFER_ISSUED],
    CanonicalState.OFFER_ISSUED: [CanonicalState.OFFER_ACCEPTED],
    CanonicalState.OFFER_ACCEPTED: [CanonicalState.AGREEMENT_SIGNED],
    CanonicalState.AGREEMENT_SIGNED: [CanonicalState.MANDATE_ACTIVE],
    CanonicalState.MANDATE_ACTIVE: [CanonicalState.DISBURSAL_QUEUED],
    CanonicalState.DISBURSAL_QUEUED: [CanonicalState.DISBURSED],
    CanonicalState.DISBURSED: [CanonicalState.REPAYMENT_ACTIVE],
    CanonicalState.REPAYMENT_ACTIVE: [
        CanonicalState.CLOSED,
        CanonicalState.DELINQUENT,
        CanonicalState.CLOSED_WRITEOFF
    ]
}

# --- Legacy Mapping (if necessary) ---
def map_legacy_status(status: str) -> str:
    mapping = {
        "Draft": CanonicalState.DRAFT,
        "Submitted": CanonicalState.LEAD_CREATED,
        "Pending Verification": CanonicalState.DOCS_PENDING,
        "Verified": CanonicalState.DOCS_EXTRACTED,
        "Rejected": CanonicalState.REJECTED,
        "Approved": CanonicalState.APPROVED
    }
    return mapping.get(status, status)

# --- Rules Engine ---
class RulesEngine:
    @staticmethod
    def is_transition_allowed(current_state: str, target_state: str) -> bool:
        if current_state not in TRANSITION_MAP:
            return False
        return target_state in TRANSITION_MAP[current_state]

# --- Idempotency Service ---
class IdempotencyService:
    @staticmethod
    def check_and_lock(idempotency_key: str, case_id: str, event_type: str) -> Tuple[bool, Optional[Dict[str, Any]]]:
        """
        Returns (is_processed, saved_response)
        If not processed, creates a record and returns (False, None).
        """
        import time
        if not idempotency_key:
            return False, None
            
        try:
            # Atomic creation attempt
            database.query_db(
                """INSERT INTO m0_idempotency_keys (idempotency_key, case_id, event_type, status) 
                   VALUES ($1, $2, $3, 'PROCESSING')""",
                (idempotency_key, case_id, event_type), commit=True
            )
            return False, None
        except Exception as e:
            # If insert fails, assume it exists (IntegrityError/UniqueViolation)
            # and fetch the existing record.
            for _ in range(10): # Poll up to 1 second
                record = database.query_db(
                    "SELECT response_payload, status FROM m0_idempotency_keys WHERE idempotency_key = $1",
                    (idempotency_key,), one=True
                )
                if record:
                    if record["status"] == 'PROCESSING':
                        time.sleep(0.1)
                        continue
                        
                    payload = record["response_payload"]
                    if isinstance(payload, str):
                        payload = json.loads(payload)
                    return True, payload
                break
            
            # Fallback if still processing or not found
            if record and record["status"] == 'PROCESSING':
                # Just return a pseudo-success to prevent duplicate transitions 
                return True, {"success": True, "status": "processing", "message": "Concurrent request is processing"}
            raise e

        
    @staticmethod
    def resolve(idempotency_key: str, response_payload: Dict[str, Any]):
        if not idempotency_key:
            return
        database.query_db(
            """UPDATE m0_idempotency_keys SET status = 'COMPLETED', response_payload = $1 WHERE idempotency_key = $2""",
            (json.dumps(response_payload), idempotency_key), commit=True
        )

# --- Audit & Timeline Services ---
class AuditService:
    @staticmethod
    def log_transition(case_id: str, old_state: str, new_state: str, event_type: str, actor: str, reason: str, metadata: Dict[str, Any]):
        database.query_db(
            """INSERT INTO m0_state_transitions (case_id, old_state, new_state, event_type, actor, reason, metadata)
               VALUES ($1, $2, $3, $4, $5, $6, $7)""",
            (case_id, old_state, new_state, event_type, actor, reason, json.dumps(metadata)),
            commit=True
        )

class TimelineService:
    @staticmethod
    def add_event(case_id: str, event_type: str, event_name: str, actor: str, description: str, metadata: Dict[str, Any]):
        database.query_db(
            """INSERT INTO m0_timeline_events (case_id, event_type, event_name, actor, description, metadata)
               VALUES ($1, $2, $3, $4, $5, $6)""",
            (case_id, event_type, event_name, actor, description, json.dumps(metadata)),
            commit=True
        )

# --- State Transition Service ---
class StateTransitionService:
    @staticmethod
    def transition(
        case_id: str,
        new_state: str,
        actor: str,
        event_type: str = "STATE_TRANSITION",
        reason: str = "",
        metadata: Dict[str, Any] = None,
        idempotency_key: str = None
    ) -> Dict[str, Any]:
        if metadata is None:
            metadata = {}

        # 1. Idempotency Check
        if idempotency_key:
            is_processed, response = IdempotencyService.check_and_lock(idempotency_key, case_id, event_type)
            if is_processed:
                return response

        try:
            # 2. Get Current State
            app_record = database.query_db("SELECT status FROM applications WHERE id = $1", (case_id,), one=True)
            if not app_record:
                raise ValueError(f"Case {case_id} not found.")
            
            # Map legacy status to Canonical if needed
            current_state = map_legacy_status(app_record["status"])

            # 3. Validation
            if not RulesEngine.is_transition_allowed(current_state, new_state):
                raise ValueError(f"Invalid state transition from {current_state} to {new_state}.")

            # 4. Update Database Status
            database.query_db("UPDATE applications SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", (new_state, case_id), commit=True)
            
            # 5. Create Audit Trail
            AuditService.log_transition(case_id, current_state, new_state, event_type, actor, reason, metadata)

            # 6. Create Timeline Event
            TimelineService.add_event(case_id, event_type, f"Status changed to {new_state}", actor, f"State transitioned from {current_state} to {new_state} due to {reason or 'system action'}.", metadata)
            
            response = {"success": True, "case_id": case_id, "old_state": current_state, "new_state": new_state}

            # Resolve idempotency
            if idempotency_key:
                IdempotencyService.resolve(idempotency_key, response)

            return response
            
        except Exception as e:
            # Note: in a real robust system, idempotency might need to be released or marked failed.
            if idempotency_key:
                database.query_db(
                    "UPDATE m0_idempotency_keys SET status = 'FAILED' WHERE idempotency_key = $1", 
                    (idempotency_key,), commit=True
                )
            raise e

# --- Retry Framework ---
class RetryService:
    @staticmethod
    def execute_with_retry(func, max_retries=3, retryable_exceptions=(Exception,), non_retryable_exceptions=(), *args, **kwargs):
        import time
        attempts = 0
        while attempts < max_retries:
            try:
                return func(*args, **kwargs)
            except non_retryable_exceptions as e:
                print(f"[RetryService] Non-retryable exception: {e}. Aborting.")
                raise e
            except retryable_exceptions as e:
                attempts += 1
                print(f"[RetryService] Exception: {e}. Attempt {attempts}/{max_retries}.")
                if attempts >= max_retries:
                    print(f"[RetryService] Max retries reached. Final failure.")
                    raise e
                time.sleep(2 ** attempts) # Exponential backoff

# --- Integration Hub ---
class IntegrationHub:
    @staticmethod
    def route(provider: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Routes payload to the correct abstract integration handler based on provider."""
        print(f"[IntegrationHub] Routing request for provider: {provider}")
        # Dummy handlers for day 1
        handlers = {
            "kyc": IntegrationHub._handle_kyc,
            "ocr": IntegrationHub._handle_ocr,
            "documents": IntegrationHub._handle_documents,
            "financials": IntegrationHub._handle_financials,
            "credit_bureau": IntegrationHub._handle_credit_bureau,
            "decision_engine": IntegrationHub._handle_decision_engine,
            "agreement": IntegrationHub._handle_agreement,
            "mandate": IntegrationHub._handle_mandate,
            "disbursal": IntegrationHub._handle_disbursal,
            "repayment": IntegrationHub._handle_repayment
        }
        handler = handlers.get(provider.lower())
        if handler:
            return handler(payload)
        return {"status": "unhandled", "provider": provider}

    @staticmethod
    def _handle_kyc(payload): return {"status": "success", "module": "kyc"}
    @staticmethod
    def _handle_ocr(payload): return {"status": "success", "module": "ocr"}
    @staticmethod
    def _handle_documents(payload): return {"status": "success", "module": "documents"}
    @staticmethod
    def _handle_financials(payload): return {"status": "success", "module": "financials"}
    @staticmethod
    def _handle_credit_bureau(payload): return {"status": "success", "module": "credit_bureau"}
    @staticmethod
    def _handle_decision_engine(payload): return {"status": "success", "module": "decision_engine"}
    @staticmethod
    def _handle_agreement(payload): return {"status": "success", "module": "agreement"}
    @staticmethod
    def _handle_mandate(payload): return {"status": "success", "module": "mandate"}
    @staticmethod
    def _handle_disbursal(payload): return {"status": "success", "module": "disbursal"}
    @staticmethod
    def _handle_repayment(payload): return {"status": "success", "module": "repayment"}

# --- Webhook Framework ---
class WebhookFramework:
    @staticmethod
    def process_webhook(provider: str, event_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        # Idempotency check using atomic INSERT
        try:
            database.query_db(
                "INSERT INTO m0_webhook_events (event_id, provider, payload, processed) VALUES ($1, $2, $3, 0)",
                (event_id, provider, json.dumps(payload)), commit=True
            )
        except Exception as e:
            # Assume duplicate key violation
            record = database.query_db(
                "SELECT processed FROM m0_webhook_events WHERE event_id = $1",
                (event_id,), one=True
            )
            if record:
                return {"status": "ignored", "reason": "already_processed", "event_id": event_id}
            raise e
        
        try:
            # Route to integration hub based on provider
            hub_result = IntegrationHub.route(provider, payload)
            
            database.query_db("UPDATE m0_webhook_events SET processed = 1 WHERE event_id = $1", (event_id,), commit=True)
            return {"status": "success", "event_id": event_id, "hub_result": hub_result}
        except Exception as e:
            raise e
