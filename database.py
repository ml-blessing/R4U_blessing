import os
import json
import sqlite3
import hashlib
import hmac
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

PGHOST = os.getenv('PGHOST', 'localhost')
PGPORT = os.getenv('PGPORT', '5432')
PGUSER = os.getenv('PGUSER', 'postgres')
PGPASSWORD = os.getenv('PGPASSWORD', 'postgres')
PGDATABASE = os.getenv('PGDATABASE', 'loan_erp')
DATABASE_URL = os.getenv('DATABASE_URL', '')
DATA_DIR = os.getenv('DATA_DIR', './data')

db_type = 'unknown'
_cached_engine = None
sqlite_path = os.path.join(DATA_DIR, 'loan_erp.db')

def hash_password(password: str) -> str:
    salt = os.urandom(16).hex()
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000).hex()
    return f"{salt}${key}"

def verify_password(password: str, hashed: str) -> bool:
    try:
        if '$' in hashed:
            salt, key = hashed.split('$', 1)
            computed = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000).hex()
            return hmac.compare_digest(key, computed)
        return password == hashed
    except Exception:
        return False

def get_connection():
    global db_type, _cached_engine
    
    # If already determined to use SQLite, return SQLite immediately without retrying Postgres
    if _cached_engine == 'sqlite':
        os.makedirs(DATA_DIR, exist_ok=True)
        conn = sqlite3.connect(sqlite_path)
        conn.row_factory = sqlite3.Row
        db_type = 'Local SQLite Database'
        return conn, 'sqlite'
    
    # Try native PostgreSQL if configured or on first check
    try:
        import psycopg2
        import psycopg2.extras
        if DATABASE_URL:
            conn = psycopg2.connect(DATABASE_URL, connect_timeout=1)
        else:
            conn = psycopg2.connect(
                host=PGHOST,
                port=PGPORT,
                user=PGUSER,
                password=PGPASSWORD,
                dbname=PGDATABASE,
                connect_timeout=1
            )
        db_type = 'Native PostgreSQL'
        _cached_engine = 'postgres'
        return conn, 'postgres'
    except Exception:
        # Fallback to local SQLite SQL engine and cache decision
        os.makedirs(DATA_DIR, exist_ok=True)
        conn = sqlite3.connect(sqlite_path)
        conn.row_factory = sqlite3.Row
        db_type = 'Local SQLite Database'
        _cached_engine = 'sqlite'
        return conn, 'sqlite'

def query_db(sql: str, params=(), one=False, commit=False):
    conn, engine = get_connection()
    try:
        # Replace $1, $2 with ? if using sqlite and map parameter indices
        if engine == 'sqlite':
            formatted_sql = sql
            import re
            matches = re.findall(r'\$(\d+)', sql)
            if matches:
                new_params = tuple(params[int(m) - 1] for m in matches)
                formatted_sql = re.sub(r'\$\d+', '?', sql)
                params = new_params
            formatted_sql = formatted_sql.replace('SERIAL PRIMARY KEY', 'INTEGER PRIMARY KEY AUTOINCREMENT')
            formatted_sql = formatted_sql.replace('JSONB', 'TEXT')
            formatted_sql = formatted_sql.replace('CURRENT_TIMESTAMP', "datetime('now')")
            
            cursor = conn.cursor()
            cursor.execute(formatted_sql, params)
            if commit:
                conn.commit()
                return cursor.lastrowid
            rows = cursor.fetchall()
            cursor.close()
            result = [dict(r) for r in rows]
            return (result[0] if result else None) if one else result
        else:
            import psycopg2.extras
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Translate SQLite '?' to Postgres '%s'
            if '?' in sql:
                sql = sql.replace('?', '%s')
            
            cursor.execute(sql, params)
            if commit:
                conn.commit()
                cursor.close()
                return True
            rows = cursor.fetchall()
            cursor.close()
            result = [dict(r) for r in rows]
            return (result[0] if result else None) if one else result
    finally:
        conn.close()

def init_database():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn, engine = get_connection()
    print(f"Database connected using: {db_type}")

    # Create Users Table
    if engine == 'sqlite':
        create_users = """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT DEFAULT 'Customer',
            user_type TEXT NOT NULL, -- 'bank', 'customer', 'developer'
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        create_apps = """
        CREATE TABLE IF NOT EXISTS applications (
            id TEXT PRIMARY KEY,
            applicant TEXT NOT NULL,
            address TEXT NOT NULL,
            employment TEXT NOT NULL,
            loan TEXT NOT NULL,
            financial TEXT NOT NULL,
            document TEXT DEFAULT '{}',
            digital TEXT DEFAULT '{}',
            status TEXT NOT NULL,
            created_date TEXT NOT NULL,
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        create_kyc = """
        CREATE TABLE IF NOT EXISTS kyc_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id TEXT,
            doc_type TEXT,
            pan_number TEXT,
            aadhaar_number TEXT,
            name TEXT,
            dob TEXT,
            dl_number TEXT,
            passport_number TEXT,
            voter_id TEXT,
            raw_text TEXT,
            image_data BLOB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        create_m0_transitions = """
        CREATE TABLE IF NOT EXISTS m0_state_transitions (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT NOT NULL,
            old_state TEXT NOT NULL,
            new_state TEXT NOT NULL,
            event_type TEXT NOT NULL,
            actor TEXT NOT NULL,
            reason TEXT,
            metadata TEXT DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        create_m0_timeline = """
        CREATE TABLE IF NOT EXISTS m0_timeline_events (
            timeline_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            event_name TEXT NOT NULL,
            actor TEXT NOT NULL,
            description TEXT,
            metadata TEXT DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        create_m0_idempotency = """
        CREATE TABLE IF NOT EXISTS m0_idempotency_keys (
            idempotency_key TEXT PRIMARY KEY,
            case_id TEXT,
            event_type TEXT,
            response_payload TEXT DEFAULT '{}',
            status TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        create_m0_webhooks = """
        CREATE TABLE IF NOT EXISTS m0_webhook_events (
            event_id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            payload TEXT DEFAULT '{}',
            processed INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        create_m0_case_sequence = """
        CREATE TABLE IF NOT EXISTS m0_case_sequence (
            id INTEGER PRIMARY KEY AUTOINCREMENT
        );
        """
    else:
        create_users = """
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100) UNIQUE NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            full_name VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'Customer',
            user_type VARCHAR(20) NOT NULL, -- 'bank', 'customer', 'developer'
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        create_apps = """
        CREATE TABLE IF NOT EXISTS applications (
            id VARCHAR(50) PRIMARY KEY,
            applicant JSONB NOT NULL,
            address JSONB NOT NULL,
            employment JSONB NOT NULL,
            loan JSONB NOT NULL,
            financial JSONB NOT NULL,
            document JSONB DEFAULT '{}',
            digital JSONB DEFAULT '{}',
            status VARCHAR(50) NOT NULL,
            created_date VARCHAR(20) NOT NULL,
            created_by VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        create_kyc = """
        CREATE TABLE IF NOT EXISTS kyc_documents (
            id SERIAL PRIMARY KEY,
            application_id VARCHAR(50),
            doc_type VARCHAR(100),
            pan_number VARCHAR(50),
            aadhaar_number VARCHAR(50),
            name VARCHAR(255),
            dob VARCHAR(50),
            dl_number VARCHAR(50),
            passport_number VARCHAR(50),
            voter_id VARCHAR(50),
            raw_text TEXT,
            image_data BYTEA,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        create_m0_transitions = """
        CREATE TABLE IF NOT EXISTS m0_state_transitions (
            event_id SERIAL PRIMARY KEY,
            case_id VARCHAR(50) NOT NULL,
            old_state VARCHAR(50) NOT NULL,
            new_state VARCHAR(50) NOT NULL,
            event_type VARCHAR(100) NOT NULL,
            actor VARCHAR(100) NOT NULL,
            reason TEXT,
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        create_m0_timeline = """
        CREATE TABLE IF NOT EXISTS m0_timeline_events (
            timeline_event_id SERIAL PRIMARY KEY,
            case_id VARCHAR(50) NOT NULL,
            event_type VARCHAR(100) NOT NULL,
            event_name VARCHAR(100) NOT NULL,
            actor VARCHAR(100) NOT NULL,
            description TEXT,
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        create_m0_idempotency = """
        CREATE TABLE IF NOT EXISTS m0_idempotency_keys (
            idempotency_key VARCHAR(100) PRIMARY KEY,
            case_id VARCHAR(50),
            event_type VARCHAR(100),
            response_payload JSONB DEFAULT '{}',
            status VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        create_m0_webhooks = """
        CREATE TABLE IF NOT EXISTS m0_webhook_events (
            event_id VARCHAR(100) PRIMARY KEY,
            provider VARCHAR(100) NOT NULL,
            payload JSONB DEFAULT '{}',
            processed BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        create_m0_case_sequence = """
        CREATE TABLE IF NOT EXISTS m0_case_sequence (
            id SERIAL PRIMARY KEY
        );
        """

    cursor = conn.cursor()
    cursor.execute(create_users)
    cursor.execute(create_apps)
    cursor.execute(create_kyc)
    cursor.execute(create_m0_transitions)
    cursor.execute(create_m0_timeline)
    cursor.execute(create_m0_idempotency)
    cursor.execute(create_m0_webhooks)
    cursor.execute(create_m0_case_sequence)
    conn.commit()

    # Dynamic Column Migration for existing databases
    try:
        if engine == 'sqlite':
            cursor.execute("PRAGMA table_info(applications)")
            columns = [row[1] for row in cursor.fetchall()]
            if 'document' not in columns:
                cursor.execute("ALTER TABLE applications ADD COLUMN document TEXT DEFAULT '{}'")
            if 'digital' not in columns:
                cursor.execute("ALTER TABLE applications ADD COLUMN digital TEXT DEFAULT '{}'")
            conn.commit()
        else:
            cursor.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='applications' AND column_name='document') THEN
                        ALTER TABLE applications ADD COLUMN document JSONB DEFAULT '{}';
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='applications' AND column_name='digital') THEN
                        ALTER TABLE applications ADD COLUMN digital JSONB DEFAULT '{}';
                    END IF;
                END $$;
            """)
            conn.commit()
    except Exception as e:
        print(f"Migration error: {e}")

    # Initialize sequence if table is empty, start from COUNT(*) + 1 to avoid conflicts
    try:
        cursor.execute("SELECT COUNT(*) as c FROM m0_case_sequence")
        row = cursor.fetchone()
        seq_count = row[0] if isinstance(row, (tuple, list)) else row['c']
        
        if seq_count == 0:
            cursor.execute("SELECT COUNT(*) as c FROM applications")
            row = cursor.fetchone()
            app_count = row[0] if isinstance(row, (tuple, list)) else row['c']
            if app_count > 0:
                if engine == 'sqlite':
                    # SQLite doesn't have a direct setval, so we insert a dummy and update it
                    cursor.execute("INSERT INTO m0_case_sequence (id) VALUES (?)", (app_count,))
                else:
                    cursor.execute("SELECT setval('m0_case_sequence_id_seq', %s)", (app_count,))
                conn.commit()
    except Exception as e:
        print(f"Error initializing case sequence: {e}")

    # Seed Admin Users for Bank, Customer, Developer logins
    cursor.execute("SELECT COUNT(*) as count FROM users")
    row = cursor.fetchone()
    count = row[0] if isinstance(row, (tuple, list)) else row['count']

    if count == 0:
        print("Seeding default credentials for Bank, Customer, and Developer...")
        users_to_seed = [
            # Bank Staff Credentials
            ('bank_officer', 'officer@nationalbank.com', hash_password('bank123'), 'Sarah Jenkins', 'Loan Officer', 'bank'),
            ('bank_manager', 'manager@nationalbank.com', hash_password('bank123'), 'Vikram Malhotra', 'Credit Manager', 'bank'),
            
            # Customer Credentials
            ('customer_rajesh', 'rajesh.kumar@example.com', hash_password('cust123'), 'Rajesh Kumar', 'Customer', 'customer'),
            ('customer_priya', 'priya.sharma@example.com', hash_password('cust123'), 'Priya Sharma', 'Customer', 'customer'),
            
            # Developer Credentials
            ('developer', 'dev@loanerp.local', hash_password('dev123'), 'Dev Admin', 'Lead Developer', 'developer'),
            ('admin', 'admin@loanerp.local', hash_password('admin123'), 'System Administrator', 'Admin', 'developer'),
        ]

        insert_user_sql = "INSERT INTO users (username, email, password_hash, full_name, role, user_type) VALUES (?, ?, ?, ?, ?, ?)" if engine == 'sqlite' else "INSERT INTO users (username, email, password_hash, full_name, role, user_type) VALUES (%s, %s, %s, %s, %s, %s)"
        for u in users_to_seed:
            cursor.execute(insert_user_sql, u)
        conn.commit()
        print("Default Bank, Customer, and Developer credentials seeded successfully.")

    # Seed Default Applications
    cursor.execute("SELECT COUNT(*) as count FROM applications")
    row = cursor.fetchone()
    app_count = row[0] if isinstance(row, (tuple, list)) else row['count']

    if app_count == 0:
        print("Seeding sample loan applications with Document & Digital telemetry datasets...")
        initial_apps = [
            {
                "id": "APP-2026-000001",
                "applicant": {"full_name": "Rajesh Kumar", "dob": "1988-04-12", "gender": "Male", "mobile": "9876543210", "email": "rajesh.kumar@example.com", "marital_status": "Married"},
                "address": {"current_address": "42 MG Road, Indiranagar", "city": "Bengaluru", "state": "Karnataka", "pincode": "560038", "residence_type": "Owned"},
                "employment": {"employment_type": "Salaried", "employer_name": "Infosys Ltd", "designation": "Senior Consultant", "experience": "5–10 years", "monthly_income": 120000},
                "loan": {"loan_type": "Personal Loan", "requested_amount": 500000, "tenure": "24 Months", "purpose": "Home Improvement"},
                "financial": {"existing_loans": "No", "number_of_loans": 0, "existing_emi": 0, "monthly_expenses": 35000},
                "document": {
                    "pan_number": "ABCDE1234F",
                    "aadhaar_number": "XXXX-XXXX-4821",
                    "id_proof_type": "PAN Card",
                    "address_proof_type": "Electricity Bill",
                    "income_proof_type": "Salary Slip (3 Months)",
                    "bank_statement_type": "6 Months Bank Statement",
                    "verification_status": "Verified",
                    "doc_upload_timestamp": "2026-09-01T10:15:30Z"
                },
                "digital": {
                    "device_type": "Desktop",
                    "os": "Windows 11",
                    "platform": "Win32",
                    "screen_resolution": "1920x1080",
                    "hardware_concurrency": 8,
                    "browser_name": "Chrome",
                    "browser_version": "128.0.0.0",
                    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                    "language": "en-IN",
                    "is_mobile": False,
                    "connection_type": "WiFi / Broadband",
                    "online_status": "Online",
                    "ip_address": "122.172.84.102",
                    "timezone": "Asia/Kolkata",
                    "approx_city": "Bengaluru",
                    "approx_region": "Karnataka",
                    "country": "India",
                    "latitude": 12.9716,
                    "longitude": 77.5946,
                    "form_fill_time_seconds": 185,
                    "keystroke_count": 342,
                    "click_count": 28,
                    "paste_count": 2,
                    "hesitation_time_sec": 14,
                    "submission_timestamp": "2026-09-01T10:18:35Z"
                },
                "status": "Submitted",
                "created_date": "2026-09-01",
                "created_by": "customer_rajesh"
            },
            {
                "id": "APP-2026-000002",
                "applicant": {"full_name": "Priya Sharma", "dob": "1992-09-23", "gender": "Female", "mobile": "9812345678", "email": "priya.sharma@example.com", "marital_status": "Single"},
                "address": {"current_address": "Flat 301, Palm Grove, Bandra West", "city": "Mumbai", "state": "Maharashtra", "pincode": "400050", "residence_type": "Rented"},
                "employment": {"employment_type": "Business Owner", "employer_name": "Sharma Design Studio", "designation": "Founder", "experience": "3–5 years", "monthly_income": 250000},
                "loan": {"loan_type": "Home Loan", "requested_amount": 3000000, "tenure": "120 Months", "purpose": "Home Improvement"},
                "financial": {"existing_loans": "Yes", "number_of_loans": 1, "existing_emi": 22000, "monthly_expenses": 60000},
                "document": {
                    "pan_number": "PRYSH9876K",
                    "aadhaar_number": "XXXX-XXXX-9345",
                    "id_proof_type": "Passport",
                    "address_proof_type": "Rental Agreement",
                    "income_proof_type": "ITR Ack (2 Years)",
                    "bank_statement_type": "12 Months Current Account",
                    "verification_status": "Pending Review",
                    "doc_upload_timestamp": "2026-09-02T14:22:10Z"
                },
                "digital": {
                    "device_type": "Mobile",
                    "os": "iOS 17.5",
                    "platform": "iPhone",
                    "screen_resolution": "393x852",
                    "hardware_concurrency": 6,
                    "browser_name": "Mobile Safari",
                    "browser_version": "17.5",
                    "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
                    "language": "en-US",
                    "is_mobile": True,
                    "connection_type": "5G Mobile Data",
                    "online_status": "Online",
                    "ip_address": "49.37.112.45",
                    "timezone": "Asia/Kolkata",
                    "approx_city": "Mumbai",
                    "approx_region": "Maharashtra",
                    "country": "India",
                    "latitude": 19.0760,
                    "longitude": 72.8777,
                    "form_fill_time_seconds": 240,
                    "keystroke_count": 410,
                    "click_count": 45,
                    "paste_count": 0,
                    "hesitation_time_sec": 22,
                    "submission_timestamp": "2026-09-02T14:26:10Z"
                },
                "status": "Draft",
                "created_date": "2026-09-02",
                "created_by": "customer_priya"
            },
            {
                "id": "APP-2026-000003",
                "applicant": {"full_name": "Amit Patel", "dob": "1985-11-05", "gender": "Male", "mobile": "9923456789", "email": "amit.patel@example.com", "marital_status": "Married"},
                "address": {"current_address": "15 Nehru Nagar", "city": "Ahmedabad", "state": "Gujarat", "pincode": "380015", "residence_type": "Owned"},
                "employment": {"employment_type": "Salaried", "employer_name": "Cadila Healthcare", "designation": "General Manager", "experience": "More than 10 years", "monthly_income": 180000},
                "loan": {"loan_type": "Vehicle Loan", "requested_amount": 800000, "tenure": "48 Months", "purpose": "Vehicle Purchase"},
                "financial": {"existing_loans": "No", "number_of_loans": 0, "existing_emi": 0, "monthly_expenses": 45000},
                "document": {
                    "pan_number": "AMTPT5432M",
                    "aadhaar_number": "XXXX-XXXX-1198",
                    "id_proof_type": "Aadhaar Card",
                    "address_proof_type": "Property Tax Receipt",
                    "income_proof_type": "Form 16 & Salary Slips",
                    "bank_statement_type": "6 Months Bank Statement",
                    "verification_status": "Verified",
                    "doc_upload_timestamp": "2026-09-03T11:05:00Z"
                },
                "digital": {
                    "device_type": "Desktop",
                    "os": "macOS Sonoma",
                    "platform": "MacIntel",
                    "screen_resolution": "2560x1440",
                    "hardware_concurrency": 10,
                    "browser_name": "Safari",
                    "browser_version": "17.4",
                    "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
                    "language": "en-GB",
                    "is_mobile": False,
                    "connection_type": "WiFi / High-Speed Fiber",
                    "online_status": "Online",
                    "ip_address": "115.240.90.18",
                    "timezone": "Asia/Kolkata",
                    "approx_city": "Ahmedabad",
                    "approx_region": "Gujarat",
                    "country": "India",
                    "latitude": 23.0225,
                    "longitude": 72.5714,
                    "form_fill_time_seconds": 160,
                    "keystroke_count": 290,
                    "click_count": 22,
                    "paste_count": 1,
                    "hesitation_time_sec": 10,
                    "submission_timestamp": "2026-09-03T11:07:40Z"
                },
                "status": "Submitted",
                "created_date": "2026-09-03",
                "created_by": "bank_officer"
            },
            {
                "id": "APP-2026-000004",
                "applicant": {"full_name": "Neha Singh", "dob": "1995-02-18", "gender": "Female", "mobile": "9734567890", "email": "neha.singh@example.com", "marital_status": "Single"},
                "address": {"current_address": "Sector 62, Green Valley Apts", "city": "Noida", "state": "Uttar Pradesh", "pincode": "201309", "residence_type": "Family Owned"},
                "employment": {"employment_type": "Salaried", "employer_name": "Tech Mahindra", "designation": "Software Engineer", "experience": "1–3 years", "monthly_income": 85000},
                "loan": {"loan_type": "Education Loan", "requested_amount": 1500000, "tenure": "60 Months", "purpose": "Education"},
                "financial": {"existing_loans": "No", "number_of_loans": 0, "existing_emi": 0, "monthly_expenses": 25000},
                "document": {
                    "pan_number": "NEHAS7766R",
                    "aadhaar_number": "XXXX-XXXX-6532",
                    "id_proof_type": "Aadhaar Card",
                    "address_proof_type": "Aadhaar Card Address",
                    "income_proof_type": "Salary Slip (3 Months)",
                    "bank_statement_type": "6 Months NetBanking Statement",
                    "verification_status": "Verified",
                    "doc_upload_timestamp": "2026-09-04T09:30:15Z"
                },
                "digital": {
                    "device_type": "Mobile",
                    "os": "Android 14",
                    "platform": "Linux armv81",
                    "screen_resolution": "412x915",
                    "hardware_concurrency": 8,
                    "browser_name": "Chrome Mobile",
                    "browser_version": "128.0.0.0",
                    "user_agent": "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
                    "language": "en-IN",
                    "is_mobile": True,
                    "connection_type": "4G LTE",
                    "online_status": "Online",
                    "ip_address": "182.73.224.60",
                    "timezone": "Asia/Kolkata",
                    "approx_city": "Noida",
                    "approx_region": "Uttar Pradesh",
                    "country": "India",
                    "latitude": 28.5355,
                    "longitude": 77.3910,
                    "form_fill_time_seconds": 210,
                    "keystroke_count": 380,
                    "click_count": 34,
                    "paste_count": 3,
                    "hesitation_time_sec": 18,
                    "submission_timestamp": "2026-09-04T09:33:45Z"
                },
                "status": "Submitted",
                "created_date": "2026-09-04",
                "created_by": "customer_rajesh"
            }
        ]

        cursor.execute("CREATE TABLE IF NOT EXISTS kyc_documents (id INTEGER PRIMARY KEY AUTOINCREMENT, application_id TEXT, doc_type TEXT, pan_number TEXT, aadhaar_number TEXT, name TEXT, dob TEXT, dl_number TEXT, passport_number TEXT, voter_id TEXT, raw_text TEXT, image_data BLOB)") if engine == 'sqlite' else cursor.execute("CREATE TABLE IF NOT EXISTS kyc_documents (id SERIAL PRIMARY KEY, application_id TEXT, doc_type TEXT, pan_number TEXT, aadhaar_number TEXT, name TEXT, dob TEXT, dl_number TEXT, passport_number TEXT, voter_id TEXT, raw_text TEXT, image_data BYTEA)")

        insert_app_sql = "INSERT INTO applications (id, applicant, address, employment, loan, financial, document, digital, status, created_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)" if engine == 'sqlite' else "INSERT INTO applications (id, applicant, address, employment, loan, financial, document, digital, status, created_date, created_by) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
        for app in initial_apps:
            cursor.execute(
                insert_app_sql,
                (
                    app["id"],
                    json.dumps(app["applicant"]),
                    json.dumps(app["address"]),
                    json.dumps(app["employment"]),
                    json.dumps(app["loan"]),
                    json.dumps(app["financial"]),
                    json.dumps(app.get("document", {})),
                    json.dumps(app.get("digital", {})),
                    app["status"],
                    app["created_date"],
                    app["created_by"]
                )
            )
        conn.commit()
        print("Sample applications seeded into database with Document and Digital datasets.")

    cursor.close()
    conn.close()

def get_db_info():
    conn, engine = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM users")
        row = cursor.fetchone()
        u_count = row[0] if row else 0
        cursor.execute("SELECT COUNT(*) FROM applications")
        row = cursor.fetchone()
        a_count = row[0] if row else 0
        cursor.close()
        return {
            "engine": db_type,
            "status": "connected",
            "usersCount": u_count,
            "applicationsCount": a_count,
            "storage": "./data/loan_erp.db" if engine == 'sqlite' else f"{PGHOST}:{PGPORT}/{PGDATABASE}"
        }
    finally:
        conn.close()

# Alias for convenience
init_db = init_database

def get_next_case_id():
    conn, engine = get_connection()
    try:
        if engine == 'sqlite':
            cursor = conn.cursor()
            cursor.execute("INSERT INTO m0_case_sequence DEFAULT VALUES")
            conn.commit()
            new_id = cursor.lastrowid
            cursor.close()
            return f"CASE-2026-{str(new_id).zfill(6)}"
        else:
            import psycopg2.extras
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cursor.execute("INSERT INTO m0_case_sequence DEFAULT VALUES RETURNING id")
            new_id = cursor.fetchone()['id']
            conn.commit()
            cursor.close()
            return f"CASE-2026-{str(new_id).zfill(6)}"
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()
