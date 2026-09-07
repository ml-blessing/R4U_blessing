import pandas as pd
import os

source_csv = r"C:\Users\Dipak\Downloads\loan_application_dataset_10_lakh.csv"
dest_csv = r"c:\Users\Dipak\Downloads\loan-application-erp\loan-application-erp\csv_data\master_applications_data.csv"

print(f"Reading first 10,000 rows from {source_csv}...")
# Read first 10000 rows
df_new = pd.read_csv(source_csv, nrows=10000)

print(f"Mapping columns...")
# Map columns from new schema to old schema
column_mapping = {
    'submission_date': 'created_date',
    'created_by_user': 'created_by',
    'full_legal_name': 'applicant_name',
    'date_of_birth': 'dob',
    'mobile_number': 'mobile',
    'email_address': 'email',
    'employer_business': 'employer_name',
    'designation_role': 'designation',
    'experience_years': 'experience',
    'gross_monthly_income': 'monthly_income',
    'loan_scheme': 'loan_type',
    'principal_amount': 'requested_amount',
    'repayment_tenure_months': 'tenure',
    'loan_purpose': 'purpose',
    'existing_credit_liabilities': 'existing_loans',
    'current_monthly_emi': 'existing_emi',
    'monthly_living_expenses': 'monthly_expenses'
}

df_mapped = df_new.rename(columns=column_mapping)

# Add some default columns to match the target schema that are missing
default_columns = {
    'pan_number': 'N/A',
    'aadhaar_number': 'N/A',
    'id_proof_type': 'N/A',
    'income_proof_type': 'N/A',
    'doc_verification_status': 'Pending',
    'device_type': 'N/A',
    'os': 'N/A',
    'browser_name': 'N/A',
    'ip_address': 'N/A',
    'timezone': 'N/A',
    'form_fill_time_seconds': 0
}

for col, val in default_columns.items():
    if col not in df_mapped.columns:
        df_mapped[col] = val

# Reorder and filter columns to match destination
df_existing = pd.read_csv(dest_csv)
target_columns = df_existing.columns.tolist()

# Ensure all target columns exist, even if missing
for col in target_columns:
    if col not in df_mapped.columns:
        df_mapped[col] = "N/A"

df_mapped = df_mapped[target_columns]

print(f"Appending to {dest_csv}...")
# Append without writing headers
df_mapped.to_csv(dest_csv, mode='a', header=False, index=False)
print("Data successfully appended!")
