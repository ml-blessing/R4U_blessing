# Quick Setup Guide

## 🚀 Recommended: Run Everything with 1 Command

You can run the entire full-stack project (Python FastAPI Backend + React Vite Frontend + Database + CSV Datasets) using the unified runner:

```bash
python app.py
```

### What `python app.py` does automatically:
1. **Environment Checks**: Verifies Python (v3.8+) and Node.js/npm.
2. **Auto-installs dependencies**: Automatically runs `npm install` if `node_modules` is missing.
3. **Launches FastAPI Backend**: Starts the Python API server on `http://localhost:5000`.
4. **Launches React Vite Frontend**: Starts the UI dev server on `http://localhost:5173`.
5. **Opens Browser**: Automatically opens `http://localhost:5173` in your default browser.
6. **Graceful Shutdown**: Press `Ctrl+C` once to terminate all backend and frontend background processes cleanly.

---

## Alternative Setup Methods

### 2. Install Dependencies
```bash
npm install lucide-react
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

### 3. Configure Tailwind
Edit `tailwind.config.js`:
```javascript
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

### 4. Add Tailwind directives
In `src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 5. Copy the component
Copy `loan-application-erp.jsx` to `src/components/`

### 6. Update App.jsx
```jsx
import LoanApplicationERP from './components/loan-application-erp';

function App() {
  return <LoanApplicationERP />;
}

export default App;
```

### 7. Run
```bash
npm start
```

---

## Option B: Use in Existing React + Tailwind Project

### 1. Install lucide-react if not already installed
```bash
npm install lucide-react
```

### 2. Copy Component
Copy `loan-application-erp.jsx` to your components folder

### 3. Import and Use
```jsx
import LoanApplicationERP from './path/to/loan-application-erp';

export default function Dashboard() {
  return (
    <div>
      <LoanApplicationERP />
    </div>
  );
}
```

---

## Option C: Vite Setup (Faster alternative)

### 1. Create Vite project
```bash
npm create vite@latest loan-erp -- --template react
cd loan-erp
npm install
```

### 2. Install dependencies
```bash
npm install lucide-react
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

### 3. Configure Tailwind
Same as Option A, step 3

### 4. Add Tailwind CSS
In `src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 5. Copy and use component
Same as Option A, steps 5-6

### 6. Run
```bash
npm run dev
```

---

## Testing the Component

### Local Testing with Mock Data
The component comes with mock data pre-loaded:
- 4 sample applications
- Pre-filled dashboard stats
- Sample entries in applications list

### Test Flows

#### 1. Create New Application
1. Click "New Application" in sidebar
2. Fill in each step (validation is automatic)
3. Review the summary page
4. Submit application
5. See success page with generated Application ID

#### 2. Save as Draft
1. Start filling application
2. Click "Save Draft" on any step
3. Go to "Applications" page
4. See the draft listed

#### 3. View Applications
1. Go to "Applications" page
2. Test filters:
   - Search by name
   - Filter by loan type
   - Filter by status
3. View application details in table

#### 4. Dashboard Stats
1. Check total applications count
2. Verify draft/submitted breakdown
3. Review recent applications table

---

## Validation Testing

### Test each validation:

**Applicant Details:**
- Try submitting with empty Full Name → should show error
- Enter invalid email → should show error
- Enter mobile number with < 10 digits → should show error
- Missing any required field → should show error

**Address:**
- Enter 5-digit pincode → should show error
- Leave State empty → should show error
- Enter 6-digit pincode → should pass

**Employment:**
- Select Salaried → should show Employer, Designation, Experience, Income fields
- Select Business Owner → should show Business Name, Type, Experience, Income
- Leave Income empty → should show error
- Enter negative income → should show error

**Loan Details:**
- Enter 0 or negative loan amount → should show error
- Select "Other" purpose → should show text input for explanation

**Financial:**
- Select "Yes" for existing loans → should show Number and EMI fields
- Select "No" → should hide those fields
- Enter negative monthly expenses → should show error

---

## API Integration Checklist

When ready to connect to backend:

- [ ] Replace `mockApi.saveApplication()` with POST `/api/applications`
- [ ] Replace `mockApi.getApplications()` with GET `/api/applications`
- [ ] Update success page to use real application ID from server
- [ ] Add error handling for API failures
- [ ] Add loading states during API calls
- [ ] Implement authentication/session management
- [ ] Set up CORS if backend is separate domain

### Example: Replacing mock API

**Current (Mock):**
```javascript
const mockApi = {
  saveApplication: function(data) {
    const id = `APP-2026-${String(this.nextApplicationId).padStart(6, '0')}`;
    // ...
  }
};
```

**Replace with (Real API):**
```javascript
const saveApplication = async (data) => {
  const response = await fetch('/api/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return await response.json();
};
```

---

## Customization

### Change Application ID Format
In `loan-application-erp.jsx`, find:
```javascript
const id = `APP-2026-${String(this.nextApplicationId).padStart(6, '0')}`;
```

Change to your format, e.g.:
```javascript
const id = `LOAN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
```

### Change Brand Colors
Replace color classes:
- `bg-blue-600` → Your primary color
- `bg-green-600` → Your success color
- `text-gray-800` → Your text color

### Add/Remove Form Fields
1. Update the form state object:
```javascript
const [formData, setFormData] = useState({
  applicant: {
    // Add new field here
    new_field: ''
  },
  // ...
});
```

2. Add validation in `validateStep()` function

3. Add UI component in the corresponding step function

4. Update data model in backend

---

## Performance Optimization

### For Production:
```bash
npm run build
```

This creates optimized bundle in `dist/` folder.

### Bundle Analysis
```bash
npm install -D source-map-explorer
npm run build
npx source-map-explorer 'dist/assets/*.js'
```

### Performance Tips:
- Component is already ~15KB (minified)
- No external API calls during form filling (all client-side)
- Lazy load validation only when user submits step
- Consider code-splitting if adding more pages

---

## Troubleshooting

### "Module not found: lucide-react"
```bash
npm install lucide-react
```

### "Tailwind CSS not working"
- Check `tailwind.config.js` content path matches your files
- Restart dev server
- Clear cache: `npm cache clean --force`

### "Styles look broken"
- Ensure `index.css` has `@tailwind` directives
- Check Tailwind is installed: `npm list tailwindcss`
- Verify `tailwind.config.js` exists

### Application data not saving
- Currently uses in-memory storage (React state)
- Data resets on page refresh
- For persistence, connect to backend database

### Form validation not working
- Check browser console for JavaScript errors
- Verify field names match `formData` structure
- Check validation rules in `validateStep()` function

---

## Browser DevTools Tips

### Debug Form Data
Open browser console and run:
```javascript
// Logs current form data structure
console.log(JSON.stringify(formData, null, 2));
```

### Test Validation
```javascript
// Test specific validation rule
validateStep(1, formData);
```

### Mock API Data
```javascript
// View all mock applications
console.table(mockApi.getApplications());
```

---

## Next: Backend Integration

Once frontend is working, create backend with:

### Suggested Stack
- **Framework**: FastAPI (Python) or Express (Node.js)
- **Database**: PostgreSQL or MongoDB
- **ORM**: SQLAlchemy or Mongoose
- **Validation**: Pydantic or Joi

### Minimal FastAPI Backend Example
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/applications")
async def create_application(data: dict):
    # Validate and save to database
    application_id = generate_app_id()
    # ... save logic ...
    return {
        "id": application_id,
        **data,
        "status": "Submitted",
        "created_date": datetime.now().isoformat()
    }

@app.get("/api/applications")
async def get_applications():
    # Fetch from database
    return applications_list
```

---

## Segmented CSV Datasets (`./csv_data/`)

Whenever customer applications are submitted, the backend extracts and segregates application data into dedicated CSV datasets located inside the codebase `./csv_data/` folder:

| Dataset File | Description | Target Role / Use Case |
|---|---|---|
| `personal_data.csv` | Customer demographics, residence, employment, and income across all users | Personal verification & underwriting |
| `document_data.csv` | KYC & document records (PAN, Aadhaar, Proof of Income, Bank Statement) | Compliance & KYC auditing |
| `digital_data.csv` | Device, browser, mobile/OS, geolocation & behavioral telemetry (fill time, clicks, keystrokes, pastes) | Fraud detection & device risk analysis |
| `master_applications_data.csv` | Comprehensive master dataset containing all segments | Machine learning training & reporting |

### Downloading Datasets
- **Bank Officers**: Access the **Segmented CSV Datasets & Download Center** directly from the Bank Portfolio Dashboard and Applications Queue to download any segmented CSV file with one click.
- **Developers**: Access the Dataset Center from the Developer Console to audit dataset file size, row counts, and trigger manual synchronization (`POST /api/datasets/sync`).

---

## Support & Questions

Check the main README.md for:
- Full feature documentation
- Architecture details
- API endpoints specification
- Data model structure
- Future process roadmap

Happy building! 🚀
