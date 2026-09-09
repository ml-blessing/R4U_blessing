import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

let client = null;
let dbType = 'unknown';

export async function initDatabase() {
  const {
    PGHOST = 'localhost',
    PGPORT = 5432,
    PGUSER = 'postgres',
    PGPASSWORD = 'postgres',
    PGDATABASE = 'loan_erp',
    DATABASE_URL,
    DATA_DIR = './data/postgres'
  } = process.env;

  // 1. First attempt to connect to native PostgreSQL
  try {
    const poolConfig = DATABASE_URL
      ? { connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 }
      : {
          host: PGHOST,
          port: Number(PGPORT),
          user: PGUSER,
          password: PGPASSWORD,
          database: PGDATABASE,
          connectionTimeoutMillis: 2000
        };

    const nativePool = new pg.Pool(poolConfig);
    const testRes = await nativePool.query('SELECT 1 as connected');
    if (testRes.rows.length > 0) {
      client = nativePool;
      dbType = 'Native PostgreSQL';
      console.log(`Connected successfully to Native PostgreSQL at ${PGHOST}:${PGPORT}/${PGDATABASE}`);
    }
  } catch (err) {
    console.log(`Native PostgreSQL not reachable (${err.message}). Using local embedded PostgreSQL (PGlite)...`);
  }

  // 2. If native PostgreSQL is not available, use local embedded PostgreSQL (PGlite)
  if (!client) {
    try {
      const resolvedPath = path.resolve(DATA_DIR);
      fs.mkdirSync(resolvedPath, { recursive: true });
      const pglite = new PGlite(resolvedPath);
      await pglite.query('SELECT 1');
      client = pglite;
      dbType = 'Local Embedded PostgreSQL (PGlite)';
      console.log(`Initialized local embedded PostgreSQL at ${resolvedPath}`);
    } catch (pgliteErr) {
      console.error('Failed to initialize local embedded PostgreSQL:', pgliteErr);
      throw pgliteErr;
    }
  }

  // 3. Run schema migrations
  await runMigrations();

  return { client, dbType };
}

export async function query(text, params = []) {
  if (!client) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }

  try {
    // Both pg.Pool and PGlite implement .query(sql, params)
    const result = await client.query(text, params);
    // Ensure rows array exists
    const rows = result.rows || [];
    return {
      rows,
      rowCount: result.rowCount !== undefined ? result.rowCount : rows.length
    };
  } catch (err) {
    console.error(`Database query error [${text}]:`, err);
    throw err;
  }
}

export function getDbInfo() {
  return {
    dbType,
    status: client ? 'connected' : 'disconnected'
  };
}

async function runMigrations() {
  console.log('Running PostgreSQL schema migrations...');

  // Users Table (Credentials)
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'Loan Officer',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Applications Table
  await query(`
    CREATE TABLE IF NOT EXISTS applications (
      id VARCHAR(50) PRIMARY KEY,
      applicant JSONB NOT NULL,
      address JSONB NOT NULL,
      employment JSONB NOT NULL,
      loan JSONB NOT NULL,
      financial JSONB NOT NULL,
      status VARCHAR(50) NOT NULL,
      created_date VARCHAR(20) NOT NULL,
      created_by VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default user credentials if none exist
  const existingUsers = await query('SELECT COUNT(*) as count FROM users');
  const userCount = parseInt(existingUsers.rows[0].count, 10);

  if (userCount === 0) {
    console.log('Seeding default credentials in PostgreSQL...');
    const hashedAdminPass = await bcrypt.hash('admin123', 10);
    const hashedOfficerPass = await bcrypt.hash('officer123', 10);
    const hashedManagerPass = await bcrypt.hash('manager123', 10);

    await query(
      `INSERT INTO users (username, email, password_hash, full_name, role) VALUES 
       ($1, $2, $3, $4, $5),
       ($6, $7, $8, $9, $10),
       ($11, $12, $13, $14, $15);`,
      [
        'admin', 'admin@loanerp.local', hashedAdminPass, 'System Administrator', 'Admin',
        'officer', 'officer@loanerp.local', hashedOfficerPass, 'Sarah Jenkins', 'Loan Officer',
        'manager', 'manager@loanerp.local', hashedManagerPass, 'Vikram Malhotra', 'Credit Manager'
      ]
    );
    console.log('Default credentials seeded: admin / admin123, officer / officer123, manager / manager123');
  }

  // Seed default applications if none exist
  const existingApps = await query('SELECT COUNT(*) as count FROM applications');
  const appCount = parseInt(existingApps.rows[0].count, 10);

  if (appCount === 0) {
    console.log('Seeding initial loan applications in PostgreSQL...');
    const initialApps = [
      {
        id: 'APP-2026-000001',
        applicant: { full_name: 'Rajesh Kumar', dob: '1988-04-12', gender: 'Male', mobile: '9876543210', email: 'rajesh.kumar@example.com', marital_status: 'Married' },
        address: { current_address: '42 MG Road, Indiranagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560038', residence_type: 'Owned' },
        employment: { employment_type: 'Salaried', employer_name: 'Infosys Ltd', designation: 'Senior Consultant', experience: '5–10 years', monthly_income: 120000 },
        loan: { loan_type: 'Personal Loan', requested_amount: 500000, tenure: '24 Months', purpose: 'Home Improvement' },
        financial: { existing_loans: 'No', number_of_loans: 0, existing_emi: 0, monthly_expenses: 35000 },
        status: 'Submitted',
        created_date: '2026-09-01',
        created_by: 'officer'
      },
      {
        id: 'APP-2026-000002',
        applicant: { full_name: 'Priya Sharma', dob: '1992-09-23', gender: 'Female', mobile: '9812345678', email: 'priya.sharma@example.com', marital_status: 'Single' },
        address: { current_address: 'Flat 301, Palm Grove, Bandra West', city: 'Mumbai', state: 'Maharashtra', pincode: '400050', residence_type: 'Rented' },
        employment: { employment_type: 'Business Owner', employer_name: 'Sharma Design Studio', designation: 'Founder', experience: '3–5 years', monthly_income: 250000 },
        loan: { loan_type: 'Home Loan', requested_amount: 3000000, tenure: '120 Months', purpose: 'Home Improvement' },
        financial: { existing_loans: 'Yes', number_of_loans: 1, existing_emi: 22000, monthly_expenses: 60000 },
        status: 'Draft',
        created_date: '2026-09-02',
        created_by: 'admin'
      },
      {
        id: 'APP-2026-000003',
        applicant: { full_name: 'Amit Patel', dob: '1985-11-05', gender: 'Male', mobile: '9923456789', email: 'amit.patel@example.com', marital_status: 'Married' },
        address: { current_address: '15 Nehru Nagar', city: 'Ahmedabad', state: 'Gujarat', pincode: '380015', residence_type: 'Owned' },
        employment: { employment_type: 'Salaried', employer_name: 'Cadila Healthcare', designation: 'General Manager', experience: 'More than 10 years', monthly_income: 180000 },
        loan: { loan_type: 'Vehicle Loan', requested_amount: 800000, tenure: '48 Months', purpose: 'Vehicle Purchase' },
        financial: { existing_loans: 'No', number_of_loans: 0, existing_emi: 0, monthly_expenses: 45000 },
        status: 'Submitted',
        created_date: '2026-09-03',
        created_by: 'officer'
      },
      {
        id: 'APP-2026-000004',
        applicant: { full_name: 'Neha Singh', dob: '1995-02-18', gender: 'Female', mobile: '9734567890', email: 'neha.singh@example.com', marital_status: 'Single' },
        address: { current_address: 'Sector 62, Green Valley Apts', city: 'Noida', state: 'Uttar Pradesh', pincode: '201309', residence_type: 'Family Owned' },
        employment: { employment_type: 'Salaried', employer_name: 'Tech Mahindra', designation: 'Software Engineer', experience: '1–3 years', monthly_income: 85000 },
        loan: { loan_type: 'Education Loan', requested_amount: 1500000, tenure: '60 Months', purpose: 'Education' },
        financial: { existing_loans: 'No', number_of_loans: 0, existing_emi: 0, monthly_expenses: 25000 },
        status: 'Submitted',
        created_date: '2026-09-04',
        created_by: 'officer'
      }
    ];

    for (const app of initialApps) {
      await query(
        `INSERT INTO applications (id, applicant, address, employment, loan, financial, status, created_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          app.id,
          JSON.stringify(app.applicant),
          JSON.stringify(app.address),
          JSON.stringify(app.employment),
          JSON.stringify(app.loan),
          JSON.stringify(app.financial),
          app.status,
          app.created_date,
          app.created_by
        ]
      );
    }
    console.log('Sample applications seeded into PostgreSQL.');
  }
}
