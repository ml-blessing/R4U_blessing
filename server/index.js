import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { initDatabase, query, getDbInfo } from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'loan_erp_jwt_secret_key_2026';

app.use(cors());
app.use(express.json());

// Helper to normalize JSON columns between pg and PGlite
function parseRow(row) {
  if (!row) return null;
  const parseField = (val) => {
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch (e) {
        return val;
      }
    }
    return val;
  };

  return {
    ...row,
    applicant: parseField(row.applicant),
    address: parseField(row.address),
    employment: parseField(row.employment),
    loan: parseField(row.loan),
    financial: parseField(row.financial),
  };
}

// 1. Health & Database Info
app.get('/api/health', async (req, res) => {
  try {
    const info = getDbInfo();
    const usersCountRes = await query('SELECT COUNT(*) as count FROM users');
    const appsCountRes = await query('SELECT COUNT(*) as count FROM applications');

    res.json({
      status: 'online',
      database: {
        engine: info.dbType,
        status: info.status,
        usersCount: parseInt(usersCountRes.rows[0]?.count || 0, 10),
        applicationsCount: parseInt(appsCountRes.rows[0]?.count || 0, 10)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Auth: Register (Save new credentials in PostgreSQL)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, full_name, role = 'Loan Officer' } = req.body;

    if (!username || !email || !password || !full_name) {
      return res.status(400).json({ error: 'Username, email, password, and full name are required.' });
    }

    // Check if username or email already exists
    const existing = await query(
      'SELECT id, username, email FROM users WHERE username = $1 OR email = $2',
      [username.trim(), email.trim()]
    );

    if (existing.rows.length > 0) {
      const match = existing.rows[0];
      const conflictField = match.username.toLowerCase() === username.trim().toLowerCase() ? 'Username' : 'Email';
      return res.status(409).json({ error: `${conflictField} already exists in database.` });
    }

    // Hash password and store credentials in PostgreSQL
    const passwordHash = await bcrypt.hash(password, 10);
    const insertRes = await query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, full_name, role, created_at`,
      [username.trim(), email.trim().toLowerCase(), passwordHash, full_name.trim(), role]
    );

    const newUser = insertRes.rows[0];
    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User credentials saved successfully in PostgreSQL',
      token,
      user: newUser
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to save credentials: ' + err.message });
  }
});

// 3. Auth: Login (Verify and use credentials from PostgreSQL)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username/email and password are required.' });
    }

    // Search user in PostgreSQL by username or email
    const userRes = await query(
      'SELECT id, username, email, password_hash, full_name, role, created_at FROM users WHERE username = $1 OR email = $1',
      [username.trim()]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials. User not found in database.' });
    }

    const user = userRes.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid password. Authentication failed.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Authentication failed: ' + err.message });
  }
});

// 4. Auth: List Saved Credentials
app.get('/api/auth/credentials', async (req, res) => {
  try {
    const usersRes = await query(
      'SELECT id, username, email, full_name, role, created_at FROM users ORDER BY id ASC'
    );
    res.json({ credentials: usersRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Applications: Get All Applications from PostgreSQL
app.get('/api/applications', async (req, res) => {
  try {
    const { status, loan_type, search } = req.query;
    let sql = 'SELECT * FROM applications ORDER BY created_at DESC';
    const result = await query(sql);

    let list = result.rows.map(parseRow);

    if (status && status !== 'All') {
      list = list.filter(app => app.status.toLowerCase() === status.toLowerCase());
    }

    if (loan_type && loan_type !== 'All') {
      list = list.filter(app => app.loan?.loan_type?.toLowerCase() === loan_type.toLowerCase());
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(app =>
        app.id?.toLowerCase().includes(q) ||
        app.applicant?.full_name?.toLowerCase().includes(q) ||
        app.applicant?.email?.toLowerCase().includes(q) ||
        app.applicant?.mobile?.includes(q)
      );
    }

    res.json({
      total: list.length,
      applications: list
    });
  } catch (err) {
    console.error('Get applications error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Applications: Get Single Application
app.get('/api/applications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM applications WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found', id });
    }
    res.json(parseRow(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Applications: Create New Application in PostgreSQL
app.post('/api/applications', async (req, res) => {
  try {
    const data = req.body;
    const countRes = await query('SELECT COUNT(*) as count FROM applications');
    const count = parseInt(countRes.rows[0]?.count || 0, 10) + 1;
    const id = `APP-2026-${String(count).padStart(6, '0')}`;
    const status = data.status || 'Submitted';
    const created_date = new Date().toISOString().split('T')[0];
    const created_by = data.created_by || 'system';

    await query(
      `INSERT INTO applications (id, applicant, address, employment, loan, financial, status, created_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        JSON.stringify(data.applicant || {}),
        JSON.stringify(data.address || {}),
        JSON.stringify(data.employment || {}),
        JSON.stringify(data.loan || {}),
        JSON.stringify(data.financial || {}),
        status,
        created_date,
        created_by
      ]
    );

    const created = await query('SELECT * FROM applications WHERE id = $1', [id]);
    res.status(201).json(parseRow(created.rows[0]));
  } catch (err) {
    console.error('Create application error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. Applications: Update Draft
app.put('/api/applications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const existing = await query('SELECT status FROM applications WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    await query(
      `UPDATE applications SET
        applicant = $1,
        address = $2,
        employment = $3,
        loan = $4,
        financial = $5,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [
        JSON.stringify(data.applicant || {}),
        JSON.stringify(data.address || {}),
        JSON.stringify(data.employment || {}),
        JSON.stringify(data.loan || {}),
        JSON.stringify(data.financial || {}),
        id
      ]
    );

    const updated = await query('SELECT * FROM applications WHERE id = $1', [id]);
    res.json(parseRow(updated.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Applications: Submit Draft
app.post('/api/applications/:id/submit', async (req, res) => {
  try {
    const { id } = req.params;
    await query(
      "UPDATE applications SET status = 'Submitted', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [id]
    );
    const updated = await query('SELECT * FROM applications WHERE id = $1', [id]);
    res.json(parseRow(updated.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Dashboard Stats
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const all = await query('SELECT id, status, created_date, loan FROM applications');
    const today = new Date().toISOString().split('T')[0];

    const apps = all.rows.map(parseRow);
    const total = apps.length;
    const draft = apps.filter(a => a.status === 'Draft').length;
    const submitted = apps.filter(a => a.status === 'Submitted').length;
    const todayCount = apps.filter(a => a.created_date === today).length;

    res.json({
      total,
      draft,
      submitted,
      today: todayCount,
      recent: apps.slice(0, 5)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server & Initialize Database
async function start() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`Backend API Server running with PostgreSQL on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
