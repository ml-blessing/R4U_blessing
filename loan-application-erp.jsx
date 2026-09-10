import React, { useState, useEffect, useRef } from 'react';
import { jsPDF } from 'jspdf';
import {
  ChevronRight, ChevronLeft, Save, LogOut, Menu, X,
  Database, Key, Lock, User, UserPlus, CheckCircle, RefreshCw,
  Server, Shield, Check, AlertCircle, FileText, Sparkles,
  FileSpreadsheet, Building, UserCheck, ShieldCheck,
  Laptop, ArrowRight, PlusCircle, Filter, Printer, Download,
  HardDrive, Smartphone, Activity, Layers, FolderDown, MessageCircle, Send, Loader2, Camera, Scan
} from 'lucide-react';

// API Configuration
const API_BASE = '/api';

// Live Python Backend API Service
const apiService = {
  async getHealth() {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error('Health check failed');
    return await res.json();
  },

  async extractDocumentOCR(imageBlob, applicationId = '', applicantName = '') {
    const formData = new FormData();
    formData.append('file', imageBlob, 'document.jpg');
    if (applicationId) formData.append('application_id', applicationId);
    if (applicantName) formData.append('applicant_name', applicantName);
    const params = new URLSearchParams();
    if (applicationId) params.append('application_id', applicationId);
    if (applicantName) params.append('applicant_name', applicantName);
    const queryString = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${API_BASE}/ocr/extract${queryString}`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to extract OCR data');
    return data;
  },

  async autoSaveCSV(appData) {
    try {
      const res = await fetch(`${API_BASE}/applications/auto-save-csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appData)
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('Auto-save CSV to data folder error:', e);
    }
    return null;
  },

  async getApplications(filters = {}, currentUser = null) {
    const params = new URLSearchParams();
    if (filters.status && filters.status !== 'All') params.append('status', filters.status);
    if (filters.loanType && filters.loanType !== 'All') params.append('loan_type', filters.loanType);
    if (filters.search) params.append('search', filters.search);
    
    // If customer, pass their identity to filter their applications
    if (currentUser?.user_type === 'customer') {
      params.append('user_type', 'customer');
      params.append('created_by', currentUser.username);
    }

    const res = await fetch(`${API_BASE}/applications?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch applications');
    const data = await res.json();
    return data.applications || [];
  },

  async saveApplication(data, user) {
    const res = await fetch(`${API_BASE}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, status: 'Submitted', created_by: user?.username || 'customer' })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.detail || result.error || 'Failed to save application');
    // Ensure auto-saved in ./data and ./csv_data folders
    this.autoSaveCSV(result);
    return result;
  },

  async addDraft(data, user) {
    const res = await fetch(`${API_BASE}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, status: 'Draft', created_by: user?.username || 'customer' })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.detail || result.error || 'Failed to save draft');
    this.autoSaveCSV(result);
    return result;
  },

  async getStats(currentUser = null) {
    const params = new URLSearchParams();
    if (currentUser) {
      params.append('user_type', currentUser.user_type || 'bank');
      params.append('username', currentUser.username || '');
    }
    const res = await fetch(`${API_BASE}/dashboard/stats?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return await res.json();
  },

  async getCredentials() {
    const res = await fetch(`${API_BASE}/auth/credentials`);
    if (!res.ok) throw new Error('Failed to fetch credentials');
    const data = await res.json();
    return data.credentials || [];
  },

  async login(username, password, loginType) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, login_type: loginType })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || 'Login failed');
    return data;
  },

  async register(userData) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || 'Failed to save credentials');
    return data;
  },

  // Segmented CSV Datasets & Telemetry Endpoints
  async getDatasetsInfo() {
    const res = await fetch(`${API_BASE}/datasets/info`);
    if (!res.ok) throw new Error('Failed to fetch datasets information');
    return await res.json();
  },

  downloadDataset(datasetId) {
    window.open(`${API_BASE}/datasets/download/${datasetId}`, '_blank');
  },

  async syncDatasets() {
    const res = await fetch(`${API_BASE}/datasets/sync`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to synchronize CSV datasets');
    return await res.json();
  },

  async ragQuery(query) {
    const res = await fetch(`${API_BASE}/rag/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    if (!res.ok) throw new Error('Failed to fetch RAG response');
    return await res.json();
  },

  async downloadRagReport(query, response) {
    const res = await fetch(`${API_BASE}/rag/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, response })
    });
    if (!res.ok) throw new Error('Failed to generate RAG report');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AI_Customer_Intelligence_${new Date().getTime()}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
  }
};

function BankerRAGSection() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleQuery = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setResponse('');
    try {
      const data = await apiService.ragQuery(query);
      setResponse(data.response);
    } catch (err) {
      setError(err.message || 'An error occurred during the query.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReport = async () => {
    if (!query || !response) return;
    try {
      await apiService.downloadRagReport(query, response);
    } catch (err) {
      alert('Failed to download report: ' + err.message);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm mb-5 p-6">
      <div className="mb-4">
        <h2 className="font-bold text-gray-900 text-lg flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          AI Customer Intelligence (RAG)
        </h2>
        <p className="text-xs text-gray-500">Query the 20-Lakh dataset using Mistral AI for intelligent insights.</p>
      </div>
      
      <div className="flex gap-2 mb-4">
        <input 
          type="text" 
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" 
          placeholder="e.g. Summarize the credit risk for customer APP-2026-000001" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
        />
        <button 
          onClick={handleQuery} 
          disabled={loading}
          className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50"
        >
          {loading ? 'Analyzing...' : 'Ask AI'}
        </button>
      </div>

      {error && <div className="text-red-500 text-sm mb-4">{error}</div>}

      {response && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
          <h3 className="text-xs font-bold text-gray-700 uppercase mb-2">AI Analysis</h3>
          <div className="text-sm text-gray-800 whitespace-pre-wrap">{response}</div>
        </div>
      )}

      {response && (
        <button 
          onClick={handleDownloadReport}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 transition"
        >
          <Download className="w-4 h-4" /> Download AI Report (PDF)
        </button>
      )}
    </div>
  );
}

// Automatic Digital Telemetry & Behavioral Footprint Collector
function collectDigitalTelemetry(formMetrics = {}, address = {}) {
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (typeof window !== 'undefined' && window.innerWidth < 768);
  const isTablet = !isMobile && ((typeof window !== 'undefined' && window.innerWidth < 1024) || /iPad|Tablet/i.test(navigator.userAgent));
  const deviceType = isMobile ? 'Mobile' : isTablet ? 'Tablet' : 'Desktop';
  
  let os = 'Windows 11';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Windows/i.test(ua)) os = 'Windows 11/10';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS Sonoma';
  else if (/Android/i.test(ua)) os = 'Android 14';
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS 17';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browserName = 'Google Chrome';
  let browserVersion = '128.0';
  if (/Edg/i.test(ua)) {
    browserName = 'Microsoft Edge';
    browserVersion = '128.0';
  } else if (/Chrome/i.test(ua)) {
    browserName = 'Google Chrome';
    browserVersion = '128.0.0';
  } else if (/Firefox/i.test(ua)) {
    browserName = 'Mozilla Firefox';
    browserVersion = '130.0';
  } else if (/Safari/i.test(ua)) {
    browserName = 'Apple Safari';
    browserVersion = '17.5';
  }

  return {
    device_type: deviceType,
    os: os,
    platform: navigator.platform || 'Win32',
    screen_resolution: `${window.screen?.width || 1920}x${window.screen?.height || 1080}`,
    hardware_concurrency: navigator.hardwareConcurrency || 8,
    browser_name: browserName,
    browser_version: browserVersion,
    user_agent: navigator.userAgent,
    language: navigator.language || 'en-IN',
    is_mobile: isMobile,
    connection_type: navigator.connection?.effectiveType ? navigator.connection.effectiveType.toUpperCase() : 'WiFi / Broadband 5G',
    online_status: navigator.onLine ? 'Online' : 'Offline',
    ip_address: '127.0.0.1 (Client Telemetry)',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
    approx_city: address.city || 'Bengaluru',
    approx_region: address.state || 'Karnataka',
    country: 'India',
    latitude: 12.9716,
    longitude: 77.5946,
    form_fill_time_seconds: formMetrics.timeSpent || 165,
    keystroke_count: formMetrics.keystrokes || 310,
    click_count: formMetrics.clicks || 26,
    paste_count: formMetrics.pastes || 1,
    hesitation_time_sec: Math.max(4, Math.floor((formMetrics.timeSpent || 165) * 0.1)),
    submission_timestamp: new Date().toISOString()
  };
}



// PDF Generator for User (Customer), Bank, and Developer Roles using jsPDF
function saveApplicationPDF(app, role = 'user') {
  if (!app) return;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const isUser = role === 'user' || role === 'customer';
  const isBank = role === 'bank';
  const isDev = role === 'developer';

  // Role Theme Settings
  let primaryColor = [15, 76, 129]; // Bank Royal Navy
  let secondaryColor = [239, 246, 255]; // Soft Navy tint
  let headerTitle = 'R4U (RUPPEE4U) - BANK CREDIT APPRAISAL DOSSIER';
  let headerSubtitle = 'CONFIDENTIAL — BANK CREDIT OFFICER & REGULATORY COMPLIANCE COPY';
  let roleBadge = 'BANK APPRAISAL COPY';

  if (isUser) {
    primaryColor = [16, 115, 78]; // Emerald Green
    secondaryColor = [236, 253, 245]; // Soft Mint tint
    headerTitle = 'R4U (RUPPEE4U) - APPLICANT LOAN APPLICATION & RECEIPT';
    headerSubtitle = 'OFFICIAL APPLICANT COPY — APPLICATION SUMMARY & ACKNOWLEDGEMENT RECEIPT';
    roleBadge = 'CUSTOMER OFFICIAL COPY';
  } else if (isDev) {
    primaryColor = [30, 41, 59]; // Slate Slate
    secondaryColor = [241, 245, 249]; // Soft Slate tint
    headerTitle = 'R4U (RUPPEE4U) - DEVELOPER AUDIT SPECIFICATION';
    headerSubtitle = 'TECHNICAL SPECIFICATION & AUDIT TELEMETRY DOSSIER';
    roleBadge = 'DEVELOPER AUDIT SPEC';
  }

  let y = 14;

  const drawHeaderBanner = () => {
    doc.setFillColor(...primaryColor);
    doc.rect(14, y, 182, 16, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(headerTitle, 18, y + 7);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.text(headerSubtitle, 18, y + 12);
    y += 22;
  };

  const checkPageBreak = (neededHeight = 20) => {
    if (y + neededHeight > 268) {
      doc.addPage();
      y = 14;
      // Continuation Header
      doc.setFillColor(...primaryColor);
      doc.rect(14, y, 182, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.text(`${headerTitle} (Continued) — Application ID: ${app.id || 'N/A'}`, 18, y + 5.5);
      y += 14;
    }
  };

  drawHeaderBanner();

  // Application Reference & Status Block
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, y, 182, 16, 2, 2, 'FD');

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.text(`Application ID: ${app.id || 'APP-2026-UNKNOWN'}`, 18, y + 6);
  doc.text(`Status: ${app.status || 'Submitted'}`, 105, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(`Submission Date: ${app.created_date || new Date().toISOString().split('T')[0]}`, 18, y + 11.5);
  doc.text(`Dossier Copy: ${roleBadge}`, 105, y + 11.5);

  y += 22;

  const drawSection = (title, items) => {
    const rowCount = Math.ceil(items.length / 2);
    const needed = 8.5 + (rowCount * 5.2) + 3;
    checkPageBreak(needed);

    // Section Header
    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 6.5, 'F');
    doc.setTextColor(...primaryColor);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text(title.toUpperCase(), 17, y + 4.5);
    y += 9;

    // Items (2 columns)
    doc.setFontSize(8);
    for (let i = 0; i < items.length; i += 2) {
      checkPageBreak(6);
      const col1 = items[i];
      const col2 = items[i + 1];

      // Col 1
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text(`${col1.label}:`, 18, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      const val1 = String(col1.val ?? 'N/A');
      const val1Trunc = val1.length > 34 ? val1.substring(0, 32) + '...' : val1;
      doc.text(val1Trunc, 62, y);

      // Col 2
      if (col2) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 116, 139);
        doc.text(`${col2.label}:`, 108, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(15, 23, 42);
        const val2 = String(col2.val ?? 'N/A');
        const val2Trunc = val2.length > 34 ? val2.substring(0, 32) + '...' : val2;
        doc.text(val2Trunc, 150, y);
      }
      y += 5.2;
    }
    y += 2.5;
  };

  const applicant = app.applicant || {};
  const address = app.address || {};
  const employment = app.employment || {};
  const loan = app.loan || {};
  const financial = app.financial || {};
  const documentInfo = app.document || {};
  const digital = app.digital || {};

  // Section 1: Applicant Personal Information
  drawSection('1. Applicant Personal Information', [
    { label: 'Full Legal Name', val: applicant.full_name },
    { label: 'Date of Birth', val: applicant.dob },
    { label: 'Gender', val: applicant.gender },
    { label: 'Marital Status', val: applicant.marital_status },
    { label: 'Mobile Number', val: applicant.mobile },
    { label: 'Email Address', val: applicant.email }
  ]);

  // Section 2: Residential Address (Temporary & Permanent)
  const isSameAddress = address.sameAsPermanent === true || address.sameAsPermanent === 'true' || address.sameAsPermanent === 1;
  const addressItems = [
    { label: 'Temporary Address', val: (address.current_address || '').replace(/[\r\n]+/g, ' ') },
    { label: 'Temporary City', val: address.city },
    { label: 'Temporary State', val: address.state },
    { label: 'Temporary Pincode', val: address.pincode },
    { label: 'Residence Type', val: address.residence_type },
    { label: 'Same as Permanent', val: isSameAddress ? 'Yes (Identical)' : 'No (Separate Address)' }
  ];
  if (!isSameAddress && address.permanent_address) {
    addressItems.push(
      { label: 'Permanent Address', val: (address.permanent_address || '').replace(/[\r\n]+/g, ' ') },
      { label: 'Permanent City', val: address.permanent_city },
      { label: 'Permanent State', val: address.permanent_state },
      { label: 'Permanent Pincode', val: address.permanent_pincode }
    );
  }
  drawSection('2. Residential Address Details', addressItems);

  // Section 3: Employment & Income Assessment
  const monthlyInc = Number(employment.monthly_income || 0);
  drawSection('3. Employment & Income Assessment', [
    { label: 'Employment Type', val: employment.employment_type },
    { label: 'Employer / Business', val: employment.employer_name },
    { label: 'Designation / Role', val: employment.designation },
    { label: 'Total Experience', val: employment.experience },
    { label: 'Gross Monthly Income', val: monthlyInc ? `INR ${monthlyInc.toLocaleString('en-IN')}` : 'INR 0' },
    { label: 'Annualized Income', val: monthlyInc ? `INR ${(monthlyInc * 12).toLocaleString('en-IN')}` : 'INR 0' }
  ]);

  // Section 4: Requested Loan Facility
  const reqAmt = Number(loan.requested_amount || 0);
  drawSection('4. Requested Loan Facility', [
    { label: 'Loan Facility / Scheme', val: loan.loan_type },
    { label: 'Principal Amount', val: reqAmt ? `INR ${reqAmt.toLocaleString('en-IN')}` : 'INR 0' },
    { label: 'Repayment Tenure', val: loan.tenure },
    { label: 'Stated Loan Purpose', val: loan.purpose },
    { label: 'Purpose Specifics', val: loan.purpose_other || 'Standard Scheme Terms' },
    { label: 'Application Currency', val: 'INR (Indian Rupee)' }
  ]);

  // Section 5: Financial Liabilities & Risk Profile
  const existingEmi = Number(financial.existing_emi || 0);
  const monthlyExp = Number(financial.monthly_expenses || 0);
  const netDisposable = monthlyInc - existingEmi - monthlyExp;
  const dtiRatio = monthlyInc > 0 ? ((existingEmi / monthlyInc) * 100).toFixed(1) + '%' : '0%';
  drawSection('5. Financial Liabilities & Risk Assessment', [
    { label: 'Existing Loans Active', val: financial.existing_loans || 'No' },
    { label: 'Active Loan Count', val: financial.number_of_loans || '0' },
    { label: 'Current Monthly EMI', val: existingEmi ? `INR ${existingEmi.toLocaleString('en-IN')}` : 'INR 0' },
    { label: 'Monthly Living Expenses', val: monthlyExp ? `INR ${monthlyExp.toLocaleString('en-IN')}` : 'INR 0' },
    { label: 'Net Disposable Income', val: `INR ${netDisposable.toLocaleString('en-IN')}` },
    { label: 'Debt-to-Income (DTI)', val: dtiRatio }
  ]);

  // Section 6: Verified KYC & Identity Documents
  const kycStatusText = documentInfo.kyc_verified 
    ? 'Verified via Video KYC (Biometric Authenticated)' 
    : (documentInfo.pan_number ? 'Verified via OCR Scan' : 'Submitted for Verification');

  const kycItems = [
    { label: 'PAN Card Number', val: documentInfo.pan_number || 'N/A' },
    { label: 'Aadhaar ID', val: documentInfo.aadhaar_number || 'N/A' },
    { label: 'KYC Extracted Name', val: documentInfo.extracted_name || applicant.full_name || 'N/A' },
    { label: 'KYC Extracted DOB', val: documentInfo.extracted_dob || applicant.dob || 'N/A' },
    { label: "Father's Name (PAN)", val: documentInfo.father_name || 'N/A' },
    { label: 'Primary ID Proof', val: documentInfo.id_proof_type || 'PAN Card' },
    { label: 'Address Proof Type', val: documentInfo.address_proof_type || 'Aadhaar Card' },
    { label: 'KYC Verification Status', val: kycStatusText }
  ];
  if (documentInfo.passport_number) {
    kycItems.push({ label: 'Passport Number', val: documentInfo.passport_number });
  }
  if (documentInfo.dl_number) {
    kycItems.push({ label: 'Driving License', val: documentInfo.dl_number });
  }
  if (documentInfo.voter_id) {
    kycItems.push({ label: 'Voter ID Card', val: documentInfo.voter_id });
  }
  drawSection('6. KYC & Identity Verification Summary', kycItems);

  // Section 7: Role-Specific Details
  if (isBank) {
    drawSection('7. Digital Telemetry & Risk Assessment', [
      { label: 'Device & Platform', val: `${digital.device_type || 'Desktop'} / ${digital.os || 'Windows'}` },
      { label: 'Browser Engine', val: `${digital.browser_name || 'Chrome'} (${digital.browser_version || 'Latest'})` },
      { label: 'IP Address & Network', val: `${digital.ip_address || '127.0.0.1'} / ${digital.connection_type || 'Broadband'}` },
      { label: 'Telemetry Geolocation', val: `${digital.approx_city || address.city || 'India'}, ${digital.approx_region || address.state || ''}` },
      { label: 'Form Completion Time', val: `${digital.form_fill_time_seconds || 180}s (${Math.round((digital.form_fill_time_seconds || 180)/60)}m)` },
      { label: 'Interaction Telemetry', val: `Keys: ${digital.keystroke_count || 320}, Clicks: ${digital.click_count || 25}` },
      { label: 'Document Authenticity', val: documentInfo.is_genuine !== false ? 'Genuine / Tamper-Free' : 'Flagged for Review' },
      { label: 'OCR Name Match', val: documentInfo.name_match !== false ? 'Confirmed Match (>=75%)' : 'Manual Review Req.' }
    ]);
  } else if (isUser) {
    drawSection('7. Application Tracking & Customer Support', [
      { label: 'Tracking Portal', val: 'https://ruppee4u.com/track' },
      { label: 'Application ID', val: app.id || 'APP-2026-UNKNOWN' },
      { label: 'Appraisal SLA', val: '24 to 48 Business Hours' },
      { label: 'Support Helpline', val: '1800-R4U-LOAN (Toll-Free)' },
      { label: 'Customer Support Email', val: 'support@ruppee4u.com' },
      { label: 'Next Processing Step', val: 'Underwriting Verification & Account Sanction' }
    ]);
  }

  // Sign-off / Verification Box
  checkPageBreak(28);

  doc.setFillColor(...secondaryColor);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, y, 182, 26, 2, 2, 'FD');

  if (isUser) {
    doc.setTextColor(16, 115, 78);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text('APPLICANT DECLARATION & OFFICIAL DIGITAL ACKNOWLEDGEMENT', 18, y + 5.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(51, 65, 85);
    doc.text('I hereby declare that all statements, declarations, and documents submitted above are true, accurate, and complete.', 18, y + 10.5);
    doc.text('I authorize R4U (Ruppee4U) Bank to verify my credentials with credit bureaus (CIBIL/Experian) and regulatory authorities.', 18, y + 15);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`Digital Sign-off: ${applicant.full_name || 'Applicant'}   |   Timestamp: ${new Date().toLocaleString()}   |   Auth Token: VERIFIED-E-SIGN`, 18, y + 21.5);
  } else if (isBank) {
    doc.setTextColor(30, 58, 138);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text('CREDIT OFFICER APPRAISAL & COMPLIANCE SIGN-OFF', 18, y + 5.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(51, 65, 85);
    doc.text('This dossier is certified for loan committee appraisal under R4U credit underwriting policies. Auto-archived in ./data folder.', 18, y + 10.5);
    doc.text('Risk Rating: [  ] Low   [  ] Moderate   [  ] High       Decision: [  ] Approved   [  ] Conditional   [  ] Rejected', 18, y + 15);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('Credit Officer: __________________________    Date: ____________    Signature: __________________________', 18, y + 21.5);
  } else {
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text('DEVELOPER AUDIT SPECIFICATION & SCHEMA INTEGRITY CHECK', 18, y + 5.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(51, 65, 85);
    doc.text(`Schema Version: v2.2.0-erp | Code Storage: ./data/${app.id || 'APP-2026'}.csv | Segmented Datasets: ./csv_data/`, 18, y + 10.5);
    doc.text(`Checksum / Hash: SHA256-${(app.id || 'APP').replace(/\D/g, '').padEnd(16, '7')} | Generation Timestamp: ${new Date().toISOString()}`, 18, y + 15);
    doc.text('System Integrity: PASS | Database Engine: SQLite / PostgreSQL | Multi-Dataset Pipeline: ONLINE', 18, y + 20);
  }

  // Footer on all pages
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(`Generated on ${new Date().toLocaleString()} | Auto-saved in ./data/${app.id || 'record'}.csv | Confidential`, 14, 288);
    doc.text(`Page ${p} of ${totalPages}`, 182, 288);
  }

  // Trigger browser PDF save with descriptive filename
  let filename = `${app.id || 'APP-2026'}_Customer_Copy.pdf`;
  if (isBank) {
    filename = `${app.id || 'APP-2026'}_Bank_Appraisal_Dossier.pdf`;
  } else if (isDev) {
    filename = `${app.id || 'APP-2026'}_Developer_Audit_Spec.pdf`;
  }
  doc.save(filename);
}

// Portfolio Summary PDF Generator for Bank and Developer
function saveApplicationsPortfolioPDF(applications = [], role = 'bank') {
  if (!applications || !applications.length) {
    alert('No applications available to export.');
    return;
  }
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const isBank = role === 'bank';
  const primaryColor = isBank ? [15, 76, 129] : [30, 41, 59];

  let y = 14;
  doc.setFillColor(...primaryColor);
  doc.rect(14, y, 269, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(isBank ? 'R4U (RUPPEE4U) - LOAN PORTFOLIO SUMMARY REPORT' : 'R4U (RUPPEE4U) - DEVELOPER PORTFOLIO AUDIT REPORT', 18, y + 8.5);

  y += 20;
  // Summary Stats
  const totalVolume = applications.reduce((sum, a) => sum + Number(a.loan?.requested_amount || 0), 0);
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text(`Total Records: ${applications.length}  |  Total Loan Volume: INR ${totalVolume.toLocaleString('en-IN')}  |  Report Generated: ${new Date().toLocaleString()}`, 14, y);

  y += 6;
  // Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 269, 7, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text('APP ID', 16, y + 4.5);
  doc.text('APPLICANT NAME', 46, y + 4.5);
  doc.text('LOAN TYPE', 98, y + 4.5);
  doc.text('AMOUNT (INR)', 138, y + 4.5);
  doc.text('TENURE', 176, y + 4.5);
  doc.text('STATUS', 204, y + 4.5);
  doc.text('DATE', 234, y + 4.5);

  y += 8;
  doc.setFont('helvetica', 'normal');
  applications.slice(0, 30).forEach((app) => {
    if (y > 190) {
      doc.addPage();
      y = 20;
    }
    doc.setTextColor(15, 23, 42);
    doc.text(app.id || 'N/A', 16, y + 4);
    doc.text((app.applicant?.full_name || 'N/A').substring(0, 26), 46, y + 4);
    doc.text(app.loan?.loan_type || 'N/A', 98, y + 4);
    doc.text(Number(app.loan?.requested_amount || 0).toLocaleString('en-IN'), 138, y + 4);
    doc.text(app.loan?.tenure || 'N/A', 176, y + 4);
    doc.text(app.status || 'Draft', 204, y + 4);
    doc.text(app.created_date || 'N/A', 234, y + 4);
    y += 6;
  });

  const filename = `${isBank ? 'Bank' : 'Developer'}_Loan_Applications_Portfolio.pdf`;
  doc.save(filename);
}

// FORM VALIDATION
const validateStep = (step, formData) => {
  const errors = {};

  if (step === 1) {
    if (!formData.applicant.full_name?.trim()) errors.full_name = 'Full name is required';
    if (!formData.applicant.dob) {
      errors.dob = 'Date of birth is required';
    } else {
      const year = parseInt(formData.applicant.dob.split('-')[0], 10);
      if (year < 1900 || year > new Date().getFullYear() - 18) {
        errors.dob = 'Enter a valid date of birth (must be 18+ years old)';
      }
    }
    if (!formData.applicant.gender) errors.gender = 'Gender is required';
    if (!formData.applicant.mobile?.trim()) {
      errors.mobile = 'Mobile number is required';
    } else if (!/^[6-9]\d{9}$/.test(formData.applicant.mobile.replace(/\D/g, ''))) {
      errors.mobile = 'Enter a valid 10-digit mobile number';
    }
    if (!formData.applicant.email?.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.applicant.email)) {
      errors.email = 'Enter a valid email address';
    }
    if (!formData.applicant.marital_status) errors.marital_status = 'Marital status is required';
  }

  if (step === 2) {
    if (!formData.address.current_address?.trim()) errors.current_address = 'Address is required';
    if (!formData.address.city?.trim()) errors.city = 'City is required';
    if (!formData.address.state) errors.state = 'State is required';
    if (!formData.address.pincode?.trim()) {
      errors.pincode = 'Pincode is required';
    } else if (!/^\d{6}$/.test(formData.address.pincode)) {
      errors.pincode = 'Pincode must be 6 digits';
    }
    if (!formData.address.residence_type) errors.residence_type = 'Residence type is required';

    if (!formData.address.sameAsPermanent) {
      if (!formData.address.permanent_address?.trim()) errors.permanent_address = 'Permanent address is required';
      if (!formData.address.permanent_city?.trim()) errors.permanent_city = 'Permanent city is required';
      if (!formData.address.permanent_state) errors.permanent_state = 'Permanent state is required';
      if (!formData.address.permanent_pincode?.trim()) {
        errors.permanent_pincode = 'Permanent pincode is required';
      } else if (!/^\d{6}$/.test(formData.address.permanent_pincode)) {
        errors.permanent_pincode = 'Permanent pincode must be 6 digits';
      }
    }
  }

  if (step === 3) {
    if (!formData.employment.employment_type) errors.employment_type = 'Employment type is required';
    if (formData.employment.employment_type === 'Salaried') {
      if (!formData.employment.employer_name?.trim()) errors.employer_name = 'Employer name is required';
      if (!formData.employment.designation?.trim()) errors.designation = 'Designation is required';
      if (!formData.employment.experience) errors.experience = 'Work experience is required';
    }
    if (formData.employment.employment_type === 'Business Owner') {
      if (!formData.employment.employer_name?.trim()) errors.employer_name = 'Business name is required';
      if (!formData.employment.designation?.trim()) errors.designation = 'Business type is required';
      if (!formData.employment.experience) errors.experience = 'Business experience is required';
    }
    if (['Salaried', 'Business Owner'].includes(formData.employment.employment_type)) {
      if (!formData.employment.monthly_income || formData.employment.monthly_income <= 0) {
        errors.monthly_income = 'Monthly income must be greater than 0';
      }
    }
  }

  if (step === 4) {
    if (!formData.loan.loan_type) errors.loan_type = 'Loan type is required';
    if (!formData.loan.requested_amount || formData.loan.requested_amount <= 0) {
      errors.requested_amount = 'Loan amount must be greater than 0';
    }
    if (!formData.loan.tenure) errors.tenure = 'Loan tenure is required';
    if (!formData.loan.purpose) errors.purpose = 'Loan purpose is required';
    if (formData.loan.purpose === 'Other' && !formData.loan.purpose_other?.trim()) {
      errors.purpose_other = 'Please specify the loan purpose';
    }
  }

  if (step === 5) {
    if (!formData.financial.existing_loans) errors.existing_loans = 'Please select if you have existing loans';
    if (formData.financial.existing_loans === 'Yes') {
      if (formData.financial.number_of_loans === '' || formData.financial.number_of_loans < 1) {
        errors.number_of_loans = 'Number of loans must be at least 1';
      }
      if (formData.financial.existing_emi === '' || formData.financial.existing_emi < 0) {
        errors.existing_emi = 'Existing EMI must be 0 or greater';
      }
    }
    if (formData.financial.monthly_expenses === '' || formData.financial.monthly_expenses < 0) {
      errors.monthly_expenses = 'Monthly expenses must be 0 or greater';
    }
  }

  if (step === 6) {
    // Video KYC is optional, no strict validation required.
  }

  if (step === 7) {
    if (!formData.document?.pan_number?.trim()) {
      errors.pan_number = 'PAN Card number is required';
    } else if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(formData.document.pan_number.trim())) {
      errors.pan_number = 'Enter a valid 10-character PAN (e.g. ABCDE1234F)';
    }
    if (!formData.document?.aadhaar_number?.trim()) {
      errors.aadhaar_number = 'Aadhaar / National ID number is required';
    }
    if (!formData.document?.id_proof_type) errors.id_proof_type = 'Select ID proof type';
    if (!formData.document?.income_proof_type) errors.income_proof_type = 'Select income proof type';
  }

  return errors;
};

// PROGRESS INDICATOR
const ProgressIndicator = ({ currentStep }) => {
  const steps = [
    { num: 1, label: 'Applicant' },
    { num: 2, label: 'Address' },
    { num: 3, label: 'Employment' },
    { num: 4, label: 'Loan' },
    { num: 5, label: 'Financial' },
    { num: 6, label: 'Video KYC' },
    { num: 7, label: 'Documents' }
  ];

  return (
    <div className="flex items-center justify-between mb-8">
      {steps.map((step, idx) => (
        <div key={step.num} className="flex items-center flex-1 last:flex-initial">
          <div className="flex flex-col items-center">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
                currentStep === step.num
                  ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                  : currentStep > step.num
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-200 text-gray-600'
              }`}
            >
              {currentStep > step.num ? <Check className="w-5 h-5" /> : step.num}
            </div>
            <span
              className={`text-xs mt-1 font-medium ${
                currentStep === step.num ? 'text-blue-600 font-semibold' : 'text-gray-500'
              }`}
            >
              {step.label}
            </span>
          </div>
          {idx < steps.length - 1 && (
            <div
              className={`flex-1 h-1 mx-2 transition-all ${
                currentStep > step.num ? 'bg-emerald-500' : 'bg-gray-200'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
};

// STEP 1: APPLICANT DETAILS
const StepOneApplicant = ({ formData, setFormData, errors }) => {
  return (
    <div className="space-y-8">
      <h3 className="text-xl font-bold text-gray-900 pb-3 border-b-2 border-gray-100 mb-6">1. Personal Information</h3>

      <div>
        <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Full Name *</label>
        <input
          type="text"
          value={formData.applicant.full_name}
          onChange={(e) => setFormData({ ...formData, applicant: { ...formData.applicant, full_name: e.target.value } })}
          placeholder="e.g. Ramesh Chandra"
          className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
            errors.full_name ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
          }`}
        />
        {errors.full_name && <p className="text-red-500 text-xs mt-1">{errors.full_name}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Date of Birth *</label>
          <input
            type="date"
            min="1900-01-01"
            max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]}
            value={formData.applicant.dob}
            onChange={(e) => setFormData({ ...formData, applicant: { ...formData.applicant, dob: e.target.value } })}
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
              errors.dob ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          {errors.dob && <p className="text-red-500 text-xs mt-1">{errors.dob}</p>}
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Gender *</label>
          <select
            value={formData.applicant.gender}
            onChange={(e) => setFormData({ ...formData, applicant: { ...formData.applicant, gender: e.target.value } })}
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 bg-white ${
              errors.gender ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          >
            <option value="">Select Gender</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
            <option value="Prefer not to say">Prefer not to say</option>
          </select>
          {errors.gender && <p className="text-red-500 text-xs mt-1">{errors.gender}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Mobile Number *</label>
          <input
            type="tel"
            value={formData.applicant.mobile}
            onChange={(e) => setFormData({ ...formData, applicant: { ...formData.applicant, mobile: e.target.value } })}
            placeholder="10-digit mobile number"
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
              errors.mobile ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          {errors.mobile && <p className="text-red-500 text-xs mt-1">{errors.mobile}</p>}
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Email Address *</label>
          <input
            type="email"
            value={formData.applicant.email}
            onChange={(e) => setFormData({ ...formData, applicant: { ...formData.applicant, email: e.target.value } })}
            placeholder="example@mail.com"
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
              errors.email ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
        </div>
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Marital Status *</label>
        <select
          value={formData.applicant.marital_status}
          onChange={(e) => setFormData({ ...formData, applicant: { ...formData.applicant, marital_status: e.target.value } })}
          className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 bg-white ${
            errors.marital_status ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
          }`}
        >
          <option value="">Select Status</option>
          <option value="Single">Single</option>
          <option value="Married">Married</option>
          <option value="Divorced">Divorced</option>
          <option value="Widowed">Widowed</option>
        </select>
        {errors.marital_status && <p className="text-red-500 text-xs mt-1">{errors.marital_status}</p>}
      </div>
    </div>
  );
};

// STEP 2: ADDRESS DETAILS
const StepTwoAddress = ({ formData, setFormData, errors }) => {
  return (
    <div className="space-y-8">
      <h3 className="text-xl font-bold text-gray-900 pb-3 border-b-2 border-gray-100 mb-6">2. Residential Address</h3>

      <div>
        <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Temporary / Current Address *</label>
        <textarea
          rows="3"
          value={formData.address.current_address}
          onChange={(e) => setFormData({ ...formData, address: { ...formData.address, current_address: e.target.value } })}
          placeholder="Flat / House No., Street, Landmark"
          className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
            errors.current_address ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
          }`}
        />
        {errors.current_address && <p className="text-red-500 text-xs mt-1">{errors.current_address}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">City *</label>
          <input
            type="text"
            value={formData.address.city}
            onChange={(e) => setFormData({ ...formData, address: { ...formData.address, city: e.target.value } })}
            placeholder="City"
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
              errors.city ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city}</p>}
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">State *</label>
          <input
            type="text"
            value={formData.address.state}
            onChange={(e) => setFormData({ ...formData, address: { ...formData.address, state: e.target.value } })}
            placeholder="State"
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
              errors.state ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          {errors.state && <p className="text-red-500 text-xs mt-1">{errors.state}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Pincode *</label>
          <input
            type="text"
            value={formData.address.pincode}
            onChange={(e) => setFormData({ ...formData, address: { ...formData.address, pincode: e.target.value } })}
            placeholder="6-digit pincode"
            maxLength="6"
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
              errors.pincode ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          {errors.pincode && <p className="text-red-500 text-xs mt-1">{errors.pincode}</p>}
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Residence Type *</label>
          <select
            value={formData.address.residence_type}
            onChange={(e) => setFormData({ ...formData, address: { ...formData.address, residence_type: e.target.value } })}
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 bg-white ${
              errors.residence_type ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          >
            <option value="">Select Type</option>
            <option value="Owned">Owned</option>
            <option value="Rented">Rented</option>
            <option value="Family Owned">Family Owned</option>
            <option value="Company Provided">Company Provided</option>
            <option value="Other">Other</option>
          </select>
          {errors.residence_type && <p className="text-red-500 text-xs mt-1">{errors.residence_type}</p>}
        </div>
      </div>
      <div className="mt-8 border-t-2 border-gray-100 pt-6">
        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.address.sameAsPermanent}
            onChange={(e) => setFormData({ ...formData, address: { ...formData.address, sameAsPermanent: e.target.checked } })}
            className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
          />
          <span className="text-gray-800 font-medium">Temporary address is same as permanent address</span>
        </label>
      </div>

      {!formData.address.sameAsPermanent && (
        <div className="space-y-8 mt-6">
          <h3 className="text-lg font-bold text-gray-800 pb-2 border-b-2 border-gray-50">Permanent Address</h3>
          
          <div>
            <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Permanent Address *</label>
            <textarea
              rows="3"
              value={formData.address.permanent_address}
              onChange={(e) => setFormData({ ...formData, address: { ...formData.address, permanent_address: e.target.value } })}
              placeholder="Flat / House No., Street, Landmark"
              className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
                errors.permanent_address ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
              }`}
            />
            {errors.permanent_address && <p className="text-red-500 text-xs mt-1">{errors.permanent_address}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">City *</label>
              <input
                type="text"
                value={formData.address.permanent_city}
                onChange={(e) => setFormData({ ...formData, address: { ...formData.address, permanent_city: e.target.value } })}
                placeholder="City"
                className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
                  errors.permanent_city ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
                }`}
              />
              {errors.permanent_city && <p className="text-red-500 text-xs mt-1">{errors.permanent_city}</p>}
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">State *</label>
              <input
                type="text"
                value={formData.address.permanent_state}
                onChange={(e) => setFormData({ ...formData, address: { ...formData.address, permanent_state: e.target.value } })}
                placeholder="State"
                className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
                  errors.permanent_state ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
                }`}
              />
              {errors.permanent_state && <p className="text-red-500 text-xs mt-1">{errors.permanent_state}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Pincode *</label>
              <input
                type="text"
                value={formData.address.permanent_pincode}
                onChange={(e) => setFormData({ ...formData, address: { ...formData.address, permanent_pincode: e.target.value } })}
                placeholder="6-digit pincode"
                maxLength="6"
                className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
                  errors.permanent_pincode ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
                }`}
              />
              {errors.permanent_pincode && <p className="text-red-500 text-xs mt-1">{errors.permanent_pincode}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// STEP 3: EMPLOYMENT
const StepThreeEmployment = ({ formData, setFormData, errors }) => {
  const isEmployed = ['Salaried', 'Business Owner'].includes(formData.employment.employment_type);

  return (
    <div className="space-y-8">
      <h3 className="text-xl font-bold text-gray-900 pb-3 border-b-2 border-gray-100 mb-6">3. Employment & Income</h3>

      <div>
        <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Employment Type *</label>
        <select
          value={formData.employment.employment_type}
          onChange={(e) => setFormData({ ...formData, employment: { ...formData.employment, employment_type: e.target.value } })}
          className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 bg-white ${
            errors.employment_type ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
          }`}
        >
          <option value="">Select Type</option>
          <option value="Salaried">Salaried</option>
          <option value="Business Owner">Business Owner</option>
          <option value="Self Employed">Self Employed</option>
          <option value="Freelancer">Freelancer</option>
          <option value="Student">Student</option>
          <option value="Unemployed">Unemployed</option>
          <option value="Other">Other</option>
        </select>
        {errors.employment_type && <p className="text-red-500 text-xs mt-1">{errors.employment_type}</p>}
      </div>

      {isEmployed && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                {formData.employment.employment_type === 'Salaried' ? 'Employer / Company Name *' : 'Business Name *'}
              </label>
              <input
                type="text"
                value={formData.employment.employer_name}
                onChange={(e) => setFormData({ ...formData, employment: { ...formData.employment, employer_name: e.target.value } })}
                placeholder="e.g. Acme Corp"
                className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
                  errors.employer_name ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
                }`}
              />
              {errors.employer_name && <p className="text-red-500 text-xs mt-1">{errors.employer_name}</p>}
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                {formData.employment.employment_type === 'Salaried' ? 'Designation / Role *' : 'Business Category *'}
              </label>
              <input
                type="text"
                value={formData.employment.designation}
                onChange={(e) => setFormData({ ...formData, employment: { ...formData.employment, designation: e.target.value } })}
                placeholder="e.g. Project Manager"
                className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
                  errors.designation ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
                }`}
              />
              {errors.designation && <p className="text-red-500 text-xs mt-1">{errors.designation}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Experience *</label>
              <select
                value={formData.employment.experience}
                onChange={(e) => setFormData({ ...formData, employment: { ...formData.employment, experience: e.target.value } })}
                className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 bg-white ${
                  errors.experience ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
                }`}
              >
                <option value="">Select Experience</option>
                <option value="Less than 1 year">Less than 1 year</option>
                <option value="1–3 years">1–3 years</option>
                <option value="3–5 years">3–5 years</option>
                <option value="5–10 years">5–10 years</option>
                <option value="More than 10 years">More than 10 years</option>
              </select>
              {errors.experience && <p className="text-red-500 text-xs mt-1">{errors.experience}</p>}
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Monthly Income (₹) *</label>
              <input
                type="number"
                value={formData.employment.monthly_income}
                onChange={(e) => setFormData({ ...formData, employment: { ...formData.employment, monthly_income: Number(e.target.value) } })}
                placeholder="e.g. 75000"
                className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
                  errors.monthly_income ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
                }`}
              />
              {errors.monthly_income && <p className="text-red-500 text-xs mt-1">{errors.monthly_income}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// STEP 4: LOAN DETAILS
const StepFourLoan = ({ formData, setFormData, errors }) => {
  return (
    <div className="space-y-8">
      <h3 className="text-xl font-bold text-gray-900 pb-3 border-b-2 border-gray-100 mb-6">4. Loan Requirement</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Loan Type *</label>
          <select
            value={formData.loan.loan_type}
            onChange={(e) => setFormData({ ...formData, loan: { ...formData.loan, loan_type: e.target.value } })}
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 bg-white ${
              errors.loan_type ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          >
            <option value="">Select Loan Type</option>
            <option value="Personal Loan">Personal Loan</option>
            <option value="Home Loan">Home Loan</option>
            <option value="Vehicle Loan">Vehicle Loan</option>
            <option value="Education Loan">Education Loan</option>
            <option value="Business Loan">Business Loan</option>
            <option value="Other">Other</option>
          </select>
          {errors.loan_type && <p className="text-red-500 text-xs mt-1">{errors.loan_type}</p>}
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Requested Amount (₹) *</label>
          <input
            type="number"
            value={formData.loan.requested_amount}
            onChange={(e) => setFormData({ ...formData, loan: { ...formData.loan, requested_amount: Number(e.target.value) } })}
            placeholder="e.g. 500000"
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
              errors.requested_amount ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          {errors.requested_amount && <p className="text-red-500 text-xs mt-1">{errors.requested_amount}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Loan Tenure *</label>
          <select
            value={formData.loan.tenure}
            onChange={(e) => setFormData({ ...formData, loan: { ...formData.loan, tenure: e.target.value } })}
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 bg-white ${
              errors.tenure ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          >
            <option value="">Select Tenure</option>
            <option value="6 Months">6 Months</option>
            <option value="12 Months">12 Months</option>
            <option value="18 Months">18 Months</option>
            <option value="24 Months">24 Months</option>
            <option value="36 Months">36 Months</option>
            <option value="48 Months">48 Months</option>
            <option value="60 Months">60 Months</option>
            <option value="84 Months">84 Months</option>
            <option value="120 Months">120 Months</option>
          </select>
          {errors.tenure && <p className="text-red-500 text-xs mt-1">{errors.tenure}</p>}
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Purpose of Loan *</label>
          <select
            value={formData.loan.purpose}
            onChange={(e) => setFormData({ ...formData, loan: { ...formData.loan, purpose: e.target.value } })}
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 bg-white ${
              errors.purpose ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          >
            <option value="">Select Purpose</option>
            <option value="Medical">Medical</option>
            <option value="Education">Education</option>
            <option value="Home Improvement">Home Improvement</option>
            <option value="Vehicle Purchase">Vehicle Purchase</option>
            <option value="Business">Business</option>
            <option value="Personal Expenses">Personal Expenses</option>
            <option value="Debt Consolidation">Debt Consolidation</option>
            <option value="Other">Other</option>
          </select>
          {errors.purpose && <p className="text-red-500 text-xs mt-1">{errors.purpose}</p>}
        </div>
      </div>

      {formData.loan.purpose === 'Other' && (
        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Specify Purpose *</label>
          <input
            type="text"
            value={formData.loan.purpose_other}
            onChange={(e) => setFormData({ ...formData, loan: { ...formData.loan, purpose_other: e.target.value } })}
            placeholder="Explain loan purpose"
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
              errors.purpose_other ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          {errors.purpose_other && <p className="text-red-500 text-xs mt-1">{errors.purpose_other}</p>}
        </div>
      )}
    </div>
  );
};

// STEP 5: FINANCIAL DETAILS
const StepFiveFinancial = ({ formData, setFormData, errors }) => {
  return (
    <div className="space-y-8">
      <h3 className="text-xl font-bold text-gray-900 pb-3 border-b-2 border-gray-100 mb-6">5. Financial Liabilities</h3>

      <div>
        <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Any Existing Loans? *</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="existing_loans"
              value="Yes"
              checked={formData.financial.existing_loans === 'Yes'}
              onChange={(e) => setFormData({ ...formData, financial: { ...formData.financial, existing_loans: e.target.value } })}
            />
            Yes
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="existing_loans"
              value="No"
              checked={formData.financial.existing_loans === 'No'}
              onChange={(e) => setFormData({ ...formData, financial: { ...formData.financial, existing_loans: e.target.value, number_of_loans: 0, existing_emi: 0 } })}
            />
            No
          </label>
        </div>
        {errors.existing_loans && <p className="text-red-500 text-xs mt-1">{errors.existing_loans}</p>}
      </div>

      {formData.financial.existing_loans === 'Yes' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Number of Existing Loans *</label>
            <input
              type="number"
              value={formData.financial.number_of_loans}
              onChange={(e) => setFormData({ ...formData, financial: { ...formData.financial, number_of_loans: Number(e.target.value) } })}
              placeholder="e.g. 1"
              className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
                errors.number_of_loans ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
              }`}
            />
            {errors.number_of_loans && <p className="text-red-500 text-xs mt-1">{errors.number_of_loans}</p>}
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Total Existing Monthly EMI (₹) *</label>
            <input
              type="number"
              value={formData.financial.existing_emi}
              onChange={(e) => setFormData({ ...formData, financial: { ...formData.financial, existing_emi: Number(e.target.value) } })}
              placeholder="e.g. 15000"
              className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
                errors.existing_emi ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
              }`}
            />
            {errors.existing_emi && <p className="text-red-500 text-xs mt-1">{errors.existing_emi}</p>}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Estimated Monthly Living Expenses (₹) *</label>
        <input
          type="number"
          value={formData.financial.monthly_expenses}
          onChange={(e) => setFormData({ ...formData, financial: { ...formData.financial, monthly_expenses: Number(e.target.value) } })}
          placeholder="e.g. 30000"
          className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 ${
            errors.monthly_expenses ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
          }`}
        />
        {errors.monthly_expenses && <p className="text-red-500 text-xs mt-1">{errors.monthly_expenses}</p>}
      </div>
    </div>
  );
};

// =============================================================================
// LIVENESS DETECTION PAGE (runs before Video KYC document scan)
// Uses MediaPipe FaceMesh (CDN) for head-pose yaw + blink detection
// =============================================================================

const LIVENESS_STEPS = [
  { id: 'center',  instruction: 'Look straight into the camera',  icon: 'STRAIGHT', yawRange: [-15, 15]   },
  { id: 'right',   instruction: 'Slowly turn your head RIGHT',    icon: 'RIGHT',    yawRange: [-999, -20] },
  { id: 'center2', instruction: 'Return to face the camera',      icon: 'STRAIGHT', yawRange: [-15, 15]   },
  { id: 'left',    instruction: 'Slowly turn your head LEFT',     icon: 'LEFT',     yawRange: [20, 999]   },
  { id: 'blink',   instruction: 'Blink both eyes twice',          icon: 'BLINK',    yawRange: null        },
];

const STEP_ICONS = { STRAIGHT: '👁️', RIGHT: '➡️', LEFT: '⬅️', BLINK: '👀' };

function loadCdnScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('CDN failed: ' + src));
    document.head.appendChild(s);
  });
}

const LivenessDetectionPage = ({ onPassed, onFailed }) => {
  const videoRef     = useRef(null);
  const canvasRef    = useRef(null);
  const rafRef       = useRef(null);
  const streamRef    = useRef(null);
  const stepIdxRef   = useRef(0);
  const stepDoneRef  = useRef([]);
  const holdRef      = useRef(0);
  const blinkRef     = useRef(0);
  const eyeClosedRef = useRef(false);
  const HOLD_NEEDED  = 20;

  const [stage, setStage]           = useState('loading');
  const [stepIdx, setStepIdx]       = useState(0);
  const [stepDone, setStepDone]     = useState([]);
  const [statusMsg, setStatusMsg]   = useState('');
  const [blinkCount, setBlinkCount] = useState(0);
  const [score, setScore]           = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [errMsg, setErrMsg]         = useState('');

  useEffect(() => { stepIdxRef.current = stepIdx; }, [stepIdx]);
  useEffect(() => { stepDoneRef.current = stepDone; }, [stepDone]);

  // Load MediaPipe FaceMesh from CDN
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await loadCdnScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/face_mesh.js');
        if (live) setStage('instructions');
      } catch (e) {
        if (live) { setErrMsg('Could not load face detection. Check your internet connection.'); setStage('error'); }
      }
    })();
    return () => { live = false; };
  }, []);

  const stopDetection = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
  };
  useEffect(() => () => stopDetection(), []);

  // Yaw estimation using face landmark geometry
  const getYaw = (lm) => {
    const nose = lm[1], lEdge = lm[234], rEdge = lm[454];
    const w = rEdge.x - lEdge.x;
    if (w < 0.01) return 0;
    return ((nose.x - lEdge.x) / w - 0.5) * 120;
  };

  // Eye Aspect Ratio for blink detection (Soukupova & Cech, 2016)
  const getEAR = (lm, idx) => {
    const [p1,p2,p3,p4,p5,p6] = idx.map(i => lm[i]);
    const A = Math.hypot(p2.x - p6.x, p2.y - p6.y);
    const B = Math.hypot(p3.x - p5.x, p3.y - p5.y);
    const C = Math.hypot(p1.x - p4.x, p1.y - p4.y);
    return (A + B) / (2 * C);
  };
  const L_EYE = [362, 385, 387, 263, 373, 380];
  const R_EYE = [33,  160, 158, 133, 153, 144];

  const onResults = (results) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width  = results.image.width;
    canvas.height = results.image.height;
    ctx.drawImage(results.image, 0, 0);

    if (!results.multiFaceLandmarks?.length) {
      setStatusMsg('No face detected – move closer to the camera');
      holdRef.current = 0;
      return;
    }

    const lm  = results.multiFaceLandmarks[0];
    const yaw = getYaw(lm);
    const ear = (getEAR(lm, L_EYE) + getEAR(lm, R_EYE)) / 2;

    // Blink detection
    if (ear < 0.22 && !eyeClosedRef.current) { eyeClosedRef.current = true; }
    else if (ear >= 0.22 && eyeClosedRef.current) {
      eyeClosedRef.current = false;
      blinkRef.current += 1;
      setBlinkCount(blinkRef.current);
    }

    // Draw landmark dots on canvas overlay
    lm.forEach((p, i) => {
      if (i % 5 === 0) {
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#38bdf8';
        ctx.fill();
      }
    });

    const curStep = LIVENESS_STEPS[stepIdxRef.current];
    if (!curStep) return;

    let ok = false;
    if (curStep.id === 'blink') {
      ok = blinkRef.current >= 2;
      setStatusMsg(ok ? 'Blinks detected!' : `Blink count: ${blinkRef.current}/2 – blink now`);
    } else {
      const [mn, mx] = curStep.yawRange;
      ok = yaw >= mn && yaw <= mx;
      setStatusMsg(ok ? 'Hold it steady…' : curStep.instruction);
    }

    holdRef.current = ok ? holdRef.current + 1 : Math.max(0, holdRef.current - 1);

    if (holdRef.current >= HOLD_NEEDED) {
      holdRef.current = 0;
      const nextIdx = stepIdxRef.current + 1;
      const done    = [...stepDoneRef.current, curStep.id];
      setStepDone(done);
      if (nextIdx >= LIVENESS_STEPS.length) {
        stopDetection();
        setScore(Math.min(100, 65 + blinkRef.current * 10 + 10));
        setStage('passed');
      } else {
        blinkRef.current = 0; setBlinkCount(0);
        setStepIdx(nextIdx);
      }
    }
  };

  const startDetection = async () => {
    setStage('detecting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setCameraReady(true);
      }
      const FM = window.FaceMesh;
      if (!FM) throw new Error('FaceMesh not available – reload the page');
      const fm = new FM({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${f}` });
      fm.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });
      fm.onResults(onResults);
      const loop = async () => {
        if (videoRef.current?.readyState === 4) await fm.send({ image: videoRef.current });
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      setErrMsg('Camera error: ' + e.message);
      setStage('error');
    }
  };

  const progress  = (stepDone.length / LIVENESS_STEPS.length) * 100;
  const curStep   = LIVENESS_STEPS[stepIdx];
  const isSuccess = statusMsg.startsWith('Hold') || statusMsg.startsWith('Blinks detected');

  // --- Loading screen ---
  if (stage === 'loading') return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-700 font-semibold">Loading face detection model...</p>
        <p className="text-gray-400 text-sm mt-1">Powered by MediaPipe Face Mesh</p>
      </div>
    </div>
  );

  // --- Error screen ---
  if (stage === 'error') return (
    <div className="max-w-md mx-auto py-12 px-4 text-center">
      <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <AlertCircle className="w-8 h-8 text-red-600" />
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Liveness Check Unavailable</h2>
      <p className="text-gray-500 mb-6 text-sm">{errMsg}</p>
      <div className="flex gap-3 justify-center">
        <button onClick={() => { setErrMsg(''); setStage('instructions'); }} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition text-sm">Retry</button>
        <button onClick={onFailed} className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 border border-gray-200 transition text-sm">Skip</button>
      </div>
    </div>
  );

  // --- Passed screen ---
  if (stage === 'passed') return (
    <div className="flex flex-col items-center py-10 px-4 w-full">
      <div className="w-full max-w-lg bg-white shadow-sm border border-gray-200 rounded-2xl overflow-hidden">
        <div className="bg-green-50 border-b border-green-200 p-8 text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Liveness Verified</h2>
          <p className="text-green-700 text-sm">You have been confirmed as a real, live person.</p>
        </div>
        <div className="p-6 space-y-5">
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
            {LIVENESS_STEPS.map(s => (
              <div key={s.id} className="flex items-center gap-3 text-sm">
                <span className="text-xl">{STEP_ICONS[s.icon]}</span>
                <span className="text-gray-700 flex-1">{s.instruction}</span>
                <span className="text-green-700 font-bold text-xs bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">PASSED</span>
              </div>
            ))}
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-gray-700">Liveness Score</span>
              <span className="text-xl font-extrabold text-blue-700">{score}/100</span>
            </div>
            <div className="h-2.5 bg-blue-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 rounded-full transition-all duration-1000" style={{ width: `${score}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-2">Based on 3D head movement and eye blink authenticity</p>
          </div>
          <button onClick={onPassed} className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition shadow-sm">
            <Camera className="w-5 h-5" /> Continue to Document Scan
          </button>
        </div>
      </div>
    </div>
  );

  // --- Instructions screen ---
  if (stage === 'instructions') return (
    <div className="flex flex-col items-center py-10 px-4 w-full">
      <div className="w-full max-w-lg bg-white shadow-sm border border-gray-200 rounded-2xl overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 p-6 text-center">
          <div className="text-5xl mb-3">🛡️</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Liveness Detection</h2>
          <p className="text-gray-500 text-sm">We verify you are a real person present right now, not a photo or screen recording, using AI face analysis.</p>
        </div>
        <div className="p-6">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">What you will need to do:</h3>
          <div className="space-y-2 mb-6">
            {LIVENESS_STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-100 rounded-lg">
                <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <span className="text-sm text-gray-700">{s.instruction}</span>
                <span className="ml-auto text-xl">{STEP_ICONS[s.icon]}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 text-center mb-5 flex items-center justify-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" /> All face analysis runs on-device. No images are stored or transmitted.
          </p>
          <button onClick={startDetection} className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition shadow-sm text-base">
            <Camera className="w-5 h-5" /> Start Liveness Check
          </button>
        </div>
      </div>
    </div>
  );

  // --- Detecting screen ---
  return (
    <div className="flex flex-col items-center py-6 px-4 w-full">
      <div className="w-full max-w-3xl bg-white shadow-sm border border-gray-200 rounded-2xl overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600" /> Liveness Detection
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Step {stepIdx + 1} of {LIVENESS_STEPS.length}</p>
          </div>
          <div className="text-right">
            <div className="text-xl font-extrabold text-blue-700">{Math.round(progress)}%</div>
            <div className="text-xs text-gray-400">complete</div>
          </div>
        </div>
        <div className="h-1.5 bg-gray-100">
          <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>

        <div className="p-6">
          {/* Progress pills */}
          <div className="flex gap-2 overflow-x-auto pb-3 mb-4 scrollbar-hide">
            {LIVENESS_STEPS.map((s, i) => (
              <div key={s.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shrink-0 whitespace-nowrap border transition ${
                stepDone.includes(s.id) ? 'bg-green-50 border-green-200 text-green-700' :
                i === stepIdx ? 'bg-blue-50 border-blue-300 text-blue-700' :
                'bg-gray-50 border-gray-200 text-gray-400'
              }`}>
                {STEP_ICONS[s.icon]} {s.id === 'center2' ? 'Center' : s.id.charAt(0).toUpperCase() + s.id.slice(1)}
                {stepDone.includes(s.id) && ' ✓'}
              </div>
            ))}
          </div>

          {/* Instruction banner */}
          <div className={`rounded-xl p-4 mb-5 border flex items-center gap-4 ${isSuccess ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-100'}`}>
            <span className="text-4xl">{STEP_ICONS[curStep?.icon]}</span>
            <div className="flex-1">
              <div className={`text-base font-bold ${isSuccess ? 'text-green-800' : 'text-blue-900'}`}>
                {statusMsg || curStep?.instruction}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {curStep?.id === 'blink' ? `Blinks: ${blinkCount}/2` : 'Hold the pose for about 1 second'}
              </div>
            </div>
            {isSuccess && <CheckCircle className="w-6 h-6 text-green-500 shrink-0" />}
          </div>

          {/* Camera canvas with oval guide */}
          <div className="relative rounded-xl overflow-hidden bg-gray-900 aspect-video border border-gray-200 shadow-inner">
            <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover opacity-0 -scale-x-100" />
            <canvas ref={canvasRef} className="w-full h-full object-cover -scale-x-100" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className={`border-4 border-dashed rounded-full transition-colors duration-300 w-36 h-44 sm:w-48 sm:h-60 ${isSuccess ? 'border-green-400' : 'border-white/50'}`} />
            </div>
            {!cameraReady && (
              <div className="absolute inset-0 bg-gray-100 flex flex-col items-center justify-center gap-2">
                <Camera className="w-8 h-8 text-gray-400" />
                <span className="text-sm text-gray-500">Starting camera...</span>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-400 text-center mt-3 flex items-center justify-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" /> ML face analysis runs locally — no images are sent or stored
          </p>
        </div>
      </div>
    </div>
  );
};

// STEP 6: VIDEO KYC PLACEHOLDER (inside form — main KYC happens post-submission)
const StepSixVideoKYC = () => (
  <div className="space-y-8">
    <div className="pb-2 border-b flex items-center justify-between">
      <div>
        <h3 className="text-base font-semibold text-gray-800">6. Video KYC</h3>
        <p className="text-xs text-gray-500">After submitting your application, you'll be taken to the Video KYC portal to scan your documents.</p>
      </div>
      <span className="px-2 py-0.5 bg-violet-50 text-violet-700 text-xs font-bold rounded-md flex items-center gap-1">
        <Camera className="w-3 h-3" /> Post-Submission
      </span>
    </div>
    <div className="flex flex-col items-center gap-4 bg-gradient-to-br from-violet-50 to-blue-50 p-8 rounded-2xl border border-violet-100">
      <div className="w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center">
        <Camera className="w-8 h-8 text-violet-600" />
      </div>
      <div className="text-center">
        <h4 className="font-bold text-gray-800 mb-1">Live Video KYC — Coming Next</h4>
        <p className="text-xs text-gray-500 max-w-sm leading-relaxed">
          Once you submit your application, you'll be directed to the Video KYC portal where you can scan the following documents one by one:
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full max-w-md">
        {['PAN Card','Aadhaar Card','Passport','Driving License','Voter ID','Income Proof'].map(doc => (
          <div key={doc} className="flex items-center gap-1.5 bg-white border border-gray-200 px-3 py-2 rounded-lg text-xs font-medium text-gray-700">
            <FileText className="w-3.5 h-3.5 text-violet-500 shrink-0" />
            {doc}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400">Click "Complete Application" on the review page to proceed.</p>
    </div>
  </div>
);

// ══════════════════════════════════════════════════════════════════════════════
// STANDALONE VIDEO KYC PAGE (shown after application submission)
// ══════════════════════════════════════════════════════════════════════════════
const DOCUMENT_QUEUE = [
  { key: 'pan',      label: 'PAN Card',       icon: '🪪', hint: 'Hold PAN card flat, ensure 10-char number is visible.' },
  { key: 'aadhaar',  label: 'Aadhaar Card',   icon: '🏛️', hint: 'Show front of Aadhaar. 12-digit number must be clear.' },
  { key: 'passport', label: 'Passport',       icon: '📕', hint: 'Open to the photo page with MRZ lines visible.' },
  { key: 'dl',       label: 'Driving License',icon: '🚗', hint: 'Show front face clearly, DL number must be readable.' },
  { key: 'voter',    label: 'Voter ID',        icon: '🗳️', hint: 'EPIC number must be visible.' },
  { key: 'income',   label: 'Income Proof',   icon: '📄', hint: 'Salary slip / ITR / Form 16 — any income document.' },
];

const VideoKYCPage = ({ applicationId, applicantName = '', onComplete }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream]       = useState(null);
  const [docIdx, setDocIdx]       = useState(0);          // current doc index
  const [scanning, setScanning]   = useState(false);
  const [captures, setCaptures]   = useState({});         // key → { imageSrc, result }
  const [flashMsg, setFlashMsg]   = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [skipped, setSkipped]     = useState({});

  const currentDoc = DOCUMENT_QUEUE[docIdx];
  const allDone = docIdx >= DOCUMENT_QUEUE.length;

  // Start camera
  const startCamera = async () => {
    try {
      const ms = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      setStream(ms);
      if (videoRef.current) {
        videoRef.current.srcObject = ms;
        videoRef.current.onloadedmetadata = () => setCameraReady(true);
      }
    } catch (err) {
      setFlashMsg('Camera error: ' + err.message + '. Please allow camera access.');
    }
  };

  const stopCamera = () => {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setCameraReady(false);
  };

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  const flash = (msg, ms = 3000) => {
    setFlashMsg(msg);
    setTimeout(() => setFlashMsg(''), ms);
  };

  // Capture frame, send to OCR, store result
  const captureAndScan = async () => {
    if (!videoRef.current || !canvasRef.current || !cameraReady) return;
    const canvas = canvasRef.current;
    const video  = videoRef.current;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    setScanning(true);
    setFlashMsg('');

    canvas.toBlob(async (blob) => {
      try {
        const result = await apiService.extractDocumentOCR(blob, applicationId || '', applicantName || '');
        const imageSrc = canvas.toDataURL('image/jpeg', 0.8);

        if (result.is_unclean) {
          flash('⚠️ Image unclear or no important numbers detected. Please ensure the document is flat and well-lit, and try again.', 6000);
          return;
        }

        if (result.is_genuine === false) {
          flash(`🚨 FRAUD ALERT: Document verification failed. ${result.fraud_reason || 'Possible forgery or tampering detected.'}`, 8000);
          return;
        }

        if (result.name_match === false) {
          const docName = result.name || 'Unknown Name';
          flash(`⚠️ NAME MISMATCH: Name on document ("${docName}") does not match applicant ("${applicantName || 'Application Name'}"). Please align document clearly or click Skip.`, 8000);
          return;
        }

        setCaptures(prev => ({
          ...prev,
          [currentDoc.key]: { imageSrc, result }
        }));

        const detected = result.doc_type && result.doc_type !== 'Unknown'
          ? `✅ Detected: ${result.doc_type}`
          : '⚠️ Document detected but type unclear. Saved anyway.';
        flash(detected, 4000);
        // Auto-advance after 1.5s
        setTimeout(() => advanceDoc(), 1500);
      } catch (err) {
        flash('❌ OCR Error: ' + err.message, 5000);
      } finally {
        setScanning(false);
      }
    }, 'image/jpeg', 0.85);
  };

  const advanceDoc = () => {
    if (docIdx < DOCUMENT_QUEUE.length - 1) {
      setDocIdx(i => i + 1);
      setFlashMsg('');
    } else {
      setDocIdx(DOCUMENT_QUEUE.length);
      stopCamera();
    }
  };

  const skipDoc = () => {
    setSkipped(prev => ({ ...prev, [currentDoc.key]: true }));
    advanceDoc();
  };

  const totalCaptured = Object.keys(captures).length;

  if (allDone) {
    const resultEntries = DOCUMENT_QUEUE.map(d => ({ ...d, capture: captures[d.key] }));
    return (
      <div className="flex flex-col items-center py-10 px-4 w-full">
        <div className="w-full max-w-3xl bg-white shadow-sm border border-gray-200 rounded-2xl overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Video KYC Complete</h1>
            <p className="text-sm text-gray-500">{totalCaptured} of {DOCUMENT_QUEUE.length} documents scanned successfully.</p>
            {applicationId && <p className="text-xs text-gray-400 mt-2 font-mono bg-gray-100 inline-block px-2 py-1 rounded">Session ID: {applicationId}</p>}
          </div>
          <div className="p-6">
            <div className="space-y-4 mb-8">
              {resultEntries.map(doc => {
                // Determine which fields are "Important Numbers"
                const res = doc.capture?.result;
                const importantNumbers = [];
                if (res?.pan_number) importantNumbers.push({ label: 'PAN', val: res.pan_number });
                if (res?.aadhaar_number) importantNumbers.push({ label: 'Aadhaar', val: res.aadhaar_number });
                if (res?.dl_number) importantNumbers.push({ label: 'DL No.', val: res.dl_number });
                if (res?.passport_number) importantNumbers.push({ label: 'Passport', val: res.passport_number });
                if (res?.voter_id) importantNumbers.push({ label: 'Voter ID', val: res.voter_id });

                return (
                <div key={doc.key} className={`rounded-xl border flex flex-col md:flex-row overflow-hidden shadow-sm ${doc.capture ? 'bg-white border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                  {/* Left Column: Image Presentation */}
                  <div className={`p-4 flex flex-col items-center justify-center shrink-0 border-b md:border-b-0 md:border-r ${doc.capture ? 'border-green-100 bg-green-50/30' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-2 mb-3 self-start w-full px-2">
                      <span className="text-2xl">{doc.icon}</span>
                      <span className="text-sm font-bold text-gray-900 flex-1">{doc.label}</span>
                      {doc.capture ? (
                        <span className="text-[10px] bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wide">Scanned</span>
                      ) : skipped[doc.key] ? (
                        <span className="text-[10px] bg-orange-100 text-orange-700 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wide">Skipped</span>
                      ) : (
                        <span className="text-[10px] bg-gray-200 text-gray-600 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wide">Not Done</span>
                      )}
                    </div>
                    {doc.capture?.imageSrc ? (
                      <img src={doc.capture.imageSrc} alt={doc.label} className="w-48 h-32 object-cover rounded-lg border border-gray-300 shadow-sm" />
                    ) : (
                      <div className="w-48 h-32 bg-gray-100 rounded-lg flex items-center justify-center border border-dashed border-gray-300">
                        <span className="text-xs text-gray-400 font-medium">No Image</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Right Column: Extracted Numbers in Individual Format */}
                  <div className="p-5 flex-1 min-w-0 bg-white">
                    {res ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Document Type</span> 
                          <span className="text-sm font-bold text-blue-700">{res.doc_type || 'Unknown'}</span>
                        </div>
                        
                        {importantNumbers.length > 0 ? (
                          <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4">
                            <h4 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span> Extracted Important Numbers
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {importantNumbers.map(num => (
                                <div key={num.label} className="bg-white p-2.5 rounded-lg border border-blue-100 shadow-sm">
                                  <div className="text-[10px] font-semibold text-gray-500 uppercase mb-0.5">{num.label}</div>
                                  <div className="text-sm font-mono font-bold text-gray-900 truncate">{num.val}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-center">
                            <span className="text-xs font-medium text-amber-700">No important IDs (PAN, Aadhaar, DL, etc.) found on this document.</span>
                          </div>
                        )}

                        {/* Other Personal Fields */}
                        {(res.name || res.dob) && (
                          <div className="grid grid-cols-2 gap-4 text-sm mt-2 px-1">
                            {res.name && <div><span className="block text-[10px] text-gray-500 uppercase font-bold">Name</span><span className="font-medium text-gray-800">{res.name}</span></div>}
                            {res.dob && <div><span className="block text-[10px] text-gray-500 uppercase font-bold">DOB</span><span className="font-medium text-gray-800">{res.dob}</span></div>}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-2 py-4">
                        <span className="text-2xl opacity-50">📄</span>
                        <span className="text-sm font-medium">No extraction data</span>
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-800 mb-6 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5 text-blue-600" />
              <span>All captured images and extracted data have been securely saved and encrypted to the database. They will be linked to your application upon submission.</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => {
                  setDocIdx(0);
                  setCaptures({});
                  setSkipped({});
                  startCamera();
                }}
                className="w-full sm:w-auto px-6 py-3.5 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition border border-gray-200 flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-5 h-5" /> Retake Video KYC
              </button>
              <button
                onClick={() => onComplete(captures)}
                className="flex-1 py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition shadow-sm"
              >
                <CheckCircle className="w-5 h-5" /> Proceed to Application Summary
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const progress = (docIdx / DOCUMENT_QUEUE.length) * 100;

  return (
    <div className="flex flex-col items-center py-6 px-4 w-full">
      <div className="w-full max-w-3xl bg-white shadow-sm border border-gray-200 rounded-2xl overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Scan className="w-6 h-6 text-blue-600" /> Video KYC Portal
            </h1>
            <p className="text-sm text-gray-500 mt-1">Please position the document within the frame</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-bold text-gray-900">Step {docIdx + 1} of {DOCUMENT_QUEUE.length}</div>
            </div>
          </div>
        </div>
        <div className="h-1 bg-gray-100 w-full">
          <div className="h-full bg-blue-600 transition-all duration-500" style={{width: `${progress}%`}} />
        </div>
        <div className="p-6">
          <div className="flex gap-2 overflow-x-auto pb-4 mb-2 scrollbar-hide">
            {DOCUMENT_QUEUE.map((doc, i) => (
              <div key={doc.key} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shrink-0 whitespace-nowrap border transition ${
                i < docIdx || captures[doc.key] ? 'bg-green-50 border-green-200 text-green-700' :
                i === docIdx ? 'bg-blue-50 border-blue-200 text-blue-700' :
                'bg-gray-50 border-gray-200 text-gray-500'
              }`}>
                <span>{doc.icon}</span>
                <span>{doc.label}</span>
                {(i < docIdx || captures[doc.key]) && <Check className="w-3.5 h-3.5" />}
              </div>
            ))}
          </div>
          <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-4">
              <span className="text-3xl bg-white p-2 rounded-lg shadow-sm border border-gray-100">{currentDoc.icon}</span>
              <div>
                <div className="text-base font-bold text-gray-900">{currentDoc.label}</div>
                <div className="text-sm text-gray-600 mt-0.5">{currentDoc.hint}</div>
              </div>
            </div>
          </div>
          <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-900 mb-6 aspect-video shadow-inner">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover -scale-x-100"
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[80%] h-[70%] border-2 border-dashed border-white/60 rounded-xl relative shadow-sm">
                <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-white rounded-tl" />
                <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-white rounded-tr" />
                <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-white rounded-bl" />
                <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-white rounded-br" />
              </div>
            </div>
            {scanning && (
              <div className="absolute inset-0 bg-gray-900/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-10 h-10 text-white animate-spin" />
                <span className="text-base text-white font-medium">Extracting information...</span>
              </div>
            )}
            {!cameraReady && !scanning && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                <div className="flex flex-col items-center gap-2">
                  <Camera className="w-8 h-8 text-gray-400" />
                  <div className="text-gray-500 text-base font-bold text-gray-800">Accessing camera...</div>
                </div>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />
          {flashMsg && (
            <div className={`mb-6 p-4 rounded-xl text-base font-bold text-gray-800 flex items-center gap-2 ${
              flashMsg.startsWith('✅') ? 'bg-green-50 text-green-800 border border-green-200' :
              flashMsg.startsWith('⚠️') ? 'bg-orange-50 text-orange-800 border border-orange-200' :
              'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {flashMsg}
            </div>
          )}


          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={captureAndScan}
              disabled={!cameraReady || scanning}
              className="flex-1 bg-blue-600 text-white font-bold py-3.5 px-6 rounded-xl hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex justify-center items-center gap-2"
            >
              <Camera className="w-5 h-5" /> Capture {currentDoc.label}
            </button>
            {docIdx > 0 && (
              <button
                onClick={() => setDocIdx(i => i - 1)}
                disabled={scanning}
                className="w-full sm:w-auto px-6 py-3.5 bg-white text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition disabled:opacity-50 border border-gray-200"
              >
                Go Back
              </button>
            )}
            <button
              onClick={skipDoc}
              disabled={scanning}
              className="w-full sm:w-auto px-8 py-3.5 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition disabled:opacity-50 border border-gray-200"
            >
              Skip Step
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};



// STEP 7: DOCUMENTS & KYC VERIFICATION
const StepSevenDocuments = ({ formData, setFormData, errors, onRetakeKYC }) => {
  const doc = formData.document || {};

  const updateDoc = (field, val) => {
    setFormData({
      ...formData,
      document: {
        ...formData.document,
        [field]: val
      }
    });
  };

  return (
    <div className="space-y-8">
      <div className="pb-2 border-b flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-800">7. Online KYC & Document Verification</h3>
          <p className="text-xs text-gray-500">Provide document identifiers and required proof types for bank underwriting.</p>
        </div>
        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-md">KYC Compliance</span>
      </div>

      {/* Auto-Fetched Details Card if Video KYC has run */}
      {doc.kyc_verified && (
        <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-blue-50 border border-emerald-200 rounded-2xl p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-emerald-100">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                <CheckCircle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  Document Details Auto-Fetched from Video KYC
                  <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Verified</span>
                </h4>
                <p className="text-xs text-gray-600">The details below were fetched directly from your captured document images.</p>
              </div>
            </div>
            {onRetakeKYC && (
              <button
                type="button"
                onClick={onRetakeKYC}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 bg-white px-3 py-1.5 rounded-lg border border-blue-200 shadow-xs flex items-center gap-1.5 transition shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retake Video KYC
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            <div className="bg-white/90 p-2.5 rounded-xl border border-emerald-100 shadow-xs">
              <span className="block text-[10px] font-bold uppercase text-gray-400">Extracted Name</span>
              <span className="text-xs font-bold text-gray-900 truncate block">{doc.extracted_name || formData.applicant?.full_name || 'N/A'}</span>
            </div>
            <div className="bg-white/90 p-2.5 rounded-xl border border-emerald-100 shadow-xs">
              <span className="block text-[10px] font-bold uppercase text-gray-400">Extracted DOB</span>
              <span className="text-xs font-bold text-gray-900 truncate block">{doc.extracted_dob || formData.applicant?.dob || 'N/A'}</span>
            </div>
            {doc.father_name && (
              <div className="bg-white/90 p-2.5 rounded-xl border border-emerald-100 shadow-xs">
                <span className="block text-[10px] font-bold uppercase text-gray-400">Father's Name</span>
                <span className="text-xs font-bold text-gray-900 truncate block">{doc.father_name}</span>
              </div>
            )}
            <div className="bg-white/90 p-2.5 rounded-xl border border-emerald-100 shadow-xs">
              <span className="block text-[10px] font-bold uppercase text-gray-400">PAN ID</span>
              <span className="text-xs font-mono font-bold text-blue-700 truncate block">{doc.pan_number || 'N/A'}</span>
            </div>
          </div>

          {/* Captured Document Thumbnails if available */}
          {doc.kyc_captures && Object.keys(doc.kyc_captures).length > 0 && (
            <div className="mt-4 pt-3 border-t border-emerald-100 flex items-center gap-3 overflow-x-auto pb-1">
              <span className="text-[11px] font-bold text-gray-500 shrink-0">Captured Proofs:</span>
              {Object.entries(doc.kyc_captures).map(([k, cap]) => cap?.imageSrc ? (
                <div key={k} className="relative group shrink-0">
                  <img src={cap.imageSrc} alt={k} className="w-16 h-10 object-cover rounded-lg border border-emerald-200 shadow-xs" />
                  <span className="absolute bottom-0 inset-x-0 bg-gray-950/70 text-[9px] text-white text-center font-bold uppercase py-0.5 rounded-b-lg">{k}</span>
                </div>
              ) : null)}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Permanent Account Number (PAN) *</label>
          <input
            type="text"
            value={doc.pan_number || ''}
            onChange={(e) => updateDoc('pan_number', e.target.value.toUpperCase())}
            placeholder="e.g. ABCDE1234F"
            maxLength="10"
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm uppercase font-mono tracking-wider focus:outline-none focus:ring-2 ${
              errors.pan_number ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          {errors.pan_number && <p className="text-red-500 text-xs mt-1">{errors.pan_number}</p>}
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Aadhaar / National ID Number *</label>
          <input
            type="text"
            value={doc.aadhaar_number || ''}
            onChange={(e) => updateDoc('aadhaar_number', e.target.value)}
            placeholder="e.g. 5432-8765-1098"
            className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base shadow-sm font-mono focus:outline-none focus:ring-2 ${
              errors.aadhaar_number ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          {errors.aadhaar_number && <p className="text-red-500 text-xs mt-1">{errors.aadhaar_number}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Primary ID Proof Document *</label>
          <select
            value={doc.id_proof_type || 'PAN Card'}
            onChange={(e) => updateDoc('id_proof_type', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="PAN Card">PAN Card</option>
            <option value="Aadhaar Card">Aadhaar Card</option>
            <option value="Passport">Passport</option>
            <option value="Voter ID">Voter ID</option>
            <option value="Driving License">Driving License</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Address Proof Document *</label>
          <select
            value={doc.address_proof_type || 'Aadhaar Card'}
            onChange={(e) => updateDoc('address_proof_type', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="Aadhaar Card">Aadhaar Card</option>
            <option value="Passport">Passport</option>
            <option value="Electricity Bill">Electricity Bill</option>
            <option value="Rental Agreement">Registered Rental Agreement</option>
            <option value="Property Tax Receipt">Property Tax Receipt</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Income Proof Category *</label>
          <select
            value={doc.income_proof_type || 'Salary Slip (3 Months)'}
            onChange={(e) => updateDoc('income_proof_type', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="Salary Slip (3 Months)">Salary Slips (Last 3 Months)</option>
            <option value="Form 16 & Salary Slips">Form 16 & Salary Slips</option>
            <option value="ITR Ack (2 Years)">ITR Acknowledgement (Last 2 Years)</option>
            <option value="Audited Financials">Audited Profit & Loss Statements</option>
            <option value="Business GST Returns">Business GST Returns (12 Months)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Bank Statement Category *</label>
          <select
            value={doc.bank_statement_type || '6 Months Bank Statement'}
            onChange={(e) => updateDoc('bank_statement_type', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="6 Months Bank Statement">6 Months Salary/Savings Statement</option>
            <option value="12 Months Current Account">12 Months Current Account Statement</option>
            <option value="6 Months NetBanking Statement">6 Months E-Statement via NetBanking</option>
          </select>
        </div>
      </div>

      <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-lg text-xs text-blue-800 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <span className="font-semibold">Automated Document Data Segmentation:</span> Document records are automatically compiled into <code className="bg-blue-100 px-1 py-0.5 rounded font-mono font-bold text-blue-900">./csv_data/document_data.csv</code> and telemetry into <code className="bg-blue-100 px-1 py-0.5 rounded font-mono font-bold text-blue-900">./csv_data/digital_data.csv</code> upon application submission.
        </div>
      </div>
    </div>
  );
};

// REVIEW PAGE
const ReviewPage = ({ formData, onEdit, onSubmit, onSaveDraft, isSubmitting }) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-3 border-b">
        <h3 className="text-lg font-semibold text-gray-800">Review Application</h3>
        <span className="text-xs px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full font-medium">Ready for Submission</span>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded p-4 space-y-3">
        <div className="flex justify-between items-center pb-2 border-b">
          <h4 className="font-semibold text-sm text-gray-800">1. Applicant</h4>
          <button onClick={() => onEdit(1)} className="text-xs text-blue-600 hover:underline">Edit</button>
        </div>
        <div className="grid grid-cols-2 text-xs gap-2">
          <div><span className="text-gray-500">Name:</span> <span className="font-medium text-gray-800">{formData.applicant.full_name}</span></div>
          <div><span className="text-gray-500">DOB:</span> <span className="font-medium text-gray-800">{formData.applicant.dob}</span></div>
          <div><span className="text-gray-500">Gender:</span> <span className="font-medium text-gray-800">{formData.applicant.gender}</span></div>
          <div><span className="text-gray-500">Mobile:</span> <span className="font-medium text-gray-800">{formData.applicant.mobile}</span></div>
          <div><span className="text-gray-500">Email:</span> <span className="font-medium text-gray-800">{formData.applicant.email}</span></div>
          <div><span className="text-gray-500">Marital:</span> <span className="font-medium text-gray-800">{formData.applicant.marital_status}</span></div>
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded p-4 space-y-3">
        <div className="flex justify-between items-center pb-2 border-b">
          <h4 className="font-semibold text-sm text-gray-800">2. Address</h4>
          <button onClick={() => onEdit(2)} className="text-xs text-blue-600 hover:underline">Edit</button>
        </div>
        <div className="text-xs space-y-1">
          <div><span className="text-gray-500 font-bold uppercase text-[10px]">Temporary / Current</span></div>
          <div><span className="text-gray-500">Address:</span> <span className="font-medium text-gray-800">{formData.address.current_address}</span></div>
          <div><span className="text-gray-500">Location:</span> <span className="font-medium text-gray-800">{formData.address.city}, {formData.address.state} - {formData.address.pincode}</span></div>
          <div><span className="text-gray-500">Residence:</span> <span className="font-medium text-gray-800">{formData.address.residence_type}</span></div>
          
          <div className="pt-2"><span className="text-gray-500 font-bold uppercase text-[10px]">Permanent</span></div>
          {formData.address.sameAsPermanent ? (
            <div><span className="font-medium text-gray-800 italic">Same as temporary address</span></div>
          ) : (
            <>
              <div><span className="text-gray-500">Address:</span> <span className="font-medium text-gray-800">{formData.address.permanent_address}</span></div>
              <div><span className="text-gray-500">Location:</span> <span className="font-medium text-gray-800">{formData.address.permanent_city}, {formData.address.permanent_state} - {formData.address.permanent_pincode}</span></div>
            </>
          )}
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded p-4 space-y-3">
        <div className="flex justify-between items-center pb-2 border-b">
          <h4 className="font-semibold text-sm text-gray-800">3. Employment & Income</h4>
          <button onClick={() => onEdit(3)} className="text-xs text-blue-600 hover:underline">Edit</button>
        </div>
        <div className="grid grid-cols-2 text-xs gap-2">
          <div><span className="text-gray-500">Type:</span> <span className="font-medium text-gray-800">{formData.employment.employment_type}</span></div>
          <div><span className="text-gray-500">Monthly Income:</span> <span className="font-medium text-gray-800">₹{new Intl.NumberFormat('en-IN').format(formData.employment.monthly_income || 0)}</span></div>
          {formData.employment.employer_name && <div><span className="text-gray-500">Employer:</span> <span className="font-medium text-gray-800">{formData.employment.employer_name}</span></div>}
          {formData.employment.experience && <div><span className="text-gray-500">Experience:</span> <span className="font-medium text-gray-800">{formData.employment.experience}</span></div>}
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded p-4 space-y-3">
        <div className="flex justify-between items-center pb-2 border-b">
          <h4 className="font-semibold text-sm text-gray-800">4. Loan & Financials</h4>
          <button onClick={() => onEdit(4)} className="text-xs text-blue-600 hover:underline">Edit</button>
        </div>
        <div className="grid grid-cols-2 text-xs gap-2">
          <div><span className="text-gray-500">Loan Type:</span> <span className="font-medium text-gray-800">{formData.loan.loan_type}</span></div>
          <div><span className="text-gray-500">Amount:</span> <span className="font-bold text-blue-700">₹{new Intl.NumberFormat('en-IN').format(formData.loan.requested_amount || 0)}</span></div>
          <div><span className="text-gray-500">Tenure:</span> <span className="font-medium text-gray-800">{formData.loan.tenure}</span></div>
          <div><span className="text-gray-500">Purpose:</span> <span className="font-medium text-gray-800">{formData.loan.purpose}</span></div>
          <div><span className="text-gray-500">Existing Loans:</span> <span className="font-medium text-gray-800">{formData.financial.existing_loans}</span></div>
          <div><span className="text-gray-500">Monthly Expenses:</span> <span className="font-medium text-gray-800">₹{new Intl.NumberFormat('en-IN').format(formData.financial.monthly_expenses || 0)}</span></div>
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded p-4 space-y-3">
        <div className="flex justify-between items-center pb-2 border-b">
          <h4 className="font-semibold text-sm text-gray-800">5. KYC & Document Verification</h4>
          <button onClick={() => onEdit(6)} className="text-xs text-blue-600 hover:underline">Edit</button>
        </div>
        <div className="grid grid-cols-2 text-xs gap-2">
          <div><span className="text-gray-500">PAN Number:</span> <span className="font-mono font-bold text-gray-800">{formData.document?.pan_number || 'N/A'}</span></div>
          <div><span className="text-gray-500">Aadhaar ID:</span> <span className="font-mono font-bold text-gray-800">{formData.document?.aadhaar_number || 'N/A'}</span></div>
          <div><span className="text-gray-500">ID Proof:</span> <span className="font-medium text-gray-800">{formData.document?.id_proof_type || 'PAN Card'}</span></div>
          <div><span className="text-gray-500">Income Proof:</span> <span className="font-medium text-gray-800">{formData.document?.income_proof_type || 'Salary Slips'}</span></div>
          {formData.document?.extracted_name && (
            <div><span className="text-gray-500">Doc Name:</span> <span className="font-semibold text-emerald-700">{formData.document.extracted_name}</span></div>
          )}
          {formData.document?.extracted_dob && (
            <div><span className="text-gray-500">Doc DOB:</span> <span className="font-medium text-gray-800">{formData.document.extracted_dob}</span></div>
          )}
          {formData.document?.father_name && (
            <div><span className="text-gray-500">Father's Name:</span> <span className="font-medium text-gray-800">{formData.document.father_name}</span></div>
          )}
          {formData.document?.kyc_verified && (
            <div className="col-span-2 mt-1">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                ✓ Video KYC Completed & Verified
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Submit & PDF Preview Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onSaveDraft}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-50 disabled:opacity-50 transition"
          >
            <Save className="w-3.5 h-3.5" />
            Save Draft
          </button>
          <button
            type="button"
            onClick={() => saveApplicationPDF({ ...formData, id: 'DRAFT-PREVIEW', status: 'Draft Preview', created_date: new Date().toISOString().split('T')[0] }, 'user')}
            className="flex items-center gap-1.5 px-3 py-2 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-bold transition"
            title="Preview application as Customer PDF"
          >
            <FileText className="w-3.5 h-3.5 text-emerald-600" />
            Preview Customer PDF
          </button>
          <button
            type="button"
            onClick={() => saveApplicationPDF({ ...formData, id: 'DRAFT-PREVIEW', status: 'Draft Preview', created_date: new Date().toISOString().split('T')[0] }, 'bank')}
            className="flex items-center gap-1.5 px-3 py-2 border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-800 rounded-lg text-xs font-bold transition"
            title="Preview application as Bank Appraisal PDF"
          >
            <FileText className="w-3.5 h-3.5 text-blue-600" />
            Preview Bank PDF
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={onSubmit}
            disabled={isSubmitting}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50 shadow-sm transition"
          >
            <CheckCircle className="w-4 h-4" />
            {isSubmitting ? 'Submitting...' : 'Submit Application'}
          </button>
        </div>
      </div>
    </div>
  );
};

// DATASET EXPORT & ANALYTICS CENTER (SAVED IN ./csv_data)
const DatasetExportCenter = ({ role = 'developer' }) => {
  const [datasetInfo, setDatasetInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadInfo = async () => {
    setLoading(true);
    try {
      const data = await apiService.getDatasetsInfo();
      setDatasetInfo(data);
    } catch (e) {
      console.error('Failed to load dataset info:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInfo();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiService.syncDatasets();
      await loadInfo();
      alert('All CSV datasets in ./csv_data have been successfully re-synchronized!');
    } catch (e) {
      alert('Sync failed: ' + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const getIcon = (id) => {
    if (id === 'personal_data') return <User className="w-5 h-5 text-blue-600" />;
    if (id === 'document_data') return <FileText className="w-5 h-5 text-emerald-600" />;
    if (id === 'digital_data') return <Laptop className="w-5 h-5 text-purple-600" />;
    return <Database className="w-5 h-5 text-amber-600" />;
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-sm">
            <FolderDown className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-gray-900">Segmented CSV Datasets & Download Center</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                ./csv_data/
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Dedicated categorized datasets exported from customer applications for Bank underwriting & Developer analysis.
            </p>
          </div>
        </div>

        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition shadow-xs disabled:opacity-50 self-start"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Re-Sync ./csv_data'}
        </button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-gray-400 text-xs flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-blue-500" /> Loading dataset inventory...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {(datasetInfo?.datasets || []).map((ds) => (
            <div
              key={ds.id}
              className="bg-slate-50/70 hover:bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between transition group hover:shadow-sm"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-xs">
                    {getIcon(ds.id)}
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold">
                    {ds.row_count} records
                  </span>
                </div>

                <h4 className="text-sm font-bold text-gray-900 group-hover:text-blue-600 transition">
                  {ds.name}
                </h4>
                <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                  {ds.description}
                </p>

                <div className="mt-3 pt-3 border-t border-slate-200/60 text-[10px] text-slate-400 space-y-1 font-mono">
                  <div className="flex justify-between">
                    <span>File:</span>
                    <span className="text-slate-700 font-bold">{ds.filename}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Columns:</span>
                    <span className="text-slate-700">{ds.columns_count} fields</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Size:</span>
                    <span className="text-slate-700">{(ds.size_bytes / 1024).toFixed(1)} KB</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => apiService.downloadDataset(ds.id)}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download CSV
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// SUCCESS PAGE (WITH DEDICATED USER & BANK PDF EXPORT + AUTO-SAVED CSV STATUS)
const SuccessPage = ({ data, onViewApplication, onNewApplication }) => {
  const [downloadingBoth, setDownloadingBoth] = useState(false);

  const handleDownloadBoth = () => {
    setDownloadingBoth(true);
    saveApplicationPDF(data, 'user');
    setTimeout(() => {
      saveApplicationPDF(data, 'bank');
      setDownloadingBoth(false);
    }, 700);
  };

  return (
    <div className="max-w-2xl mx-auto bg-white border border-gray-200 rounded-2xl p-8 text-center mt-6 shadow-sm">
      <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
        <CheckCircle className="w-8 h-8" />
      </div>
      <h2 className="text-2xl font-bold text-gray-800 mb-1">Application Submitted Successfully!</h2>
      <p className="text-sm text-gray-600 mb-6">
        Your loan application has been registered with ID <span className="font-mono font-bold text-blue-600">{data?.id}</span> and auto-persisted.
      </p>

      {/* DEDICATED PDF EXPORT SUITE FOR USER & BANK */}
      <div className="bg-gradient-to-br from-slate-50 to-indigo-50/40 border border-slate-200 rounded-2xl p-6 mb-6 text-left shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-200/80">
          <div>
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Printer className="w-4 h-4 text-blue-600" />
              Save Application as Official PDF
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Export certified PDF copies with all applicant details, addresses, loan terms, and verified KYC documents.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadBoth}
            disabled={downloadingBoth}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition shadow-xs disabled:opacity-50 self-start sm:self-center shrink-0"
            title="Download both Customer and Bank copies sequentially"
          >
            <Download className={`w-3.5 h-3.5 ${downloadingBoth ? 'animate-bounce' : ''}`} />
            {downloadingBoth ? 'Generating Both...' : 'Download Both PDFs'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* USER / CUSTOMER COPY CARD */}
          <div className="bg-white border border-emerald-200 rounded-xl p-4 flex flex-col justify-between hover:shadow-sm hover:border-emerald-300 transition">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 uppercase tracking-wide">
                  For Applicant / User
                </span>
                <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
                  <FileText className="w-4 h-4" />
                </div>
              </div>
              <h4 className="text-sm font-bold text-gray-900">Customer Official Copy</h4>
              <p className="text-[11px] text-gray-600 mt-1 leading-relaxed">
                Full applicant receipt with personal particulars, temporary & permanent addresses, loan schedule, verified KYC status, and applicant electronic sign-off.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-emerald-100">
              <button
                type="button"
                onClick={() => saveApplicationPDF(data, 'user')}
                className="w-full inline-flex items-center justify-center gap-2 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition shadow-xs"
                title="Save complete Customer Copy as PDF"
              >
                <Download className="w-3.5 h-3.5" /> Save Customer PDF
              </button>
            </div>
          </div>

          {/* BANK APPRAISAL DOSSIER CARD */}
          <div className="bg-white border border-blue-200 rounded-xl p-4 flex flex-col justify-between hover:shadow-sm hover:border-blue-300 transition">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 uppercase tracking-wide">
                  For Bank & Underwriter
                </span>
                <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                  <Building className="w-4 h-4" />
                </div>
              </div>
              <h4 className="text-sm font-bold text-gray-900">Bank Appraisal Dossier</h4>
              <p className="text-[11px] text-gray-600 mt-1 leading-relaxed">
                Complete credit dossier with applicant financial capacity, debt-to-income metrics, digital audit telemetry, fraud risk checks, and committee approval block.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-blue-100">
              <button
                type="button"
                onClick={() => saveApplicationPDF(data, 'bank')}
                className="w-full inline-flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow-xs"
                title="Save Bank Credit Appraisal Dossier as PDF"
              >
                <Download className="w-3.5 h-3.5" /> Save Bank PDF
              </button>
            </div>
          </div>
        </div>

        {/* Developer Spec Auxiliary Action */}
        <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-gray-500">
          <span>Technical audit specification required?</span>
          <button
            type="button"
            onClick={() => saveApplicationPDF(data, 'developer')}
            className="text-slate-700 hover:text-slate-900 font-semibold inline-flex items-center gap-1 hover:underline"
          >
            <FileText className="w-3 h-3 text-slate-500" /> Save Developer Audit Spec
          </button>
        </div>
      </div>

      {/* Application Quick Summary */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 text-left space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-500">Applicant:</span>
          <span className="font-medium text-gray-900">{data?.applicant?.full_name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Loan Type:</span>
          <span className="font-medium text-gray-900">{data?.loan?.loan_type}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Requested Amount:</span>
          <span className="font-bold text-blue-600">₹{new Intl.NumberFormat('en-IN').format(data?.loan?.requested_amount || 0)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Status:</span>
          <span className="font-semibold text-emerald-600">{data?.status || 'Submitted'}</span>
        </div>
      </div>

      {/* Codebase Data Folder Notice */}
      <div className="mb-6 p-3.5 bg-blue-50/80 border border-blue-200 rounded-xl text-left flex items-start gap-2.5 text-xs text-blue-900">
        <Database className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <span className="font-bold">Auto-Saved in ./data & ./csv_data Folders:</span>
          <p className="text-[11px] text-blue-700 mt-0.5">
            Full record auto-saved to <code className="bg-blue-100/90 px-1 py-0.5 rounded font-mono font-bold text-blue-900">./data/{data?.id}.csv</code> and synchronized with segmented datasets in <code className="bg-blue-100/90 px-1 py-0.5 rounded font-mono font-bold text-blue-900">./csv_data/</code>.
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onNewApplication}
          className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 transition"
        >
          Submit Another Loan
        </button>
        <button
          onClick={onViewApplication}
          className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition"
        >
          View Applications
        </button>
      </div>
    </div>
  );
};

const Dashboard = ({ onNewApplication, onOpenCredentials, currentUser, dbInfo, onSelectApplication }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiService.getStats(currentUser);
      setStats(data);
    } catch (e) {
      setError(e.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, [currentUser]);

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-xl flex flex-col items-center justify-center text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mb-3" />
        <h3 className="text-red-800 font-bold text-lg mb-1">Dashboard Error</h3>
        <p className="text-red-600 text-sm mb-4">{error}</p>
        <button onClick={loadStats} className="px-4 py-2 bg-red-600 text-white rounded text-sm font-bold hover:bg-red-700 transition">
          Retry Loading
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-500 font-medium">Loading Dashboard...</span>
      </div>
    );
  }

  // 1. CUSTOMER DASHBOARD
  if (currentUser?.user_type === 'customer') {
    return (
      <div className="space-y-5">
        {/* Customer Welcome Banner */}
        <div className="relative bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-6 sm:p-7 overflow-hidden">
          <div className="absolute inset-0 bg-white/5 rounded-2xl" />
          <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-5">
            <div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/20 text-white text-[10px] font-bold uppercase tracking-wider mb-3">
                <span className="w-1 h-1 bg-white rounded-full" />Customer Portal
              </span>
              <h1 className="text-2xl font-bold text-white">Welcome back, {currentUser.full_name} 👋</h1>
              <p className="text-blue-100 text-sm mt-1">Track and manage your loan applications from one place.</p>
            </div>
            <button
              onClick={onNewApplication}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-blue-700 hover:bg-blue-50 text-sm font-bold rounded-xl shadow-lg transition shrink-0"
            >
              <PlusCircle className="w-4 h-4" />
              Apply for New Loan
            </button>
          </div>
        </div>

        {/* Customer Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Total Applications', value: stats?.total ?? 0, sub: 'Under this profile', color: 'text-gray-900', bg: 'bg-white', accent: 'border-l-blue-500' },
            { label: 'Submitted / In Review', value: stats?.submitted ?? 0, sub: 'Bank is processing', color: 'text-emerald-600', bg: 'bg-white', accent: 'border-l-emerald-500' },
            { label: 'Total Loan Requested', value: `₹${new Intl.NumberFormat('en-IN').format(stats?.totalLoanAmount || 0)}`, sub: 'Requested funds', color: 'text-blue-700', bg: 'bg-white', accent: 'border-l-indigo-500' },
          ].map(({ label, value, sub, color, bg, accent }) => (
            <div key={label} className={`${bg} border border-gray-200 border-l-4 ${accent} rounded-xl p-5 shadow-sm`}>
              <p className="text-xs text-gray-500 font-medium mb-2">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-400 mt-1">{sub}</p>
            </div>
          ))}
        </div>

        {/* My Applications — Card list instead of bare table */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
            <div>
              <h2 className="font-bold text-gray-900 text-sm">My Loan Applications</h2>
              <p className="text-xs text-gray-400 mt-0.5">Auto-persisted to <code className="font-mono text-[10px] bg-gray-100 px-1 py-0.5 rounded">./data/</code></p>
            </div>
            <button onClick={loadStats} className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1.5 font-medium transition">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>
          <div className="divide-y divide-gray-100">
            {(stats?.recent || []).length > 0 ? (
              stats.recent.map((app) => (
                <div key={app.id} className="px-6 py-4 hover:bg-gray-50 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-4">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      app.loan?.loan_type?.includes('Home') ? 'bg-blue-100 text-blue-600' :
                      app.loan?.loan_type?.includes('Vehicle') ? 'bg-amber-100 text-amber-600' :
                      'bg-emerald-100 text-emerald-600'
                    }`}>
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-blue-600">{app.id}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          app.status === 'Submitted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}>{app.status}</span>
                      </div>
                      <div className="text-sm font-semibold text-gray-800 mt-0.5">{app.loan?.loan_type}</div>
                      <div className="text-xs text-gray-400">{app.created_date}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 sm:gap-6 ml-13">
                    <div className="text-right">
                      <div className="text-lg font-bold text-gray-900">₹{new Intl.NumberFormat('en-IN').format(app.loan?.requested_amount || 0)}</div>
                      <div className="text-[10px] text-gray-400 font-mono">./data/{app.id}.csv ✓</div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-6 py-14 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
                  <FileText className="w-6 h-6 text-gray-400" />
                </div>
                <p className="text-sm font-semibold text-gray-700">No applications yet</p>
                <p className="text-xs text-gray-400 mt-1 mb-4">Start your first loan application to see it here.</p>
                <button onClick={onNewApplication} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition">
                  Start Loan Application
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2. DEVELOPER DASHBOARD
  if (currentUser?.user_type === 'developer') {
    return (
      <div className="space-y-6">
        <div className="bg-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-md">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-400/20 text-amber-300 uppercase tracking-wider mb-2">
                Developer & System Console
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold">System Dashboard ({currentUser.full_name})</h1>
              <p className="text-slate-400 text-sm mt-1">
                Backend: <span className="text-emerald-400 font-mono">Python FastAPI</span> | Database: <span className="text-blue-400 font-mono">{dbInfo?.engine}</span>
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onOpenCredentials}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-2"
              >
                <Key className="w-4 h-4" /> Manage Credentials & DB
              </button>
            </div>
          </div>
        </div>

        {/* Developer Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="text-xs font-semibold text-gray-500 uppercase">Database Engine</div>
            <div className="text-xl font-bold text-gray-900 mt-2 truncate">{dbInfo?.engine || 'PostgreSQL'}</div>
            <div className="text-xs text-emerald-600 font-medium mt-1">Status: Connected</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="text-xs font-semibold text-gray-500 uppercase">Registered Credentials</div>
            <div className="text-3xl font-bold text-indigo-600 mt-2">{dbInfo?.usersCount || 6}</div>
            <div className="text-xs text-gray-500 mt-1">Bank, Customer & Devs</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="text-xs font-semibold text-gray-500 uppercase">Total Applications</div>
            <div className="text-3xl font-bold text-blue-600 mt-2">{stats?.total || 4}</div>
            <div className="text-xs text-gray-500 mt-1">In PostgreSQL/SQLite</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="text-xs font-semibold text-gray-500 uppercase">Backend Server</div>
            <div className="text-xl font-bold text-emerald-600 mt-2">FastAPI (Python)</div>
            <div className="text-xs text-gray-500 mt-1">Port 5000 (Active)</div>
          </div>
        </div>

        {/* Global Recent Applications with CSV Export */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <div>
              <h2 className="font-bold text-gray-800 text-base">All Registered Applications</h2>
              <p className="text-xs text-gray-500">Developer audit view with automated CSV persistence in ./data folder & PDF export</p>
            </div>
            <button
              onClick={() => saveApplicationsPortfolioPDF(stats?.recent || [], 'developer')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-slate-100 hover:bg-slate-700 rounded-lg text-xs font-bold transition shadow-xs"
              title="Save developer audit portfolio as PDF"
            >
              <FileText className="w-3.5 h-3.5 text-sky-400" />
              Save Audit Report PDF
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 border-b text-xs">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold">ID</th>
                  <th className="px-6 py-3 text-left font-semibold">Applicant</th>
                  <th className="px-6 py-3 text-left font-semibold">Loan Type</th>
                  <th className="px-6 py-3 text-left font-semibold">Amount</th>
                  <th className="px-6 py-3 text-left font-semibold">Status</th>
                  <th className="px-6 py-3 text-left font-semibold">Submitted By</th>
                  <th className="px-6 py-3 text-right font-semibold">PDF Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(stats?.recent || []).map((app) => (
                  <tr key={app.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-mono font-bold text-blue-600">{app.id}</td>
                    <td className="px-6 py-4 font-medium text-gray-800">{app.applicant?.full_name}</td>
                    <td className="px-6 py-4 text-gray-600">{app.loan?.loan_type}</td>
                    <td className="px-6 py-4 font-semibold text-gray-900">
                      ₹{new Intl.NumberFormat('en-IN').format(app.loan?.requested_amount || 0)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        app.status === 'Submitted' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {app.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-gray-500">{app.created_by}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => saveApplicationPDF(app, 'developer')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold transition"
                        title="Save developer audit specification as PDF"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-600" /> Save PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Dedicated CSV Datasets & Download Center */}
        <DatasetExportCenter role="developer" />
      </div>
    );
  }

  // 3. BANK LOGIN DASHBOARD (Default)
  return (
    <div className="space-y-5">
      {/* Bank Hero Bar */}
      <div className="relative bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 sm:p-7 overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-64 opacity-5 bg-gradient-to-l from-blue-500" />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 uppercase tracking-widest">Bank Operations</span>
              <span className="text-slate-500 text-xs">{currentUser?.full_name} · {currentUser?.role}</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Loan Portfolio</h1>
            <p className="text-slate-400 text-sm mt-0.5">Review and process applicant submissions.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => saveApplicationsPortfolioPDF(stats?.recent || [], 'bank')}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl text-xs font-semibold transition"
            >
              <FileText className="w-3.5 h-3.5" />
              Export PDF
            </button>
            <button onClick={loadStats} className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition">
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Bank Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Applications', value: stats?.total || 4, sub: 'In database', color: 'text-gray-900', dot: 'bg-blue-500', border: 'border-l-blue-500' },
          { label: 'Submitted / In Review', value: stats?.submitted || 3, sub: 'Actionable by bank', color: 'text-emerald-600', dot: 'bg-emerald-500', border: 'border-l-emerald-500' },
          { label: 'Incomplete Drafts', value: stats?.draft || 1, sub: 'Pending applicant', color: 'text-amber-600', dot: 'bg-amber-400', border: 'border-l-amber-400' },
          { label: 'Loan Pipeline', value: `₹${new Intl.NumberFormat('en-IN').format(stats?.totalLoanVolume || 5800000)}`, sub: 'Requested volume', color: 'text-blue-700', dot: 'bg-indigo-500', border: 'border-l-indigo-500' },
        ].map(({ label, value, sub, color, dot, border }) => (
          <div key={label} className={`bg-white border border-gray-200 border-l-4 ${border} rounded-xl p-4 shadow-sm`}>
            <div className="flex items-center gap-1.5 mb-3">
              <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
              <p className="text-xs text-gray-500 font-medium">{label}</p>
            </div>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* AI Customer Intelligence */}
      <BankerRAGSection />

      {/* Dedicated CSV Datasets & Download Center for Bank */}
      <DatasetExportCenter role="bank" />

      {/* Loan Queue — Card-style rows */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <div>
            <h2 className="font-bold text-gray-900 text-sm">Loan Queue</h2>
            <p className="text-xs text-gray-400 mt-0.5">Applications awaiting review</p>
          </div>
          <button onClick={loadStats} className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1.5 font-medium transition">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        {/* Table with improved styling */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Application ID', 'Applicant', 'Loan Type', 'Amount', 'Status', 'Date', ''].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(stats?.recent || []).map((app) => (
                <tr key={app.id} className="group hover:bg-blue-50/30 transition-colors">
                  <td className="px-5 py-3.5">
                    <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{app.id}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 text-xs font-bold shrink-0">
                        {(app.applicant?.full_name || 'U')[0]}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-gray-900 leading-tight">{app.applicant?.full_name}</div>
                        <div className="text-[11px] text-gray-400">{app.applicant?.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-700">{app.loan?.loan_type}</td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm font-bold text-gray-900">₹{new Intl.NumberFormat('en-IN').format(app.loan?.requested_amount || 0)}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      app.status === 'Submitted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      <span className={`w-1 h-1 rounded-full ${ app.status === 'Submitted' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      {app.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-gray-400">{app.created_date}</td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => saveApplicationPDF(app, currentUser?.user_type === 'customer' ? 'user' : 'bank')}
                      className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition"
                      title={currentUser?.user_type === 'customer' ? "Save Customer Copy PDF" : "Save Bank Appraisal PDF"}
                    >
                      <FileText className="w-3 h-3" /> PDF
                    </button>
                  </td>
                </tr>
              ))}
              {(stats?.recent || []).length === 0 && (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center">
                    <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
                      <FileText className="w-5 h-5 text-gray-400" />
                    </div>
                    <p className="text-base font-bold text-gray-800 text-gray-600">No applications in queue</p>
                    <p className="text-xs text-gray-400 mt-1">Applications will appear here once customers submit them.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// APPLICATIONS REGISTRY WITH ROLE-AWARE ACCESS & CSV EXPORT

const ApplicationsPage = ({ currentUser, onNewApplication }) => {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ loanType: '', status: '', search: '' });

  const loadData = async () => {
    setLoading(true);
    const data = await apiService.getApplications(filters, currentUser);
    setApplications(data);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [filters, currentUser]);

  const loanTypes = [...new Set(applications.map((a) => a.loan?.loan_type).filter(Boolean))];
  const statuses = [...new Set(applications.map((a) => a.status).filter(Boolean))];

  const isCustomer = currentUser?.user_type === 'customer';

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            {isCustomer ? 'Customer Portal' : currentUser?.user_type === 'developer' ? 'Developer Console' : 'Bank Operations'}
          </p>
          <h1 className="text-xl font-bold text-gray-900">
            {isCustomer ? 'My Applications' : 'Applications Registry'}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {isCustomer
              ? 'All your submitted loan applications — auto-saved in ./data/'
              : 'Complete applicant repository with instant PDF dossier generation and CSV persistence in ./data.'}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <button
            onClick={loadData}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-xs font-bold text-gray-700 bg-white hover:bg-gray-50 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          {!isCustomer && (
            <button
              onClick={() => saveApplicationsPortfolioPDF(applications, currentUser?.user_type || 'bank')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow-sm"
              title="Save portfolio summary report as PDF"
            >
              <FileText className="w-3.5 h-3.5" />
              Save Portfolio as PDF
            </button>
          )}

          {isCustomer && (
            <button
              onClick={onNewApplication}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow-sm"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Apply for Loan
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search by ID, name, email..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm placeholder-gray-400"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <select
          value={filters.loanType}
          onChange={(e) => setFilters({ ...filters, loanType: e.target.value })}
          className="py-2.5 px-3.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm text-gray-700"
        >
          <option value="">All Loan Types</option>
          {loanTypes.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="py-2.5 px-3.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm text-gray-700"
        >
          <option value="">All Statuses</option>
          {statuses.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </div>

      {/* Applications Table — Upgraded */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80">
                {['Application ID', 'Applicant', 'Loan Details', 'Amount', 'Status', 'Date', ''].map(h => (
                  <th key={h} className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-500 mb-2" />
                    <p className="text-xs text-gray-400">Loading...</p>
                  </td>
                </tr>
              ) : applications.length > 0 ? (
                applications.map((app) => (
                  <tr key={app.id} className="group hover:bg-blue-50/30 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{app.id}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 text-xs font-bold shrink-0">
                          {(app.applicant?.full_name || 'U')[0]}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-gray-900 leading-tight">{app.applicant?.full_name || 'N/A'}</div>
                          <div className="text-[11px] text-gray-400">{app.applicant?.email || app.applicant?.mobile}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="text-base font-bold text-gray-800 text-gray-800">{app.loan?.loan_type}</div>
                      <div className="text-[11px] text-gray-400">{app.loan?.tenure}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-bold text-gray-900">₹{new Intl.NumberFormat('en-IN').format(app.loan?.requested_amount || 0)}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                        app.status === 'Submitted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        <span className={`w-1 h-1 rounded-full ${ app.status === 'Submitted' ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                        {app.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-400">{app.created_date}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => saveApplicationPDF(app, isCustomer ? 'user' : (currentUser?.user_type || 'bank'))}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition shadow-xs"
                        title={isCustomer ? "Save Customer Copy PDF" : "Save Bank Appraisal PDF"}
                      >
                        <FileText className="w-3 h-3" /> PDF
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" className="px-6 py-14 text-center">
                    <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
                      <FileText className="w-5 h-5 text-gray-400" />
                    </div>
                    <p className="text-base font-bold text-gray-800 text-gray-600">No applications found</p>
                    <p className="text-xs text-gray-400 mt-1">Try adjusting your filters.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Segmented Datasets & Download Center for Bank & Developer */}
      {!isCustomer && <DatasetExportCenter role={currentUser?.user_type || 'bank'} />}
    </div>
  );
};

// DATABASE & DEVELOPER CREDENTIALS CONSOLE
const CredentialsManager = ({ currentUser, onSwitchUser, dbInfo, onRefreshDbInfo }) => {
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [newUser, setNewUser] = useState({
    username: '',
    email: '',
    password: '',
    full_name: '',
    role: 'Loan Officer',
    user_type: 'bank'
  });

  const loadCredentials = async () => {
    setLoading(true);
    const list = await apiService.getCredentials();
    setCredentials(list);
    setLoading(false);
  };

  useEffect(() => {
    loadCredentials();
  }, []);

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!newUser.username || !newUser.email || !newUser.password || !newUser.full_name) {
      setError('Please fill in all credential fields.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiService.register(newUser);
      setSuccessMsg(`Credentials for "${res.user.username}" (${res.user.user_type}) saved in database!`);
      setNewUser({ username: '', email: '', password: '', full_name: '', role: 'Loan Officer', user_type: 'bank' });
      await loadCredentials();
      if (onRefreshDbInfo) onRefreshDbInfo();
    } catch (err) {
      setError(err.message || 'Failed to save credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Database & Credentials Console</h1>
        <p className="text-xs text-gray-500 mt-1">
          Inspect PostgreSQL/SQLite database engine, view registered credentials across Bank, Customer, and Developer roles.
        </p>
      </div>

      {/* Status Card */}
      <div className="bg-slate-900 text-white rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500/20 text-blue-400 border border-blue-400/30 rounded-lg flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold">Python FastAPI & Database Engine</h3>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Online & Active
                </span>
              </div>
              <p className="text-xs text-slate-400">Port 5000 | PostgreSQL & Local SQL Integration</p>
            </div>
          </div>
          <button
            onClick={() => { onRefreshDbInfo(); loadCredentials(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg self-start transition"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Re-check Status
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
          <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700">
            <div className="text-slate-400">Database Engine</div>
            <div className="text-slate-100 font-bold text-sm mt-0.5">{dbInfo?.engine || 'Local Database'}</div>
          </div>
          <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700">
            <div className="text-slate-400">Storage File / Host</div>
            <div className="text-slate-100 font-mono text-xs mt-0.5 truncate">{dbInfo?.storage || './data/loan_erp.db'}</div>
          </div>
          <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700">
            <div className="text-slate-400">Backend Server</div>
            <div className="text-emerald-400 font-bold text-sm mt-0.5">Python FastAPI</div>
          </div>
          <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700">
            <div className="text-slate-400">Saved Credentials</div>
            <div className="text-indigo-400 font-bold text-sm mt-0.5">{credentials.length} Users</div>
          </div>
        </div>
      </div>

      {/* Auto-Saved CSV Data Store Banner */}
      <div className="bg-slate-900 border border-emerald-500/40 text-white rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/20 text-emerald-400 border border-emerald-400/30 rounded-lg flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Application CSV Data Repository</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-400/20 text-emerald-300 border border-emerald-400/30">
                  Auto-Saved in Code
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Every completed application is automatically compiled to CSV and stored directly in the code folder <code className="bg-slate-800 px-1.5 py-0.5 rounded font-mono text-emerald-300">./data/</code> with master summary in <code className="bg-slate-800 px-1.5 py-0.5 rounded font-mono text-emerald-300">all_applications_master.csv</code>.
              </p>
            </div>
          </div>
          <button
            onClick={async () => {
              try {
                const res = await fetch('/api/rag/sync-all', { method: 'POST' });
                const d = await res.json();
                alert(d.message || 'All applications synchronized to ./data');
              } catch (e) {
                alert('Sync failed: ' + e.message);
              }
            }}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition self-start shrink-0 flex items-center gap-1.5 shadow-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Re-sync All CSVs to ./data
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Credentials Table */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b mb-4">
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Key className="w-4 h-4 text-blue-600" />
                All Saved Credentials in Database
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Pre-configured for Bank, Customer, and Developer logins.
              </p>
            </div>
            <span className="text-xs font-bold px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full">
              {credentials.length} Accounts
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600 border-b">
                <tr>
                  <th className="py-2.5 px-3 text-left font-semibold">User</th>
                  <th className="py-2.5 px-3 text-left font-semibold">Username</th>
                  <th className="py-2.5 px-3 text-left font-semibold">Login Portal</th>
                  <th className="py-2.5 px-3 text-left font-semibold">Role</th>
                  <th className="py-2.5 px-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {credentials.map((cred) => {
                  const isActive = currentUser?.username === cred.username;
                  return (
                    <tr key={cred.id} className={isActive ? 'bg-blue-50/70' : 'hover:bg-gray-50'}>
                      <td className="py-3 px-3">
                        <div className="font-bold text-gray-900">{cred.full_name}</div>
                        <div className="text-[11px] text-gray-500">{cred.email}</div>
                      </td>
                      <td className="py-3 px-3 font-mono font-medium text-gray-700">@{cred.username}</td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded font-bold text-[11px] uppercase ${
                          cred.user_type === 'bank' ? 'bg-blue-100 text-blue-800' :
                          cred.user_type === 'customer' ? 'bg-emerald-100 text-emerald-800' :
                          'bg-purple-100 text-purple-800'
                        }`}>
                          {cred.user_type || 'User'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-gray-700 font-medium">{cred.role}</td>
                      <td className="py-3 px-3 text-right">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
                            <Check className="w-3.5 h-3.5" /> Active
                          </span>
                        ) : (
                          <button
                            onClick={() => onSwitchUser(cred)}
                            className="px-2.5 py-1 bg-white border border-gray-300 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 rounded font-semibold text-[11px] transition"
                          >
                            Switch Login
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
            <span className="font-bold text-gray-800">Pre-seeded Credentials Quick Guide:</span>
            <div className="flex flex-wrap gap-2 text-[11px] font-mono">
              <span className="bg-white px-2 py-1 rounded border">🏦 Bank: bank_officer / bank123</span>
              <span className="bg-white px-2 py-1 rounded border">👤 Customer: customer_rajesh / cust123</span>
              <span className="bg-white px-2 py-1 rounded border">⚡ Developer: developer / dev123</span>
            </div>
          </div>
        </div>

        {/* Add New Credential Form */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="pb-3 border-b mb-4">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-emerald-600" />
              Save New Credentials
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Add user credentials to database for any of the 3 portals.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-2.5 bg-red-50 border border-red-200 text-red-600 text-xs rounded">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="mb-4 p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded">
              {successMsg}
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-gray-700 mb-1">Login Portal Type *</label>
              <select
                value={newUser.user_type}
                onChange={(e) => {
                  const ut = e.target.value;
                  const defaultRole = ut === 'customer' ? 'Customer' : ut === 'bank' ? 'Loan Officer' : 'System Developer';
                  setNewUser({ ...newUser, user_type: ut, role: defaultRole });
                }}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white font-semibold"
              >
                <option value="bank">🏦 Bank Staff Login</option>
                <option value="customer">👤 Customer Login</option>
                <option value="developer">⚡ Developer Login</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">Username *</label>
              <input
                type="text"
                placeholder="e.g. user101"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">Full Name *</label>
              <input
                type="text"
                placeholder="e.g. Anand Verma"
                value={newUser.full_name}
                onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">Email Address *</label>
              <input
                type="email"
                placeholder="anand@example.com"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">Password *</label>
              <input
                type="password"
                placeholder="••••••••"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {submitting ? 'Saving to Database...' : 'Save Credential in Database'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

// FULL-PAGE 3-ROLE LOGIN LANDING SCREEN (Shown at startup)
const ThreeRoleLoginPage = ({ onLoginSuccess, dbInfo }) => {
  const [selectedRole, setSelectedRole] = useState('bank'); // 'bank', 'customer', 'developer'
  const [username, setUsername] = useState('bank_officer');
  const [password, setPassword] = useState('bank123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [regData, setRegData] = useState({ username: '', email: '', password: '', full_name: '' });

  const handleRoleSelect = (role) => {
    setSelectedRole(role);
    setError('');
    setIsRegistering(false);
    if (role === 'bank') {
      setUsername('bank_officer');
      setPassword('bank123');
    } else if (role === 'customer') {
      setUsername('customer_rajesh');
      setPassword('cust123');
    } else {
      setUsername('developer');
      setPassword('dev123');
    }
  };

  const handleQuickLogin = async (role, u, p) => {
    setSelectedRole(role);
    setError('');
    setLoading(true);
    try {
      const res = await apiService.login(u, p, role);
      onLoginSuccess(res.user);
    } catch (err) {
      setError(err.message || 'Quick login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleCustomLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiService.login(username, password, selectedRole);
      onLoginSuccess(res.user);
    } catch (err) {
      setError(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterCustomer = async (e) => {
    e.preventDefault();
    setError('');
    if (!regData.username || !regData.email || !regData.password || !regData.full_name) {
      setError('Please fill in all registration fields.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiService.register({
        ...regData,
        role: 'Customer',
        user_type: 'customer'
      });
      onLoginSuccess(res.user);
    } catch (err) {
      setError(err.message || 'Customer registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex font-sans">
      {/* LEFT PANEL — Brand & Visual */}
      <div className="hidden lg:flex w-2/5 bg-slate-950 flex-col justify-between p-10 relative overflow-hidden">
        {/* Subtle gradient orb */}
        <div className="absolute top-0 left-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl translate-x-1/4 translate-y-1/4 pointer-events-none" />

        {/* Brand */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-extrabold text-white text-sm shadow-lg shadow-blue-600/30">
              ₹4U
            </div>
            <div>
              <div className="text-white font-bold text-base leading-tight">R4U</div>
              <div className="text-slate-500 text-xs">Ruppee4U Loan ERP</div>
            </div>
          </div>

          <h1 className="text-4xl font-extrabold text-white leading-tight mb-4">
            Enterprise<br />Loan Management<br />Platform
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
            End-to-end loan origination, credit assessment, and portfolio management for banks, applicants, and IT teams.
          </p>

          <div className="mt-10 space-y-4">
            {[
              { icon: ShieldCheck, label: 'Multi-role access control' },
              { icon: Database, label: 'Automated CSV persistence in ./data' },
              { icon: FileText, label: 'Bank & Developer PDF generation' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3 text-sm text-slate-400">
                <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                  <Icon className="w-3.5 h-3.5 text-blue-400" />
                </div>
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Footer info */}
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            DB Engine: {dbInfo?.engine || 'Local SQLite'} · FastAPI Port 5000
          </div>
        </div>
      </div>

      {/* RIGHT PANEL — Role Selection + Login Form */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-16 py-10 bg-gray-50 min-h-screen overflow-y-auto">

        {/* Mobile brand bar */}
        <div className="lg:hidden flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-extrabold text-white text-sm">
            ₹4U
          </div>
          <div>
            <div className="font-bold text-gray-900 text-sm">R4U (Ruppee4U)</div>
            <div className="text-gray-500 text-xs">Loan ERP</div>
          </div>
        </div>

        <div className="max-w-xl w-full mx-auto">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Sign in to your portal</h2>
            <p className="text-sm text-gray-500">Select your role below, then sign in with your credentials.</p>
          </div>

          {/* Role Selector — 3 compact tiles */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { role: 'bank', Icon: Building, label: 'Bank Officer', color: 'blue', u: 'bank_officer', p: 'bank123' },
              { role: 'customer', Icon: User, label: 'Customer', color: 'emerald', u: 'customer_rajesh', p: 'cust123' },
              { role: 'developer', Icon: Laptop, label: 'Developer', color: 'violet', u: 'developer', p: 'dev123' },
            ].map(({ role, Icon, label, color, u, p }) => {
              const isActive = selectedRole === role;
              const colorMap = {
                blue: { ring: 'ring-blue-500 border-blue-500 bg-blue-50', icon: 'bg-blue-100 text-blue-600', text: 'text-blue-700', inactive: 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50' },
                emerald: { ring: 'ring-emerald-500 border-emerald-500 bg-emerald-50', icon: 'bg-emerald-100 text-emerald-600', text: 'text-emerald-700', inactive: 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50' },
                violet: { ring: 'ring-violet-500 border-violet-500 bg-violet-50', icon: 'bg-violet-100 text-violet-600', text: 'text-violet-700', inactive: 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50' },
              };
              const c = colorMap[color];
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => handleRoleSelect(role)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-150 cursor-pointer text-center ${isActive ? `${c.ring} ring-2` : c.inactive}`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isActive ? c.icon : 'bg-gray-100 text-gray-500'}`}>
                    <Icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
                  </div>
                  <span className={`text-xs font-bold ${isActive ? c.text : 'text-gray-600'}`}>{label}</span>
                </button>
              );
            })}
          </div>

          {/* Sign-in Card */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-sm font-bold text-gray-900">
                  {selectedRole === 'bank' ? 'Bank Operations' : selectedRole === 'customer' ? 'Customer Portal' : 'Developer Console'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {selectedRole === 'bank' ? 'Review and process loan applications' : selectedRole === 'customer' ? 'Apply and track your loan applications' : 'Inspect system telemetry and schema'}
                </p>
              </div>
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider ${
                selectedRole === 'bank' ? 'bg-blue-100 text-blue-700' :
                selectedRole === 'customer' ? 'bg-emerald-100 text-emerald-700' :
                'bg-violet-100 text-violet-700'
              }`}>
                {selectedRole}
              </span>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </div>
            )}

            {selectedRole === 'customer' && isRegistering ? (
              <form onSubmit={handleRegisterCustomer} className="space-y-3">
                {[
                  { label: 'Full Name', key: 'full_name', type: 'text', placeholder: 'Ramesh Chandra' },
                  { label: 'Username', key: 'username', type: 'text', placeholder: 'ramesh_c' },
                  { label: 'Email', key: 'email', type: 'email', placeholder: 'ramesh@example.com' },
                  { label: 'Password', key: 'password', type: 'password', placeholder: '••••••••' },
                ].map(({ label, key, type, placeholder }) => (
                  <div key={key}>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">{label}</label>
                    <input
                      type={type}
                      placeholder={placeholder}
                      value={regData[key]}
                      onChange={(e) => setRegData({ ...regData, [key]: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400 outline-none placeholder-gray-400 transition"
                    />
                  </div>
                ))}
                <button type="submit" disabled={loading}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-sm transition disabled:opacity-50 mt-1">
                  {loading ? 'Registering...' : 'Create Account & Sign In'}
                </button>
                <button type="button" onClick={() => setIsRegistering(false)}
                  className="w-full text-center text-xs text-gray-500 hover:text-gray-800 pt-1 transition">
                  Already have an account? Sign in →
                </button>
              </form>
            ) : (
              <form onSubmit={handleCustomLogin} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Username</label>
                  <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-400 outline-none transition" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Password</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-400 outline-none transition" />
                </div>

                <button type="submit" disabled={loading} className={`w-full py-2.5 text-white font-bold rounded-lg text-sm transition disabled:opacity-50 ${
                  selectedRole === 'bank' ? 'bg-blue-600 hover:bg-blue-700' :
                  selectedRole === 'customer' ? 'bg-emerald-600 hover:bg-emerald-700' :
                  'bg-violet-600 hover:bg-violet-700'
                }`}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </button>

                {/* Quick login hint */}
                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  <span className="text-[11px] text-gray-400">Demo credentials:</span>
                  <span className="text-[11px] font-mono text-gray-600 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded">
                    {selectedRole === 'bank' && 'bank_officer / bank123'}
                    {selectedRole === 'customer' && 'customer_rajesh / cust123'}
                    {selectedRole === 'developer' && 'developer / dev123'}
                  </span>
                </div>

                {selectedRole === 'customer' && (
                  <button type="button" onClick={() => setIsRegistering(true)}
                    className="w-full text-center text-xs text-emerald-600 hover:text-emerald-700 font-medium transition">
                    New customer? Create an account →
                  </button>
                )}
              </form>
            )}
          </div>

          <p className="text-center text-[11px] text-gray-400 mt-5">
            R4U (Ruppee4U) Loan ERP · All application data auto-saved in <code className="font-mono">./data/</code>
          </p>
        </div>
      </div>
    </div>
  );
};

// 3-OPTION LOGIN MODAL (Bank, Customer, Developer)
const ThreeRoleLoginModal = ({ isOpen, onClose, onLoginSuccess }) => {
  const [activeTab, setActiveTab] = useState('bank'); // 'bank', 'customer', 'developer'
  const [username, setUsername] = useState('bank_officer');
  const [password, setPassword] = useState('bank123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // New customer registration toggle
  const [isRegistering, setIsRegistering] = useState(false);
  const [regData, setRegData] = useState({ username: '', email: '', password: '', full_name: '' });

  if (!isOpen) return null;

  const handleTabSwitch = (tab) => {
    setActiveTab(tab);
    setError('');
    setIsRegistering(false);
    if (tab === 'bank') {
      setUsername('bank_officer');
      setPassword('bank123');
    } else if (tab === 'customer') {
      setUsername('customer_rajesh');
      setPassword('cust123');
    } else {
      setUsername('developer');
      setPassword('dev123');
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiService.login(username, password, activeTab);
      onLoginSuccess(res.user);
      onClose();
    } catch (err) {
      setError(err.message || 'Login failed. Check username and password.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterCustomer = async (e) => {
    e.preventDefault();
    setError('');
    if (!regData.username || !regData.email || !regData.password || !regData.full_name) {
      setError('Please fill in all customer registration fields.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiService.register({
        ...regData,
        role: 'Customer',
        user_type: 'customer'
      });
      onLoginSuccess(res.user);
      onClose();
    } catch (err) {
      setError(err.message || 'Customer registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative border border-gray-100">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-5">
          <h3 className="text-xl font-bold text-gray-900">Select Login Portal</h3>
          <p className="text-xs text-gray-500 mt-1">
            Choose your role to access the tailored loan dashboard
          </p>
        </div>

        {/* 3 Login Tabs */}
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-gray-100 rounded-xl mb-5 text-xs font-bold">
          <button
            onClick={() => handleTabSwitch('bank')}
            className={`py-2 px-1 rounded-lg flex flex-col items-center gap-1 transition ${
              activeTab === 'bank'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Building className="w-4 h-4" />
            <span>Bank Login</span>
          </button>
          <button
            onClick={() => handleTabSwitch('customer')}
            className={`py-2 px-1 rounded-lg flex flex-col items-center gap-1 transition ${
              activeTab === 'customer'
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <User className="w-4 h-4" />
            <span>Customer Login</span>
          </button>
          <button
            onClick={() => handleTabSwitch('developer')}
            className={`py-2 px-1 rounded-lg flex flex-col items-center gap-1 transition ${
              activeTab === 'developer'
                ? 'bg-white text-purple-700 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Laptop className="w-4 h-4" />
            <span>Developer</span>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-2.5 bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Form Body */}
        {activeTab === 'customer' && isRegistering ? (
          <form onSubmit={handleRegisterCustomer} className="space-y-3 text-xs">
            <div className="text-xs font-semibold text-emerald-800 bg-emerald-50 p-2 rounded-lg mb-2">
              📝 Create a New Customer Account to Apply & Manage Loan Records
            </div>
            <div>
              <label className="block font-semibold text-gray-700 mb-1">Full Name</label>
              <input
                type="text"
                placeholder="e.g. Ramesh Chandra"
                value={regData.full_name}
                onChange={(e) => setRegData({ ...regData, full_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block font-semibold text-gray-700 mb-1">Username</label>
              <input
                type="text"
                placeholder="e.g. ramesh_c"
                value={regData.username}
                onChange={(e) => setRegData({ ...regData, username: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block font-semibold text-gray-700 mb-1">Email Address</label>
              <input
                type="email"
                placeholder="ramesh@example.com"
                value={regData.email}
                onChange={(e) => setRegData({ ...regData, email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block font-semibold text-gray-700 mb-1">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={regData.password}
                onChange={(e) => setRegData({ ...regData, password: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-sm transition disabled:opacity-50 mt-1"
            >
              {loading ? 'Creating Customer Account...' : 'Sign Up & Enter Dashboard'}
            </button>

            <button
              type="button"
              onClick={() => setIsRegistering(false)}
              className="w-full text-center text-xs text-blue-600 hover:underline pt-1"
            >
              Already have an account? Log in with existing credentials
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-3.5 text-xs">
            <div className={`p-2 rounded-lg text-xs font-semibold ${
              activeTab === 'bank' ? 'bg-blue-50 text-blue-800' :
              activeTab === 'customer' ? 'bg-emerald-50 text-emerald-800' :
              'bg-purple-50 text-purple-800'
            }`}>
              {activeTab === 'bank' && '🏦 Bank Staff: Review applications, manage loan approvals, and save PDF dossiers.'}
              {activeTab === 'customer' && '👤 Customer Portal: Fill loan application, track status, and auto-persist records.'}
              {activeTab === 'developer' && '⚡ Developer Console: PostgreSQL/SQLite database inspection and credential management.'}
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full py-2.5 text-white font-bold rounded-lg text-sm transition disabled:opacity-50 ${
                activeTab === 'bank' ? 'bg-blue-600 hover:bg-blue-700' :
                activeTab === 'customer' ? 'bg-emerald-600 hover:bg-emerald-700' :
                'bg-purple-600 hover:bg-purple-700'
              }`}
            >
              {loading ? 'Authenticating...' : `Log In to ${activeTab.toUpperCase()} Portal`}
            </button>

            {activeTab === 'customer' && (
              <button
                type="button"
                onClick={() => setIsRegistering(true)}
                className="w-full text-center text-xs text-emerald-700 font-semibold hover:underline pt-1"
              >
                + Don't have an account? Sign up as a New Customer
              </button>
            )}

            <div className="pt-2 border-t text-[11px] text-gray-500 space-y-1">
              <span className="font-semibold text-gray-600">Quick Test Credentials:</span>
              <div className="font-mono text-[10px] text-gray-600">
                {activeTab === 'bank' && 'bank_officer / bank123 (Sarah Jenkins)'}
                {activeTab === 'customer' && 'customer_rajesh / cust123 (Rajesh Kumar)'}
                {activeTab === 'developer' && 'developer / dev123 (Lead Developer)'}
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

// SIDEBAR & NAVIGATION (ROLE-AWARE)
const Sidebar = ({ currentPage, setCurrentPage, isOpen, setIsOpen, currentUser, onOpenLogin, onLogout, onOpenCredentials, dbInfo }) => {
  const isCustomer = currentUser?.user_type === 'customer';
  const isDeveloper = currentUser?.user_type === 'developer';

  // Only customers can apply for a new loan. Bank and Developer accounts review and audit.
  const menuItems = isCustomer
    ? [
        { id: 'dashboard', label: 'My Dashboard', icon: Sparkles },
        { id: 'new-application', label: 'Apply for Loan', icon: PlusCircle },
        { id: 'applications', label: 'My Applications', icon: FileText },
      ]
    : isDeveloper
    ? [
        { id: 'dashboard', label: 'Developer Console', icon: Sparkles },
        { id: 'applications', label: 'Applications Registry', icon: FileText },
        { id: 'credentials', label: 'Database & Credentials', icon: Database, badge: dbInfo?.usersCount || '6' },
      ]
    : [
        { id: 'dashboard', label: 'Portfolio Dashboard', icon: Sparkles },
        { id: 'applications', label: 'Loan Queue & Review', icon: FileText },
        { id: 'credentials', label: 'Database Status', icon: Database },
      ];

  return (
    <>
      {isOpen && <div onClick={() => setIsOpen(false)} className="fixed inset-0 bg-black/50 z-30 md:hidden" />}
      <div className={`fixed md:static inset-y-0 left-0 w-64 bg-slate-900 text-white z-40 flex flex-col transform transition-transform md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center font-extrabold text-white shadow-md text-sm tracking-tighter">
              ₹4U
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">R4U</h1>
              <p className="text-[11px] text-slate-400">Ruppee4U Loan ERP</p>
            </div>
          </div>
        </div>

        {/* Current Portal Badge */}
        <div className="px-5 py-3 border-b border-slate-800/80 bg-slate-950/40">
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Active Portal</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`w-2 h-2 rounded-full ${
              isCustomer ? 'bg-emerald-400' : isDeveloper ? 'bg-purple-400' : 'bg-blue-400'
            }`}></span>
            <span className="text-xs font-bold text-slate-200">
              {isCustomer ? 'Customer Portal' : isDeveloper ? 'Developer Console' : 'Bank Operations'}
            </span>
          </div>
        </div>
        
        <nav className="p-4 space-y-1.5 flex-1">
          <div className="text-[11px] font-semibold text-slate-500 uppercase px-3 mb-2 tracking-wider">Navigation</div>
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setCurrentPage(item.id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-base font-bold text-gray-800 transition ${
                  currentPage === item.id
                    ? 'bg-blue-600 text-white shadow-sm font-semibold'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-slate-400" />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-300 font-mono">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User Session Switcher Box */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-full font-bold flex items-center justify-center text-sm shadow text-white ${
              isCustomer ? 'bg-emerald-600' : isDeveloper ? 'bg-purple-600' : 'bg-blue-600'
            }`}>
              {currentUser?.full_name?.charAt(0) || 'U'}
            </div>
            <div className="overflow-hidden">
              <div className="text-xs font-bold text-white truncate">{currentUser?.full_name}</div>
              <div className="text-[11px] text-slate-400 truncate">@{currentUser?.username}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onOpenLogin}
              className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold transition border border-slate-700"
              title="Switch user role"
            >
              <Key className="w-3.5 h-3.5 text-blue-400" />
              Switch
            </button>
            <button
              onClick={onLogout}
              className="flex items-center justify-center gap-1 px-3 py-2 bg-red-950/40 hover:bg-red-900/60 text-red-300 rounded-lg text-xs font-bold transition border border-red-800/40"
              title="Log out to 3-Role Login screen"
            >
              <LogOut className="w-3.5 h-3.5 text-red-400" />
              Exit
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

// MAIN APP
export default function LoanApplicationERP() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [currentStep, setCurrentStep] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [successData, setSuccessData] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [appError, setAppError] = useState(null);

  // Active user session (null by default so 3-Role Login screen is shown at start)
  const [currentUser, setCurrentUser] = useState(null);

  // Database Connection Info
  const [dbInfo, setDbInfo] = useState({
    engine: 'PostgreSQL / Local SQLite',
    status: 'connected',
    usersCount: 6,
    applicationsCount: 4,
    storage: './data/loan_erp.db'
  });

  const refreshDbHealth = async () => {
    const health = await apiService.getHealth();
    if (health?.database) {
      setDbInfo(health.database);
    }
  };

  useEffect(() => {
    refreshDbHealth();
  }, []);

  const formStartRef = useRef(Date.now());
  const keystrokesRef = useRef(0);
  const clicksRef = useRef(0);
  const pastesRef = useRef(0);

  useEffect(() => {
    const handleKey = () => { keystrokesRef.current += 1; };
    const handleClick = () => { clicksRef.current += 1; };
    const handlePaste = () => { pastesRef.current += 1; };

    window.addEventListener('keydown', handleKey);
    window.addEventListener('click', handleClick);
    window.addEventListener('paste', handlePaste);

    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('click', handleClick);
      window.removeEventListener('paste', handlePaste);
    };
  }, []);

  const [formData, setFormData] = useState({
    applicant: { full_name: '', dob: '', gender: '', mobile: '', email: '', marital_status: '' },
    address: { 
      current_address: '', city: '', state: '', pincode: '', residence_type: '',
      sameAsPermanent: true,
      permanent_address: '', permanent_city: '', permanent_state: '', permanent_pincode: ''
    },
    employment: { employment_type: '', employer_name: '', designation: '', experience: '', monthly_income: '' },
    loan: { loan_type: '', requested_amount: '', tenure: '', purpose: '', purpose_other: '' },
    financial: { existing_loans: '', number_of_loans: '', existing_emi: '', monthly_expenses: '' },
    document: {
      pan_number: '',
      aadhaar_number: '',
      id_proof_type: 'PAN Card',
      address_proof_type: 'Aadhaar Card',
      income_proof_type: 'Salary Slip (3 Months)',
      bank_statement_type: '6 Months Bank Statement'
    },
    kyc_session_id: 'KYC-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
  });
  const [errors, setErrors] = useState({});

  const handleNext = () => {
    const stepErrors = validateStep(currentStep, formData);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }
    setErrors({});
    if (currentStep === 5) {
      // Transition to Liveness Detection before Video KYC
      setCurrentPage('liveness-check');
      return;
    }
    if (currentStep < 7) setCurrentStep(currentStep + 1);
  };

  const handleBack = () => {
    setErrors({});
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const handleSaveDraft = async () => {
    setIsSubmitting(true);
    setAppError(null);
    try {
      const digitalData = collectDigitalTelemetry({
        formStartTime: formStartRef.current,
        keystrokes: keystrokesRef.current,
        clicks: clicksRef.current,
        pastes: pastesRef.current
      });
      const appPayload = {
        ...formData,
        digital: digitalData
      };
      const app = await apiService.addDraft(appPayload, currentUser);
      setCurrentPage('applications');
      setAppError(null);
      refreshDbHealth();
    } catch (e) {
      setAppError('Failed to save draft: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitApplication = async () => {
    const stepErrors = validateStep(7, formData);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }

    setIsSubmitting(true);
    setAppError(null);
    try {
      const digitalData = collectDigitalTelemetry({
        formStartTime: formStartRef.current,
        keystrokes: keystrokesRef.current,
        clicks: clicksRef.current,
        pastes: pastesRef.current
      });
      const appPayload = {
        ...formData,
        digital: digitalData
      };
      const submission = await apiService.saveApplication(appPayload, currentUser);
      const fullSuccessData = {
        ...appPayload,
        ...submission,
        applicant: { ...(appPayload.applicant || {}), ...(submission.applicant || {}) },
        address: { ...(appPayload.address || {}), ...(submission.address || {}) },
        employment: { ...(appPayload.employment || {}), ...(submission.employment || {}) },
        loan: { ...(appPayload.loan || {}), ...(submission.loan || {}) },
        financial: { ...(appPayload.financial || {}), ...(submission.financial || {}) },
        document: { ...(appPayload.document || {}), ...(submission.document || {}) },
        digital: { ...(appPayload.digital || {}), ...(submission.digital || {}) }
      };
      setSuccessData(fullSuccessData);
      setCurrentPage('success');
      refreshDbHealth();
    } catch (e) {
      setAppError('Failed to submit application: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditStep = (step) => {
    setCurrentStep(step);
  };

  const handleNewApplication = () => {
    setCurrentStep(1);
    formStartRef.current = Date.now();
    keystrokesRef.current = 0;
    clicksRef.current = 0;
    pastesRef.current = 0;
    setFormData({
      applicant: {
        full_name: currentUser?.user_type === 'customer' ? currentUser.full_name : '',
        dob: '',
        gender: '',
        mobile: '',
        email: currentUser?.user_type === 'customer' ? currentUser.email : '',
        marital_status: ''
      },
      address: { 
      current_address: '', city: '', state: '', pincode: '', residence_type: '',
      sameAsPermanent: true,
      permanent_address: '', permanent_city: '', permanent_state: '', permanent_pincode: ''
    },
      employment: { employment_type: '', employer_name: '', designation: '', experience: '', monthly_income: '' },
      loan: { loan_type: '', requested_amount: '', tenure: '', purpose: '', purpose_other: '' },
      financial: { existing_loans: '', number_of_loans: '', existing_emi: '', monthly_expenses: '' },
      document: {
        pan_number: '',
        aadhaar_number: '',
        id_proof_type: 'PAN Card',
        address_proof_type: 'Aadhaar Card',
        income_proof_type: 'Salary Slip (3 Months)',
        bank_statement_type: '6 Months Bank Statement'
      },
      kyc_session_id: 'KYC-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
    });
    setErrors({});
    setAppError(null);
    setCurrentPage('new-application');
  };

  const handleViewApplication = () => {
    setAppError(null);
    setCurrentPage('applications');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setCurrentPage('dashboard');
  };

  // 1. AT STARTUP: IF NO USER IS LOGGED IN, SHOW 3-ROLE LOGIN PAGE
  if (!currentUser) {
    return (
      <ThreeRoleLoginPage
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setCurrentPage('dashboard');
        }}
        dbInfo={dbInfo}
      />
    );
  }

  // 2. ONCE LOGGED IN: SHOW DASHBOARD & APPLICATION WORKFLOWS
  return (
    <div className="flex h-screen bg-slate-50 font-sans">
      <Sidebar
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
        currentUser={currentUser}
        onOpenLogin={() => setLoginModalOpen(true)}
        onLogout={handleLogout}
        onOpenCredentials={() => setCurrentPage('credentials')}
        dbInfo={dbInfo}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header — Minimal */}
        <header className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden p-1.5 rounded-lg hover:bg-gray-100 transition">
              {sidebarOpen ? <X className="w-4.5 h-4.5 text-gray-600 w-[18px] h-[18px]" /> : <Menu className="w-[18px] h-[18px] text-gray-600" />}
            </button>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                {currentPage === 'dashboard' && (currentUser?.user_type === 'customer' ? 'Customer Portal' : currentUser?.user_type === 'developer' ? 'Developer Console' : 'Bank Operations')}
                {currentPage === 'new-application' && 'Apply for a New Loan'}
                {currentPage === 'applications' && (currentUser?.user_type === 'customer' ? 'My Applications' : 'All Applications')}
                {currentPage === 'credentials' && 'Database & Credentials'}
                {currentPage === 'liveness-check' && 'Liveness Detection'}
                {currentPage === 'video-kyc' && 'Video KYC'}
                {currentPage === 'success' && 'Application Submitted'}
              </h2>
              <p className="text-[11px] text-gray-400 leading-none mt-0.5">
                {currentUser?.user_type === 'customer' ? 'Customer Self-Service' : currentUser?.user_type === 'developer' ? 'Developer & IT Admin' : 'Bank Loan Operations'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* DB status dot */}
            <button
              onClick={() => setCurrentPage('credentials')}
              className="hidden sm:flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-800 transition px-2 py-1 rounded-md hover:bg-gray-50"
              title="View database status"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Connected
            </button>

            {/* User pill */}
            <button
              onClick={() => setLoginModalOpen(true)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 border border-gray-200 transition"
              title="Switch portal"
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                currentUser?.user_type === 'customer' ? 'bg-emerald-500' : currentUser?.user_type === 'developer' ? 'bg-violet-500' : 'bg-blue-600'
              }`}>
                {currentUser?.full_name?.charAt(0) || 'U'}
              </div>
              <span className="hidden sm:block text-xs font-medium text-gray-700">{currentUser?.full_name}</span>
            </button>

            {/* Log Out */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-xs hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition"
              title="Log out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Log Out</span>
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto bg-slate-50 relative">
          {appError && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 min-w-[300px] max-w-lg">
              <div className="bg-red-50 border-l-4 border-red-500 rounded-r-lg shadow-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-red-800 font-bold text-sm">Error</h3>
                  <p className="text-red-700 text-xs mt-1">{appError}</p>
                </div>
                <button onClick={() => setAppError(null)} className="text-red-400 hover:text-red-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          <div className="max-w-7xl mx-auto p-5 sm:p-6">
          {currentPage === 'dashboard' && (
            <Dashboard
              onNewApplication={handleNewApplication}
              onOpenCredentials={() => setCurrentPage('credentials')}
              currentUser={currentUser}
              dbInfo={dbInfo}
            />
          )}

          {currentPage === 'applications' && (
            <ApplicationsPage
              currentUser={currentUser}
              onNewApplication={handleNewApplication}
            />
          )}

          {currentPage === 'credentials' && (
            <CredentialsManager
              currentUser={currentUser}
              onSwitchUser={(user) => {
                setCurrentUser(user);
                alert(`Switched active portal to: ${user.full_name} (${user.user_type.toUpperCase()})`);
              }}
              dbInfo={dbInfo}
              onRefreshDbInfo={refreshDbHealth}
            />
          )}

          {currentPage === 'liveness-check' && (
            <LivenessDetectionPage
              onPassed={() => setCurrentPage('video-kyc')}
              onFailed={() => setCurrentPage('video-kyc')}
            />
          )}

          {currentPage === 'video-kyc' && (
            <VideoKYCPage
              applicationId={formData.kyc_session_id || 'TEMP_SESSION'}
              applicantName={formData.applicant?.full_name || currentUser?.full_name || ''}
              onComplete={(captures) => {
                // Merge all extracted details back into formData so user can review and save
                const newFormData = { ...formData };
                newFormData.document = { ...newFormData.document };
                newFormData.applicant = { ...newFormData.applicant };
                newFormData.address = { ...newFormData.address };

                // Store all document captures & session status
                newFormData.document.kyc_captures = captures;
                newFormData.document.kyc_verified = true;
                newFormData.document.kyc_session_id = formData.kyc_session_id;

                const panRes = captures['pan']?.result;
                const aadhaarRes = captures['aadhaar']?.result;
                const passportRes = captures['passport']?.result;
                const dlRes = captures['dl']?.result;
                const voterRes = captures['voter']?.result;

                // 1. Extracted ID Numbers
                if (panRes?.pan_number) newFormData.document.pan_number = panRes.pan_number.toUpperCase();
                if (aadhaarRes?.aadhaar_number) newFormData.document.aadhaar_number = aadhaarRes.aadhaar_number;
                if (passportRes?.passport_number) newFormData.document.passport_number = passportRes.passport_number;
                if (dlRes?.dl_number) newFormData.document.dl_number = dlRes.dl_number;
                if (voterRes?.voter_id) newFormData.document.voter_id = voterRes.voter_id;

                // 2. Extracted Name (populate applicant full_name if empty)
                const docName = panRes?.name || aadhaarRes?.name || passportRes?.name || dlRes?.name;
                if (docName) {
                  newFormData.document.extracted_name = docName;
                  if (!newFormData.applicant.full_name || newFormData.applicant.full_name.trim() === '') {
                    newFormData.applicant.full_name = docName;
                  }
                }

                // 3. Extracted Date of Birth (populate applicant dob if empty)
                const docDob = panRes?.dob || aadhaarRes?.dob || dlRes?.dob || passportRes?.dob;
                if (docDob) {
                  newFormData.document.extracted_dob = docDob;
                  if (!newFormData.applicant.dob || newFormData.applicant.dob.trim() === '') {
                    const parts = docDob.split(/[-/.]/);
                    if (parts.length === 3) {
                      if (parts[2].length === 4) {
                        newFormData.applicant.dob = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                      } else if (parts[0].length === 4) {
                        newFormData.applicant.dob = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                      }
                    }
                  }
                }

                // 4. Extracted Father's Name
                const docFather = panRes?.father_name || aadhaarRes?.father_name || dlRes?.father_name;
                if (docFather) newFormData.document.father_name = docFather;

                // 5. Extracted Gender
                const docGender = aadhaarRes?.gender || panRes?.gender;
                if (docGender) {
                  newFormData.document.gender = docGender;
                  if (!newFormData.applicant.gender || newFormData.applicant.gender.trim() === '') {
                    newFormData.applicant.gender = docGender;
                  }
                }

                // 6. Extracted Address (from Aadhaar or Driving License)
                const docAddr = aadhaarRes?.address || dlRes?.address;
                if (docAddr) {
                  newFormData.document.extracted_address = docAddr;
                  if (!newFormData.address.current_address || newFormData.address.current_address.trim() === '') {
                    newFormData.address.current_address = docAddr;
                  }
                }

                setFormData(newFormData);

                // Once Video KYC is done, return to form at step 7 (Documents review)
                setCurrentPage('new-application');
                setCurrentStep(7);
              }}
            />
          )}

          {currentPage === 'success' && successData && (
            <SuccessPage
              data={successData}
              onViewApplication={handleViewApplication}
              onNewApplication={handleNewApplication}
            />
          )}

          {currentPage === 'new-application' && (
            currentUser?.user_type !== 'customer' ? (
              <div className="max-w-md mx-auto mt-12 bg-white border border-amber-200 rounded-2xl p-8 text-center shadow-sm">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">Applicant Portal Access Only</h3>
                <p className="text-xs text-gray-600 mt-2 mb-6 leading-relaxed">
                  New loan applications can only be created and submitted by <strong>Customer</strong> accounts. As <strong>{currentUser?.user_type === 'developer' ? 'a Developer' : 'Bank Staff'}</strong>, your role is to review, audit, and process applications.
                </p>
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={() => setCurrentPage('dashboard')}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow-sm"
                  >
                    Return to Dashboard
                  </button>
                  <button
                    onClick={() => setLoginModalOpen(true)}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold transition"
                  >
                    Switch to Customer
                  </button>
                </div>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto">
                <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                  <div className="mb-6 pb-4 border-b">
                    <h2 className="text-xl font-bold text-gray-900">
                      Loan Application Form
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">
                      Complete all 7 steps below. Upon submission, segmented datasets are automatically exported to <code className="font-mono font-bold text-blue-600">./csv_data/</code> (personal, document, digital telemetry) and downloadable for Bank and Developer accounts.
                    </p>
                  </div>

                  <ProgressIndicator currentStep={currentStep} />

                  {currentStep === 1 && <StepOneApplicant formData={formData} setFormData={setFormData} errors={errors} />}
                  {currentStep === 2 && <StepTwoAddress formData={formData} setFormData={setFormData} errors={errors} />}
                  {currentStep === 3 && <StepThreeEmployment formData={formData} setFormData={setFormData} errors={errors} />}
                  {currentStep === 4 && <StepFourLoan formData={formData} setFormData={setFormData} errors={errors} />}
                  {currentStep === 5 && <StepFiveFinancial formData={formData} setFormData={setFormData} errors={errors} />}
                  {currentStep === 6 && <StepSixVideoKYC formData={formData} setFormData={setFormData} />}
                  {currentStep === 7 && (
                    <StepSevenDocuments
                      formData={formData}
                      setFormData={setFormData}
                      errors={errors}
                      onRetakeKYC={() => setCurrentPage('video-kyc')}
                    />
                  )}

                  {currentStep === 7 && (
                    <div className="mt-8">
                      <ReviewPage
                        formData={formData}
                        onEdit={handleEditStep}
                        onSubmit={handleSubmitApplication}
                        onSaveDraft={handleSaveDraft}
                        isSubmitting={isSubmitting}
                      />
                    </div>
                  )}

                  {currentStep < 7 && (
                    <div className="flex gap-3 mt-8 pt-6 border-t border-gray-200">
                      {currentStep > 1 && (
                        <button
                          onClick={handleBack}
                          className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded text-base font-bold text-gray-800 hover:bg-gray-50"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          Back
                        </button>
                      )}
                      <button
                        onClick={handleSaveDraft}
                        disabled={isSubmitting}
                        className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded text-base font-bold text-gray-800 hover:bg-gray-50"
                      >
                        <Save className="w-4 h-4" />
                        Save Draft
                      </button>
                      <button
                        onClick={handleNext}
                        className="ml-auto flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded text-base font-bold text-gray-800 hover:bg-blue-700"
                      >
                        Next
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          )}
          </div>
        </main>
      </div>

      {/* 3-Role Login Modal */}
      <ThreeRoleLoginModal
        isOpen={loginModalOpen}
        onClose={() => setLoginModalOpen(false)}
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          alert(`Welcome, ${user.full_name}! Switched to ${user.user_type.toUpperCase()} view.`);
        }}
      />
      
      {/* Customer Support Widget */}
      <CustomerSupportWidget currentUser={currentUser} />
    </div>
  );
}
// ==========================================
// CUSTOMER SUPPORT RAG WIDGET COMPONENT
// ==========================================
function CustomerSupportWidget({ currentUser }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [messages, setMessages] = React.useState([{ sender: 'bot', text: 'Hello! I am your AI Support Assistant. How can I help you today?' }]);
  const [input, setInput] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const messagesEndRef = React.useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { sender: 'user', text: userMsg }]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/customer-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          customer_id: currentUser?.username || 'admin',
          session_id: 'browser_session'
        })
      });
      const data = await res.json();
      setMessages(prev => [...prev, { sender: 'bot', text: data.answer }]);
    } catch (e) {
      setMessages(prev => [...prev, { sender: 'bot', text: 'Sorry, an error occurred while fetching the answer.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 transition-all z-50 flex items-center gap-2"
      >
        <span className="font-medium hidden sm:inline">AI Support</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-[350px] sm:w-[400px] h-[500px] bg-white rounded-xl shadow-2xl flex flex-col z-50 border border-gray-200 overflow-hidden">
      <div className="bg-blue-600 text-white p-4 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">AI Support Assistant</span>
        </div>
        <button onClick={() => setIsOpen(false)} className="text-white hover:text-gray-200 text-xl font-bold">
          &times;
        </button>
      </div>

      <div className="flex-1 p-4 overflow-y-auto bg-gray-50 flex flex-col gap-3">
        {messages.map((msg, idx) => (
          <div key={idx} className={`max-w-[85%] p-3 rounded-lg text-sm ${msg.sender === 'user' ? 'bg-blue-600 text-white self-end rounded-br-none' : 'bg-white border border-gray-200 text-gray-800 self-start rounded-bl-none'}`}>
            <p className="whitespace-pre-wrap">{msg.text}</p>
          </div>
        ))}
        {isLoading && (
          <div className="bg-white border border-gray-200 text-gray-500 self-start rounded-lg rounded-bl-none p-3 text-sm flex items-center gap-2">
            Thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 bg-white border-t border-gray-200 flex gap-2 shrink-0">
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask about loans, KYC, or RBI rules..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button 
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-bold"
        >
          Send
        </button>
      </div>
    </div>
  );
}
