# API Schema & Data Model

Complete reference for data structures used in Loan Application ERP.

---

## Application Object

### Complete Structure

```json
{
  "id": "APP-2026-000001",
  "applicant": {
    "full_name": "string (required)",
    "dob": "YYYY-MM-DD (required)",
    "gender": "Male|Female|Other|Prefer not to say (required)",
    "mobile": "10 digits starting with 6-9 (required)",
    "email": "valid email format (required)",
    "marital_status": "Single|Married|Divorced|Widowed (required)"
  },
  "address": {
    "current_address": "string (required)",
    "city": "string (required)",
    "state": "string - Indian state name (required)",
    "pincode": "exactly 6 digits (required)",
    "residence_type": "Owned|Rented|Family Owned|Company Provided|Other (required)"
  },
  "employment": {
    "employment_type": "Salaried|Self Employed|Business Owner|Freelancer|Student|Unemployed|Other (required)",
    "employer_name": "string (required if Salaried or Business Owner)",
    "designation": "string (required if Salaried or Business Owner)",
    "experience": "Less than 1 year|1–3 years|3–5 years|5–10 years|More than 10 years (required if employed)",
    "monthly_income": "number (required if Salaried or Business Owner, must be > 0)"
  },
  "loan": {
    "loan_type": "Personal Loan|Home Loan|Vehicle Loan|Education Loan|Business Loan|Other (required)",
    "requested_amount": "number, must be > 0 (required)",
    "tenure": "6 Months|12 Months|18 Months|24 Months|36 Months|48 Months|60 Months|84 Months|120 Months (required)",
    "purpose": "Medical|Education|Home Improvement|Vehicle Purchase|Business|Personal Expenses|Debt Consolidation|Other (required)",
    "purpose_other": "string (required if purpose is 'Other')"
  },
  "financial": {
    "existing_loans": "Yes|No (required)",
    "number_of_loans": "number >= 0 (required if existing_loans is 'Yes')",
    "existing_emi": "number >= 0 (required if existing_loans is 'Yes')",
    "monthly_expenses": "number >= 0 (required)"
  },
  "status": "Draft|Submitted|Pending Verification|Verified|Rejected|Approved",
  "created_date": "YYYY-MM-DD"
}
```

---

## API Endpoints

### 1. Create New Application

**Endpoint:** `POST /api/applications`

**Request Body:**
```json
{
  "applicant": { /* ... */ },
  "address": { /* ... */ },
  "employment": { /* ... */ },
  "loan": { /* ... */ },
  "financial": { /* ... */ }
}
```

**Response (201 Created):**
```json
{
  "id": "APP-2026-000001",
  "applicant": { /* ... */ },
  "address": { /* ... */ },
  "employment": { /* ... */ },
  "loan": { /* ... */ },
  "financial": { /* ... */ },
  "status": "Submitted",
  "created_date": "2026-09-04"
}
```

**Error Response (400 Bad Request):**
```json
{
  "error": "Validation error",
  "details": {
    "full_name": ["Full name is required"],
    "email": ["Invalid email format"],
    "pincode": ["Pincode must be 6 digits"]
  }
}
```

---

### 2. Get All Applications

**Endpoint:** `GET /api/applications`

**Query Parameters:**
```
?status=Submitted        # Filter by status
?loan_type=Personal     # Filter by loan type
?search=John            # Search in applicant names
?limit=50               # Pagination limit
?offset=0               # Pagination offset
```

**Response (200 OK):**
```json
{
  "total": 42,
  "count": 10,
  "offset": 0,
  "applications": [
    {
      "id": "APP-2026-000001",
      "applicant": { "full_name": "..." },
      "loan": { "loan_type": "Personal Loan", "requested_amount": 500000 },
      "status": "Submitted",
      "created_date": "2026-09-04"
    },
    // ... more applications
  ]
}
```

---

### 3. Get Single Application

**Endpoint:** `GET /api/applications/{application_id}`

**Response (200 OK):**
```json
{
  "id": "APP-2026-000001",
  "applicant": { /* complete applicant object */ },
  "address": { /* complete address object */ },
  "employment": { /* complete employment object */ },
  "loan": { /* complete loan object */ },
  "financial": { /* complete financial object */ },
  "status": "Submitted",
  "created_date": "2026-09-04"
}
```

**Error Response (404 Not Found):**
```json
{
  "error": "Application not found",
  "id": "APP-2026-000001"
}
```

---

### 4. Update Application (Draft)

**Endpoint:** `PUT /api/applications/{application_id}`

**Request Body:** (partial update allowed)
```json
{
  "applicant": { /* ... */ },
  "address": { /* ... */ }
}
```

**Response (200 OK):**
```json
{
  "id": "APP-2026-000001",
  "applicant": { /* updated */ },
  "address": { /* updated */ },
  "employment": { /* ... */ },
  "loan": { /* ... */ },
  "financial": { /* ... */ },
  "status": "Draft",
  "created_date": "2026-09-04"
}
```

**Constraints:**
- Only allows update if `status === "Draft"`
- Returns 400 error if trying to update submitted application

---

### 5. Submit Application

**Endpoint:** `POST /api/applications/{application_id}/submit`

**Request Body:** (empty)
```json
{}
```

**Response (200 OK):**
```json
{
  "id": "APP-2026-000001",
  "applicant": { /* ... */ },
  "address": { /* ... */ },
  "employment": { /* ... */ },
  "loan": { /* ... */ },
  "financial": { /* ... */ },
  "status": "Submitted",
  "submitted_date": "2026-09-04T10:30:00Z"
}
```

**Error Response (400 Bad Request):**
```json
{
  "error": "Cannot submit incomplete application",
  "missing_fields": ["employment.employer_name", "loan.purpose_other"]
}
```

**Error Response (409 Conflict):**
```json
{
  "error": "Application already submitted",
  "status": "Submitted"
}
```

---

## Validation Rules

### Field-Level Validation

#### Applicant Section
| Field | Type | Validation | Example |
|-------|------|-----------|---------|
| full_name | string | Required, 2-100 chars | "John Doe" |
| dob | date | Required, valid date, age >= 18 | "1990-01-15" |
| gender | enum | Required, one of 4 values | "Male" |
| mobile | string | Required, 10 digits, starts with 6-9 | "9876543210" |
| email | email | Required, valid email format | "john@example.com" |
| marital_status | enum | Required, one of 4 values | "Married" |

#### Address Section
| Field | Type | Validation | Example |
|-------|------|-----------|---------|
| current_address | text | Required, 10-500 chars | "123 Main Street, Apt 5" |
| city | string | Required, 2-50 chars | "Mumbai" |
| state | enum | Required, valid Indian state | "Maharashtra" |
| pincode | string | Required, exactly 6 digits | "400001" |
| residence_type | enum | Required, one of 5 values | "Owned" |

#### Employment Section
| Field | Type | Validation | Example |
|-------|------|-----------|---------|
| employment_type | enum | Required, one of 7 values | "Salaried" |
| employer_name | string | Required if employed, 2-100 chars | "Acme Corp" |
| designation | string | Required if employed, 2-50 chars | "Manager" |
| experience | enum | Required if employed, one of 5 values | "3–5 years" |
| monthly_income | number | Required if employed, > 0 | 75000 |

#### Loan Section
| Field | Type | Validation | Example |
|-------|------|-----------|---------|
| loan_type | enum | Required, one of 6 values | "Personal Loan" |
| requested_amount | number | Required, > 0, <= 10 crores | 500000 |
| tenure | enum | Required, one of 9 values | "36 Months" |
| purpose | enum | Required, one of 8 values | "Medical" |
| purpose_other | string | Required if purpose="Other", 2-200 chars | "Home renovation" |

#### Financial Section
| Field | Type | Validation | Example |
|-------|------|-----------|---------|
| existing_loans | enum | Required, "Yes" or "No" | "Yes" |
| number_of_loans | number | Required if existing_loans="Yes", >= 0 | 2 |
| existing_emi | number | Required if existing_loans="Yes", >= 0 | 25000 |
| monthly_expenses | number | Required, >= 0 | 50000 |

---

## Enum Values

### Indian States (27 values)
```
Andhra Pradesh, Arunachal Pradesh, Assam, Bihar, Chhattisgarh, Goa, Gujarat,
Haryana, Himachal Pradesh, Jharkhand, Karnataka, Kerala, Madhya Pradesh,
Maharashtra, Manipur, Meghalaya, Mizoram, Nagaland, Odisha, Punjab,
Rajasthan, Sikkim, Tamil Nadu, Telangana, Tripura, Uttar Pradesh,
Uttarakhand, West Bengal
```

### Gender (4 values)
```
Male, Female, Other, Prefer not to say
```

### Marital Status (4 values)
```
Single, Married, Divorced, Widowed
```

### Residence Type (5 values)
```
Owned, Rented, Family Owned, Company Provided, Other
```

### Employment Type (7 values)
```
Salaried, Self Employed, Business Owner, Freelancer, Student, Unemployed, Other
```

### Experience (5 values)
```
Less than 1 year, 1–3 years, 3–5 years, 5–10 years, More than 10 years
```

### Loan Type (6 values)
```
Personal Loan, Home Loan, Vehicle Loan, Education Loan, Business Loan, Other
```

### Loan Tenure (9 values)
```
6 Months, 12 Months, 18 Months, 24 Months, 36 Months, 48 Months, 60 Months, 84 Months, 120 Months
```

### Loan Purpose (8 values)
```
Medical, Education, Home Improvement, Vehicle Purchase, Business, Personal Expenses, Debt Consolidation, Other
```

### Application Status
```
Draft (user still filling form)
Submitted (user submitted, awaiting verification)
Pending Verification (verification in progress - Process 2)
Verified (verification complete - Process 2)
Rejected (verification failed or application declined)
Approved (loan approved - Process 3)
```

---

## Error Responses

### Standard Error Format

**400 Bad Request - Validation Error:**
```json
{
  "error": "Validation failed",
  "message": "One or more fields are invalid",
  "details": {
    "email": ["Invalid email format"],
    "pincode": ["Must be exactly 6 digits"],
    "monthly_income": ["Must be greater than 0"]
  }
}
```

**404 Not Found:**
```json
{
  "error": "Application not found",
  "id": "APP-2026-999999"
}
```

**409 Conflict:**
```json
{
  "error": "Cannot perform action",
  "reason": "Application status is 'Submitted', only drafts can be updated"
}
```

**422 Unprocessable Entity - Business Logic Error:**
```json
{
  "error": "Business rule violation",
  "details": {
    "monthly_expenses": "Monthly expenses cannot exceed monthly income"
  }
}
```

**500 Internal Server Error:**
```json
{
  "error": "Internal server error",
  "message": "An unexpected error occurred"
}
```

---

## Application ID Generation

### Format
```
APP-{YEAR}-{SEQUENTIAL_NUMBER}
```

**Examples:**
- `APP-2026-000001` (first application)
- `APP-2026-000042` (42nd application)
- `APP-2026-001234` (1234th application)

### Requirements
- Format is fixed: `APP-2026-{6-digit zero-padded number}`
- Unique for each application
- Generated by backend on creation
- Sequential incrementing
- Not modifiable by client

### Implementation Example (Python/FastAPI)
```python
def generate_application_id(db):
    latest = db.query(Application).order_by(
        Application.created_date.desc()
    ).first()
    
    if latest:
        # Extract number from latest ID
        latest_num = int(latest.id.split('-')[-1])
        new_num = latest_num + 1
    else:
        new_num = 1
    
    return f"APP-2026-{new_num:06d}"
```

---

## Request Headers

### Recommended Headers

```
Content-Type: application/json
Accept: application/json
X-Request-ID: [unique-id-for-tracing]
Authorization: Bearer [auth-token]  (for authenticated endpoints)
```

### CORS Configuration

For frontend at `http://localhost:3000`:

```
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Request-ID
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400
```

---

## Pagination

### Query Parameters
```
?limit=20       # Default: 20, Max: 100
?offset=0       # Default: 0
```

### Response Format
```json
{
  "total": 1234,
  "count": 20,
  "limit": 20,
  "offset": 0,
  "applications": [
    { /* ... */ },
    { /* ... */ }
  ]
}
```

---

## Filtering & Search

### Supported Filters

```
GET /api/applications?status=Submitted
GET /api/applications?loan_type=Personal%20Loan
GET /api/applications?status=Submitted&loan_type=Home%20Loan
GET /api/applications?search=John%20Doe
GET /api/applications?created_after=2026-09-01&created_before=2026-09-30
```

### Search Behavior
- Searches across: applicant name, email, mobile, application ID
- Case-insensitive
- Partial matching supported

---

## Rate Limiting (Recommended)

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1694000000
```

**Suggested Limits:**
- 1000 requests per hour per IP
- 10 requests per second
- 100 requests per day per application

---

## Database Schema (SQL Example)

```sql
CREATE TABLE applications (
  id VARCHAR(20) PRIMARY KEY,
  applicant_full_name VARCHAR(100) NOT NULL,
  applicant_dob DATE NOT NULL,
  applicant_gender VARCHAR(20) NOT NULL,
  applicant_mobile VARCHAR(10) NOT NULL,
  applicant_email VARCHAR(100) NOT NULL,
  applicant_marital_status VARCHAR(20) NOT NULL,
  
  address_current_address TEXT NOT NULL,
  address_city VARCHAR(50) NOT NULL,
  address_state VARCHAR(50) NOT NULL,
  address_pincode VARCHAR(6) NOT NULL,
  address_residence_type VARCHAR(30) NOT NULL,
  
  employment_type VARCHAR(30) NOT NULL,
  employment_employer_name VARCHAR(100),
  employment_designation VARCHAR(50),
  employment_experience VARCHAR(30),
  employment_monthly_income DECIMAL(12, 2),
  
  loan_type VARCHAR(30) NOT NULL,
  loan_requested_amount DECIMAL(15, 2) NOT NULL,
  loan_tenure VARCHAR(20) NOT NULL,
  loan_purpose VARCHAR(50) NOT NULL,
  loan_purpose_other VARCHAR(200),
  
  financial_existing_loans VARCHAR(3) NOT NULL,
  financial_number_of_loans INT,
  financial_existing_emi DECIMAL(12, 2),
  financial_monthly_expenses DECIMAL(12, 2) NOT NULL,
  
  status VARCHAR(30) NOT NULL DEFAULT 'Draft',
  created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_status (status),
  INDEX idx_loan_type (loan_type),
  INDEX idx_created_date (created_date)
);
```

---

## Next Process Integration

### Process 2: Verification Phase

New endpoints (will be added):
```
POST /api/applications/{application_id}/verify
POST /api/applications/{application_id}/upload-document
GET /api/applications/{application_id}/verification-status
```

New status values:
```
Pending Verification
Verification In Progress
Verified
Verification Failed
```

The Application object will remain the same, only status field will change.

---

## Version History

### v1.0 (Current)
- Basic application creation
- Form validation
- Status: Draft, Submitted
- No verification

### v1.1 (Future)
- Document upload
- KYC verification
- Status tracking

### v2.0 (Future)
- Approval workflow
- Disbursement tracking
- Reporting dashboard

---

For questions or clarifications, refer to README.md or SETUP.md
