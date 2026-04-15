import { useState, useEffect, useCallback, useRef } from "react";

// ==================== FIREBASE CONFIG ====================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB1lmbOyvOCGftGPVmBMPwMfmeEqnbcAaw",
  authDomain: "egitim-yonetim-platformu.firebaseapp.com",
  projectId: "egitim-yonetim-platformu",
  storageBucket: "egitim-yonetim-platformu.appspot.com",
  messagingSenderId: "386aborting",
  appId: "1:386:web:placeholder"
};

// ==================== FIRESTORE HELPERS ====================
const FB_BASE = `https://firestore.googleapis.com/v1/projects/egitim-yonetim-platformu/databases/(default)/documents`;

const toFsValue = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === "object") {
    const fields = {};
    Object.entries(v).forEach(([k, val]) => { fields[k] = toFsValue(val); });
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
};

const fromFsValue = (v) => {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ("mapValue" in v) {
    const obj = {};
    Object.entries(v.mapValue.fields || {}).forEach(([k, val]) => { obj[k] = fromFsValue(val); });
    return obj;
  }
  if ("timestampValue" in v) return v.timestampValue;
  return null;
};

const parseDoc = (doc) => {
  if (!doc || !doc.fields) return null;
  const data = {};
  Object.entries(doc.fields).forEach(([k, v]) => { data[k] = fromFsValue(v); });
  const nameParts = doc.name.split("/");
  data._id = nameParts[nameParts.length - 1];
  return data;
};

const fsFields = (obj) => {
  const fields = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (k !== "_id") fields[k] = toFsValue(v);
  });
  return fields;
};

// Auth helper
const AUTH_BASE = "https://identitytoolkit.googleapis.com/v1";
const API_KEY = "AIzaSyB1lmbOyvOCGftGPVmBMPwMfmeEqnbcAaw";

const signIn = async (email, password) => {
  const res = await fetch(`${AUTH_BASE}/accounts:signInWithPassword?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  if (!res.ok) throw new Error("Giriş başarısız");
  return res.json();
};

const signUp = async (email, password) => {
  const res = await fetch(`${AUTH_BASE}/accounts:signUp?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  if (!res.ok) throw new Error("Kayıt başarısız");
  return res.json();
};

const refreshToken = async (rToken) => {
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${rToken}`
  });
  if (!res.ok) throw new Error("Token yenilenemedi");
  const data = await res.json();
  return { idToken: data.id_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
};

// Firestore CRUD
const fsGet = async (path, token) => {
  const res = await fetch(`${FB_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return res.json();
};

const fsList = async (collection, token, filters) => {
  let url = `${FB_BASE}/${collection}`;
  if (filters) {
    // Use structured query for filters
    const body = {
      structuredQuery: {
        from: [{ collectionId: collection.split("/").pop() }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: filters.map(f => ({
              fieldFilter: {
                field: { fieldPath: f.field },
                op: f.op || "EQUAL",
                value: toFsValue(f.value)
              }
            }))
          }
        }
      }
    };
    const parentPath = collection.includes("/")
      ? collection.split("/").slice(0, -1).join("/")
      : "";
    const queryUrl = `${FB_BASE}${parentPath ? "/" + parentPath : ""}:runQuery`;
    const res = await fetch(queryUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.filter(d => d.document).map(d => parseDoc(d.document));
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.documents || []).map(parseDoc);
};

const fsCreate = async (collection, docData, token, docId) => {
  let url = `${FB_BASE}/${collection}`;
  if (docId) url += `?documentId=${docId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: fsFields(docData) })
  });
  if (!res.ok) throw new Error("Kayıt oluşturulamadı");
  return parseDoc(await res.json());
};

const fsUpdate = async (path, docData, token) => {
  const fields = fsFields(docData);
  const updateMask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join("&");
  const res = await fetch(`${FB_BASE}/${path}?${updateMask}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) throw new Error("Güncelleme başarısız");
  return parseDoc(await res.json());
};

const fsDelete = async (path, token) => {
  await fetch(`${FB_BASE}/${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
};

// Storage upload
const uploadImage = async (file, path, token) => {
  const bucket = "egitim-yonetim-platformu.appspot.com";
  const encodedPath = encodeURIComponent(path);
  const res = await fetch(
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?uploadType=media`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type
      },
      body: file
    }
  );
  if (!res.ok) throw new Error("Görsel yüklenemedi");
  const data = await res.json();
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
};

// ==================== QR CODE GENERATOR ====================
const generateQR = (text, size = 200) => {
  // QR Code generation using a simple API
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&margin=8&format=svg`;
};

// ==================== ICONS ====================
const Icon = ({ name, size = 20 }) => {
  const icons = {
    store: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    qr: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="4" height="4" rx="0.5"/><line x1="22" y1="14" x2="22" y2="22"/><line x1="14" y1="22" x2="22" y2="22"/><line x1="22" y1="18" x2="18" y2="18"/></svg>,
    box: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
    tag: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
    percent: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>,
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    edit: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    trash: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    logout: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
    search: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    grid: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
    users: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    printer: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>,
    image: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
    x: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    chevDown: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>,
    campaign: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    barcode: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5v14"/><path d="M8 5v14"/><path d="M12 5v14"/><path d="M17 5v14"/><path d="M21 5v14"/></svg>,
    back: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
    cart: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>,
    upload: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
    settings: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  };
  return icons[name] || null;
};

// ==================== FORMAT HELPERS ====================
const formatPrice = (price) => {
  if (!price && price !== 0) return "0,00 ₺";
  return Number(price).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
};

const formatDate = (d) => {
  if (!d) return "";
  const date = new Date(d);
  return date.toLocaleDateString("tr-TR");
};

// ==================== STYLES ====================
const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --bg-primary: #0a0e1a;
  --bg-secondary: #111827;
  --bg-card: #1a2035;
  --bg-hover: #232b42;
  --bg-input: #0f1629;
  --border: #2a3454;
  --border-focus: #3b82f6;
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --accent-soft: rgba(59, 130, 246, 0.12);
  --success: #10b981;
  --success-soft: rgba(16, 185, 129, 0.12);
  --danger: #ef4444;
  --danger-soft: rgba(239, 68, 68, 0.12);
  --warning: #f59e0b;
  --warning-soft: rgba(245, 158, 11, 0.12);
  --purple: #8b5cf6;
  --purple-soft: rgba(139, 92, 246, 0.12);
  --radius: 12px;
  --radius-sm: 8px;
  --shadow: 0 4px 24px rgba(0,0,0,0.3);
}

* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'DM Sans', sans-serif; background: var(--bg-primary); color: var(--text-primary); min-height: 100vh; }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

/* Toast */
.toast {
  position: fixed; top: 20px; right: 20px; padding: 14px 24px;
  border-radius: var(--radius-sm); font-size: 14px; font-weight: 500;
  z-index: 9999; animation: slideIn 0.3s ease, fadeOut 0.3s ease 2.7s;
  box-shadow: var(--shadow);
}
.toast.success { background: var(--success); color: white; }
.toast.error { background: var(--danger); color: white; }
.toast.info { background: var(--accent); color: white; }

@keyframes slideIn { from { transform: translateX(100%); opacity:0; } to { transform: translateX(0); opacity:1; } }
@keyframes fadeOut { from { opacity:1; } to { opacity:0; } }

/* Auth Page */
.auth-page {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #0a0e1a 0%, #111827 50%, #0f172a 100%);
  padding: 20px;
}
.auth-card {
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 20px;
  padding: 48px 40px; width: 100%; max-width: 420px; box-shadow: var(--shadow);
}
.auth-logo { text-align: center; margin-bottom: 36px; }
.auth-logo h1 { font-size: 28px; font-weight: 700; background: linear-gradient(135deg, #3b82f6, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.auth-logo p { color: var(--text-secondary); font-size: 14px; margin-top: 8px; }

/* Form */
.form-group { margin-bottom: 20px; }
.form-label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 8px; }
.form-input {
  width: 100%; padding: 12px 16px; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-sm); color: var(--text-primary); font-size: 15px; font-family: inherit;
  transition: all 0.2s;
}
.form-input:focus { outline: none; border-color: var(--border-focus); box-shadow: 0 0 0 3px var(--accent-soft); }
.form-input::placeholder { color: var(--text-muted); }
select.form-input { cursor: pointer; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 14px center; padding-right: 36px; }
textarea.form-input { resize: vertical; min-height: 80px; }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; gap: 8px; padding: 11px 22px;
  border-radius: var(--radius-sm); font-size: 14px; font-weight: 600; font-family: inherit;
  border: none; cursor: pointer; transition: all 0.2s; white-space: nowrap;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--accent); color: white; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); }
.btn-secondary { background: var(--bg-hover); color: var(--text-primary); border: 1px solid var(--border); }
.btn-secondary:hover:not(:disabled) { background: var(--border); }
.btn-danger { background: var(--danger-soft); color: var(--danger); }
.btn-danger:hover:not(:disabled) { background: var(--danger); color: white; }
.btn-success { background: var(--success-soft); color: var(--success); }
.btn-success:hover:not(:disabled) { background: var(--success); color: white; }
.btn-warning { background: var(--warning-soft); color: var(--warning); }
.btn-warning:hover:not(:disabled) { background: var(--warning); color: white; }
.btn-icon { padding: 8px; border-radius: var(--radius-sm); }
.btn-full { width: 100%; justify-content: center; padding: 14px; font-size: 15px; }
.btn-sm { padding: 7px 14px; font-size: 13px; }

/* Layout */
.app-layout { display: flex; min-height: 100vh; }
.sidebar {
  width: 260px; background: var(--bg-secondary); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; position: fixed; top: 0; left: 0; bottom: 0; z-index: 50;
}
.sidebar-header { padding: 24px 20px; border-bottom: 1px solid var(--border); }
.sidebar-header h2 { font-size: 18px; font-weight: 700; background: linear-gradient(135deg, #3b82f6, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.sidebar-header p { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
.sidebar-nav { flex: 1; padding: 12px; overflow-y: auto; }
.sidebar-item {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  border-radius: var(--radius-sm); color: var(--text-secondary); cursor: pointer;
  transition: all 0.15s; font-size: 14px; font-weight: 500; margin-bottom: 4px;
}
.sidebar-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.sidebar-item.active { background: var(--accent-soft); color: var(--accent); }
.sidebar-footer { padding: 16px; border-top: 1px solid var(--border); }

.main-content { flex: 1; margin-left: 260px; padding: 32px; min-height: 100vh; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; flex-wrap: wrap; gap: 16px; }
.page-header h1 { font-size: 24px; font-weight: 700; }
.page-header-actions { display: flex; gap: 10px; flex-wrap: wrap; }

/* Cards */
.card {
  background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 24px; margin-bottom: 20px;
}
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.card-title { font-size: 16px; font-weight: 600; }

/* Stats */
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
.stat-card {
  background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 20px; display: flex; align-items: center; gap: 16px;
}
.stat-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
.stat-icon.blue { background: var(--accent-soft); color: var(--accent); }
.stat-icon.green { background: var(--success-soft); color: var(--success); }
.stat-icon.purple { background: var(--purple-soft); color: var(--purple); }
.stat-icon.orange { background: var(--warning-soft); color: var(--warning); }
.stat-value { font-size: 24px; font-weight: 700; }
.stat-label { font-size: 13px; color: var(--text-muted); margin-top: 2px; }

/* Table */
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
td { padding: 14px 16px; font-size: 14px; border-bottom: 1px solid var(--border); vertical-align: middle; }
tr:hover td { background: var(--bg-hover); }
.table-actions { display: flex; gap: 6px; }

/* Badge */
.badge {
  display: inline-flex; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;
}
.badge-blue { background: var(--accent-soft); color: var(--accent); }
.badge-green { background: var(--success-soft); color: var(--success); }
.badge-red { background: var(--danger-soft); color: var(--danger); }
.badge-orange { background: var(--warning-soft); color: var(--warning); }
.badge-purple { background: var(--purple-soft); color: var(--purple); }

/* Modal */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px;
}
.modal {
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px;
  width: 100%; max-width: 560px; max-height: 90vh; overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px 24px; border-bottom: 1px solid var(--border);
}
.modal-header h3 { font-size: 18px; font-weight: 600; }
.modal-body { padding: 24px; }
.modal-footer { padding: 16px 24px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; }

/* Search bar */
.search-bar {
  position: relative; margin-bottom: 20px;
}
.search-bar svg { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-muted); }
.search-bar input { padding-left: 42px; }

/* Product image */
.product-thumb {
  width: 48px; height: 48px; border-radius: 8px; object-fit: cover;
  background: var(--bg-hover); display: flex; align-items: center; justify-content: center;
  color: var(--text-muted); overflow: hidden;
}
.product-thumb img { width: 100%; height: 100%; object-fit: cover; }

/* QR Print Page */
.print-area { display: none; }
@media print {
  body * { visibility: hidden; }
  .print-area, .print-area * { visibility: visible; }
  .print-area { display: block !important; position: absolute; left: 0; top: 0; width: 100%; }
  .qr-label {
    page-break-inside: avoid; display: inline-flex; flex-direction: column;
    align-items: center; padding: 12px; border: 1px dashed #ccc; margin: 8px;
    width: calc(33.33% - 20px); text-align: center;
  }
  .qr-label img { width: 120px; height: 120px; }
  .qr-label .product-name { font-size: 11px; font-weight: bold; margin-top: 6px; color: #000; }
  .qr-label .product-price { font-size: 14px; font-weight: bold; color: #000; margin-top: 2px; }
  .qr-label .product-barcode { font-size: 9px; color: #666; font-family: monospace; }
}

/* Customer QR View */
.customer-view {
  min-height: 100vh; background: linear-gradient(180deg, #0a0e1a 0%, #1a2035 100%);
  padding: 20px; display: flex; flex-direction: column; align-items: center;
}
.customer-card {
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 20px;
  max-width: 480px; width: 100%; overflow: hidden; box-shadow: var(--shadow);
}
.customer-card-image { width: 100%; height: 280px; background: var(--bg-hover); position: relative; overflow: hidden; }
.customer-card-image img { width: 100%; height: 100%; object-fit: cover; }
.customer-card-image .no-image { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); font-size: 48px; }
.customer-card-body { padding: 28px; }
.customer-card-body h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
.customer-card-body .cat-badge { display: inline-block; margin-bottom: 16px; }
.customer-price-box {
  background: var(--accent-soft); border: 1px solid rgba(59,130,246,0.2); border-radius: 12px;
  padding: 16px 20px; margin: 16px 0; display: flex; align-items: center; justify-content: space-between;
}
.customer-price-box .current-price { font-size: 28px; font-weight: 700; color: var(--accent); font-family: 'JetBrains Mono', monospace; }
.customer-price-box .old-price { font-size: 16px; color: var(--text-muted); text-decoration: line-through; }
.customer-campaign-box {
  background: var(--success-soft); border: 1px solid rgba(16,185,129,0.2); border-radius: 12px;
  padding: 12px 16px; margin-bottom: 16px; display: flex; align-items: center; gap: 10px;
}
.customer-details { margin-top: 16px; }
.customer-detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
.customer-detail-row .label { color: var(--text-muted); }
.customer-store-info { text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border); }
.customer-store-info h3 { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
.customer-store-info p { font-size: 13px; color: var(--text-muted); }

/* Cart */
.cart-fab {
  position: fixed; bottom: 24px; right: 24px; z-index: 80;
  background: var(--accent); color: white; border: none; border-radius: 56px;
  padding: 14px 24px; font-size: 15px; font-weight: 600; font-family: inherit;
  cursor: pointer; box-shadow: 0 8px 32px rgba(59,130,246,0.4);
  display: flex; align-items: center; gap: 10px; transition: all 0.2s;
}
.cart-fab:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(59,130,246,0.5); }
.cart-fab .cart-count {
  background: white; color: var(--accent); width: 24px; height: 24px;
  border-radius: 12px; display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700;
}
.add-to-cart-btn {
  width: 100%; padding: 16px; border: none; border-radius: 12px;
  background: linear-gradient(135deg, #10b981, #059669); color: white;
  font-size: 16px; font-weight: 700; font-family: inherit; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  transition: all 0.2s; margin-top: 20px;
}
.add-to-cart-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(16,185,129,0.4); }
.add-to-cart-btn.added { background: linear-gradient(135deg, #6366f1, #8b5cf6); }
.cart-panel {
  position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column;
  background: var(--bg-primary);
}
.cart-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border); background: var(--bg-secondary);
}
.cart-header h2 { font-size: 18px; font-weight: 700; }
.cart-items { flex: 1; overflow-y: auto; padding: 16px; }
.cart-item {
  display: flex; align-items: center; gap: 14px; padding: 14px;
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
  margin-bottom: 10px;
}
.cart-item-img { width: 52px; height: 52px; border-radius: 10px; object-fit: cover; background: var(--bg-hover); display: flex; align-items: center; justify-content: center; color: var(--text-muted); overflow: hidden; flex-shrink: 0; }
.cart-item-img img { width: 100%; height: 100%; object-fit: cover; }
.cart-item-info { flex: 1; min-width: 0; }
.cart-item-name { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cart-item-price { font-family: 'JetBrains Mono', monospace; font-weight: 600; color: var(--accent); font-size: 14px; margin-top: 2px; }
.cart-item-qty { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.cart-item-qty button {
  width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--bg-hover); color: var(--text-primary); font-size: 18px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-weight: 600; transition: all 0.15s;
}
.cart-item-qty button:hover { background: var(--accent-soft); border-color: var(--accent); }
.cart-item-qty span { font-weight: 700; font-size: 16px; min-width: 20px; text-align: center; }
.cart-footer {
  padding: 20px; border-top: 1px solid var(--border); background: var(--bg-secondary);
}
.cart-total {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 14px; font-size: 18px; font-weight: 700;
}
.cart-total .total-price { font-family: 'JetBrains Mono', monospace; color: var(--accent); font-size: 24px; }
.cart-clear-btn {
  width: 100%; padding: 14px; border: 1px solid var(--danger); border-radius: 12px;
  background: var(--danger-soft); color: var(--danger); font-size: 14px;
  font-weight: 600; font-family: inherit; cursor: pointer; transition: all 0.2s;
}
.cart-clear-btn:hover { background: var(--danger); color: white; }
.cart-empty { text-align: center; padding: 60px 20px; color: var(--text-muted); }
.cart-empty p { margin-top: 12px; font-size: 15px; }
.cart-item-count { font-size: 13px; color: var(--text-muted); font-weight: 400; }

/* Bulk Price Modal */
.bulk-preview { max-height: 300px; overflow-y: auto; margin: 16px 0; }
.bulk-preview-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
.price-old { color: var(--text-muted); text-decoration: line-through; }
.price-new { color: var(--success); font-weight: 600; }

/* Mobile */
.mobile-header {
  display: none; position: fixed; top: 0; left: 0; right: 0;
  background: var(--bg-secondary); border-bottom: 1px solid var(--border);
  padding: 12px 16px; z-index: 60; align-items: center; justify-content: space-between;
}
.mobile-menu-btn { background: none; border: none; color: var(--text-primary); cursor: pointer; padding: 4px; }
.sidebar-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 45; }

@media (max-width: 768px) {
  .mobile-header { display: flex; }
  .sidebar { transform: translateX(-100%); transition: transform 0.3s; }
  .sidebar.open { transform: translateX(0); }
  .sidebar-overlay.open { display: block; }
  .main-content { margin-left: 0; padding: 80px 16px 24px; }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .page-header { flex-direction: column; align-items: flex-start; }
}

/* Image upload */
.image-upload-area {
  border: 2px dashed var(--border); border-radius: var(--radius); padding: 32px;
  text-align: center; cursor: pointer; transition: all 0.2s;
}
.image-upload-area:hover { border-color: var(--accent); background: var(--accent-soft); }
.image-upload-area.has-image { padding: 0; border-style: solid; }
.image-upload-area.has-image img { width: 100%; max-height: 200px; object-fit: cover; border-radius: var(--radius); }

/* Loading */
.loading { display: flex; align-items: center; justify-content: center; padding: 60px; }
.spinner { width: 32px; height: 32px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Tabs */
.tabs { display: flex; gap: 4px; margin-bottom: 24px; background: var(--bg-secondary); padding: 4px; border-radius: var(--radius-sm); overflow-x: auto; }
.tab-btn {
  padding: 10px 20px; border: none; background: transparent; color: var(--text-secondary);
  font-size: 14px; font-weight: 500; font-family: inherit; cursor: pointer;
  border-radius: 6px; transition: all 0.2s; white-space: nowrap;
}
.tab-btn.active { background: var(--accent); color: white; }
.tab-btn:hover:not(.active) { background: var(--bg-hover); color: var(--text-primary); }

.empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
.empty-state p { font-size: 15px; margin-top: 12px; }
`;

// ==================== MAIN APP ====================
export default function App() {
  const [auth, setAuth] = useState(null); // { idToken, refreshToken, uid, email }
  const [userRole, setUserRole] = useState(null); // { role, storeId, storeName }
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Check if this is a customer QR view
  const urlParams = new URLSearchParams(window.location.search);
  const qrProductId = urlParams.get("u");
  const qrStoreId = urlParams.get("s");

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Auto refresh token
  useEffect(() => {
    const saved = localStorage.getItem("qrmarket_auth");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        refreshToken(parsed.refreshToken).then(data => {
          const newAuth = { ...parsed, idToken: data.idToken, refreshToken: data.refreshToken };
          setAuth(newAuth);
          localStorage.setItem("qrmarket_auth", JSON.stringify(newAuth));
        }).catch(() => {
          localStorage.removeItem("qrmarket_auth");
          setLoading(false);
        });
      } catch { setLoading(false); }
    } else {
      setLoading(false);
    }
  }, []);

  // Load user role after auth
  useEffect(() => {
    if (!auth) { setLoading(false); return; }
    fsGet(`qrmarket_users/${auth.uid}`, auth.idToken).then(doc => {
      if (doc && doc.fields) {
        const data = parseDoc(doc);
        setUserRole(data);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [auth]);

  const handleLogout = () => {
    localStorage.removeItem("qrmarket_auth");
    setAuth(null);
    setUserRole(null);
  };

  // Customer QR View (no auth needed)
  if (qrProductId && qrStoreId) {
    return <>
      <style>{css}</style>
      <CustomerQRView productId={qrProductId} storeId={qrStoreId} />
    </>;
  }

  if (loading) {
    return <>
      <style>{css}</style>
      <div className="auth-page"><div className="spinner" /></div>
    </>;
  }

  if (!auth) {
    return <>
      <style>{css}</style>
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
      <LoginPage onLogin={(a) => { setAuth(a); localStorage.setItem("qrmarket_auth", JSON.stringify(a)); }} showToast={showToast} />
    </>;
  }

  if (!userRole) {
    return <>
      <style>{css}</style>
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
      <SetupPage auth={auth} onComplete={(r) => setUserRole(r)} showToast={showToast} />
    </>;
  }

  return <>
    <style>{css}</style>
    {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    {userRole.role === "superadmin" ? (
      <SuperAdminPanel auth={auth} userRole={userRole} onLogout={handleLogout} showToast={showToast} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
    ) : (
      <StorePanel auth={auth} userRole={userRole} onLogout={handleLogout} showToast={showToast} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
    )}
  </>;
}

// ==================== LOGIN PAGE ====================
function LoginPage({ onLogin, showToast }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return showToast("Email ve şifre gerekli", "error");
    setBusy(true);
    try {
      const data = await signIn(email, password);
      onLogin({ idToken: data.idToken, refreshToken: data.refreshToken, uid: data.localId, email: data.email });
      showToast("Giriş başarılı!");
    } catch (err) {
      showToast("Giriş başarısız. Email veya şifre hatalı.", "error");
    }
    setBusy(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <h1>📦 Market Fiyat</h1>
          <p>Market Ürün Bilgi Sistemi</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" placeholder="ornek@email.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Şifre</label>
            <input className="form-input" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-full" type="submit" disabled={busy}>
            {busy ? "Giriş yapılıyor..." : "Giriş Yap"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ==================== SETUP PAGE (first time) ====================
function SetupPage({ auth, onComplete, showToast }) {
  const [step, setStep] = useState("choose"); // choose, create_store, wait
  const [storeName, setStoreName] = useState("");
  const [storeCity, setStoreCity] = useState("");
  const [storePhone, setStorePhone] = useState("");
  const [busy, setBusy] = useState(false);

  const createSuperAdmin = async () => {
    setBusy(true);
    try {
      await fsCreate("qrmarket_users", { uid: auth.uid, email: auth.email, role: "superadmin", createdAt: new Date().toISOString() }, auth.idToken, auth.uid);
      onComplete({ role: "superadmin", _id: auth.uid });
      showToast("SuperAdmin hesabı oluşturuldu!");
    } catch (e) { showToast("Hata: " + e.message, "error"); }
    setBusy(false);
  };

  const createStore = async () => {
    if (!storeName) return showToast("Market adı gerekli", "error");
    setBusy(true);
    try {
      const store = await fsCreate("qrmarket_stores", {
        name: storeName, city: storeCity, phone: storePhone,
        ownerId: auth.uid, ownerEmail: auth.email,
        active: true, createdAt: new Date().toISOString(),
        baseUrl: window.location.origin + window.location.pathname
      }, auth.idToken);
      await fsCreate("qrmarket_users", {
        uid: auth.uid, email: auth.email, role: "store_admin",
        storeId: store._id, storeName: storeName,
        createdAt: new Date().toISOString()
      }, auth.idToken, auth.uid);
      onComplete({ role: "store_admin", storeId: store._id, storeName: storeName, _id: auth.uid });
      showToast("Market oluşturuldu!");
    } catch (e) { showToast("Hata: " + e.message, "error"); }
    setBusy(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <div className="auth-logo">
          <h1>📦 Market Fiyat</h1>
          <p>Hesap Kurulumu</p>
        </div>
        {step === "choose" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, textAlign: "center", marginBottom: 12 }}>
              İlk girişiniz. Rolünüzü seçin:
            </p>
            <button className="btn btn-primary btn-full" onClick={() => setStep("create_store")}>
              <Icon name="store" /> Yeni Market Oluştur
            </button>
            <button className="btn btn-secondary btn-full" onClick={createSuperAdmin} disabled={busy}>
              <Icon name="settings" /> SuperAdmin Ol
            </button>
          </div>
        )}
        {step === "create_store" && (
          <div>
            <div className="form-group">
              <label className="form-label">Market Adı *</label>
              <input className="form-input" placeholder="Örn: ABC Market" value={storeName} onChange={e => setStoreName(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Şehir</label>
              <input className="form-input" placeholder="Örn: Gaziantep" value={storeCity} onChange={e => setStoreCity(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Telefon</label>
              <input className="form-input" placeholder="0532 123 45 67" value={storePhone} onChange={e => setStorePhone(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-secondary" onClick={() => setStep("choose")}>Geri</button>
              <button className="btn btn-primary btn-full" onClick={createStore} disabled={busy}>
                {busy ? "Oluşturuluyor..." : "Market Oluştur"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== STORE PANEL ====================
function StorePanel({ auth, userRole, onLogout, showToast, sidebarOpen, setSidebarOpen }) {
  const [page, setPage] = useState("dashboard");
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [storeInfo, setStoreInfo] = useState(null);
  const [loadingData, setLoadingData] = useState(true);

  const storeId = userRole.storeId;

  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [cats, prods, store] = await Promise.all([
        fsList("qrmarket_categories", auth.idToken, [{ field: "storeId", value: storeId }]),
        fsList("qrmarket_products", auth.idToken, [{ field: "storeId", value: storeId }]),
        fsGet(`qrmarket_stores/${storeId}`, auth.idToken)
      ]);
      setCategories(cats || []);
      setProducts(prods || []);
      if (store) setStoreInfo(parseDoc(store));
    } catch (e) { showToast("Veri yükleme hatası", "error"); }
    setLoadingData(false);
  }, [auth.idToken, storeId]);

  useEffect(() => { loadData(); }, [loadData]);

  const navItems = [
    { id: "dashboard", label: "Kontrol Paneli", icon: "grid" },
    { id: "categories", label: "Kategoriler", icon: "tag" },
    { id: "products", label: "Ürünler", icon: "box" },
    { id: "bulk_price", label: "Toplu Fiyat", icon: "percent" },
    { id: "campaigns", label: "Kampanyalar", icon: "campaign" },
    { id: "qr_print", label: "QR Yazdır", icon: "printer" },
  ];

  const navigate = (p) => { setPage(p); setSidebarOpen(false); };

  const activeCampaigns = products.filter(p => p.campaignPrice && p.campaignEnd && new Date(p.campaignEnd) > new Date());

  return (
    <div className="app-layout">
      <div className="mobile-header">
        <button className="mobile-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
          <Icon name={sidebarOpen ? "x" : "grid"} size={24} />
        </button>
        <span style={{ fontWeight: 600 }}>Market Fiyat</span>
        <div style={{ width: 24 }} />
      </div>
      <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />
      <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <h2>📦 Market Fiyat</h2>
          <p>{userRole.storeName || "Market"}</p>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <div key={item.id} className={`sidebar-item ${page === item.id ? "active" : ""}`} onClick={() => navigate(item.id)}>
              <Icon name={item.icon} size={18} />
              {item.label}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>{auth.email}</div>
          <button className="btn btn-secondary btn-sm btn-full" onClick={onLogout}>
            <Icon name="logout" size={16} /> Çıkış Yap
          </button>
        </div>
      </div>

      <div className="main-content">
        {loadingData ? (
          <div className="loading"><div className="spinner" /></div>
        ) : (
          <>
            {page === "dashboard" && <DashboardPage categories={categories} products={products} activeCampaigns={activeCampaigns} />}
            {page === "categories" && <CategoriesPage auth={auth} storeId={storeId} categories={categories} onRefresh={loadData} showToast={showToast} />}
            {page === "products" && <ProductsPage auth={auth} storeId={storeId} categories={categories} products={products} storeInfo={storeInfo} onRefresh={loadData} showToast={showToast} />}
            {page === "bulk_price" && <BulkPricePage auth={auth} storeId={storeId} categories={categories} products={products} onRefresh={loadData} showToast={showToast} />}
            {page === "campaigns" && <CampaignsPage auth={auth} storeId={storeId} categories={categories} products={products} onRefresh={loadData} showToast={showToast} />}
            {page === "qr_print" && <QRPrintPage products={products} categories={categories} storeInfo={storeInfo} storeId={storeId} />}
          </>
        )}
      </div>
    </div>
  );
}

// ==================== DASHBOARD ====================
function DashboardPage({ categories, products, activeCampaigns }) {
  return (
    <div>
      <div className="page-header"><h1>Kontrol Paneli</h1></div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><Icon name="box" size={22} /></div>
          <div><div className="stat-value">{products.length}</div><div className="stat-label">Toplam Ürün</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon purple"><Icon name="tag" size={22} /></div>
          <div><div className="stat-value">{categories.length}</div><div className="stat-label">Kategori</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><Icon name="campaign" size={22} /></div>
          <div><div className="stat-value">{activeCampaigns.length}</div><div className="stat-label">Aktif Kampanya</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange"><Icon name="qr" size={22} /></div>
          <div><div className="stat-value">{products.filter(p => p.active !== false).length}</div><div className="stat-label">Aktif QR</div></div>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><span className="card-title">Son Eklenen Ürünler</span></div>
        {products.length === 0 ? (
          <div className="empty-state"><Icon name="box" size={40} /><p>Henüz ürün eklenmedi</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Ürün</th><th>Kategori</th><th>Fiyat</th><th>Durum</th></tr></thead>
              <tbody>
                {products.slice(0, 10).map(p => (
                  <tr key={p._id}>
                    <td style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div className="product-thumb">
                        {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <Icon name="image" size={20} />}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.barcode || "-"}</div>
                      </div>
                    </td>
                    <td><span className="badge badge-blue">{p.categoryName || "-"}</span></td>
                    <td style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{formatPrice(p.price)}</td>
                    <td>{p.active !== false ? <span className="badge badge-green">Aktif</span> : <span className="badge badge-red">Pasif</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== CATEGORIES ====================
function CategoriesPage({ auth, storeId, categories, onRefresh, showToast }) {
  const [modal, setModal] = useState(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [busy, setBusy] = useState(false);

  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

  const openAdd = () => { setName(""); setColor("#3b82f6"); setModal("add"); };
  const openEdit = (cat) => { setName(cat.name); setColor(cat.color || "#3b82f6"); setModal(cat); };

  const handleSave = async () => {
    if (!name.trim()) return showToast("Kategori adı gerekli", "error");
    setBusy(true);
    try {
      if (modal === "add") {
        await fsCreate("qrmarket_categories", { name: name.trim(), color, storeId, createdAt: new Date().toISOString() }, auth.idToken);
        showToast("Kategori eklendi!");
      } else {
        await fsUpdate(`qrmarket_categories/${modal._id}`, { name: name.trim(), color }, auth.idToken);
        showToast("Kategori güncellendi!");
      }
      setModal(null);
      onRefresh();
    } catch (e) { showToast("Hata: " + e.message, "error"); }
    setBusy(false);
  };

  const handleDelete = async (cat) => {
    if (!confirm(`"${cat.name}" kategorisini silmek istediğinize emin misiniz?`)) return;
    try {
      await fsDelete(`qrmarket_categories/${cat._id}`, auth.idToken);
      showToast("Kategori silindi!");
      onRefresh();
    } catch (e) { showToast("Hata: " + e.message, "error"); }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Kategoriler</h1>
        <button className="btn btn-primary" onClick={openAdd}><Icon name="plus" size={16} /> Yeni Kategori</button>
      </div>
      {categories.length === 0 ? (
        <div className="card"><div className="empty-state"><Icon name="tag" size={40} /><p>Henüz kategori eklenmedi</p></div></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
          {categories.map(cat => (
            <div key={cat._id} className="card" style={{ borderLeft: `4px solid ${cat.color || "#3b82f6"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{cat.name}</div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                    {/* count products in this category */}
                  </div>
                </div>
                <div className="table-actions">
                  <button className="btn btn-icon btn-secondary" onClick={() => openEdit(cat)}><Icon name="edit" size={16} /></button>
                  <button className="btn btn-icon btn-danger" onClick={() => handleDelete(cat)}><Icon name="trash" size={16} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === "add" ? "Yeni Kategori" : "Kategori Düzenle"}</h3>
              <button className="btn btn-icon btn-secondary" onClick={() => setModal(null)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Kategori Adı</label>
                <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Örn: Süt Ürünleri" />
              </div>
              <div className="form-group">
                <label className="form-label">Renk</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {colors.map(c => (
                    <div key={c} onClick={() => setColor(c)} style={{
                      width: 32, height: 32, borderRadius: 8, background: c, cursor: "pointer",
                      border: color === c ? "3px solid white" : "3px solid transparent",
                      transition: "all 0.15s"
                    }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>İptal</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={busy}>
                {busy ? "Kaydediliyor..." : "Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== PRODUCTS ====================
function ProductsPage({ auth, storeId, categories, products, storeInfo, onRefresh, showToast }) {
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const fileInputRef = useRef(null);

  const baseUrl = storeInfo?.baseUrl || (window.location.origin + window.location.pathname);

  const emptyForm = { name: "", barcode: "", categoryId: "", price: "", unit: "adet", brand: "", description: "", weight: "", origin: "", active: true };

  const openAdd = () => { setForm(emptyForm); setImageFile(null); setImagePreview(null); setModal("add"); };
  const openEdit = (p) => {
    setForm({ name: p.name, barcode: p.barcode || "", categoryId: p.categoryId || "", price: p.price || "", unit: p.unit || "adet", brand: p.brand || "", description: p.description || "", weight: p.weight || "", origin: p.origin || "", active: p.active !== false, _id: p._id });
    setImagePreview(p.imageUrl || null);
    setImageFile(null);
    setModal("edit");
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target.result);
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.price) return showToast("Ürün adı ve fiyat gerekli", "error");
    setBusy(true);
    try {
      let imageUrl = imagePreview;
      if (imageFile) {
        const path = `qrmarket/${storeId}/products/${Date.now()}_${imageFile.name}`;
        imageUrl = await uploadImage(imageFile, path, auth.idToken);
      }
      const catName = categories.find(c => c._id === form.categoryId)?.name || "";
      const data = {
        name: form.name, barcode: form.barcode, categoryId: form.categoryId,
        categoryName: catName, price: parseFloat(form.price) || 0,
        unit: form.unit, brand: form.brand, description: form.description,
        weight: form.weight, origin: form.origin, active: form.active,
        storeId, imageUrl: imageUrl || "",
        updatedAt: new Date().toISOString()
      };
      if (modal === "add") {
        data.createdAt = new Date().toISOString();
        await fsCreate("qrmarket_products", data, auth.idToken);
        showToast("Ürün eklendi!");
      } else {
        await fsUpdate(`qrmarket_products/${form._id}`, data, auth.idToken);
        showToast("Ürün güncellendi!");
      }
      setModal(null);
      onRefresh();
    } catch (e) { showToast("Hata: " + e.message, "error"); }
    setBusy(false);
  };

  const handleDelete = async (p) => {
    if (!confirm(`"${p.name}" ürününü silmek istediğinize emin misiniz?`)) return;
    try {
      await fsDelete(`qrmarket_products/${p._id}`, auth.idToken);
      showToast("Ürün silindi!");
      onRefresh();
    } catch (e) { showToast("Hata: " + e.message, "error"); }
  };

  const filtered = products.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode || "").includes(search);
    const matchCat = !filterCat || p.categoryId === filterCat;
    return matchSearch && matchCat;
  });

  return (
    <div>
      <div className="page-header">
        <h1>Ürünler ({filtered.length})</h1>
        <button className="btn btn-primary" onClick={openAdd}><Icon name="plus" size={16} /> Yeni Ürün</button>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
          <Icon name="search" size={16} />
          <input className="form-input" placeholder="Ürün ara (ad veya barkod)..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 42 }} />
        </div>
        <select className="form-input" value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ width: 200 }}>
          <option value="">Tüm Kategoriler</option>
          {categories.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card"><div className="empty-state"><Icon name="box" size={40} /><p>Ürün bulunamadı</p></div></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Ürün</th><th>Kategori</th><th>Fiyat</th><th>Birim</th><th>QR</th><th>İşlem</th></tr></thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p._id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div className="product-thumb">
                          {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <Icon name="image" size={18} />}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500 }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "'JetBrains Mono'" }}>{p.barcode || "-"}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className="badge badge-blue">{p.categoryName || "-"}</span></td>
                    <td>
                      <div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 600 }}>{formatPrice(p.price)}</div>
                      {p.campaignPrice && new Date(p.campaignEnd) > new Date() && (
                        <div style={{ fontSize: 12, color: "var(--success)", fontWeight: 600 }}>Kampanya: {formatPrice(p.campaignPrice)}</div>
                      )}
                    </td>
                    <td>{p.unit || "adet"}</td>
                    <td>
                      <img src={generateQR(`${baseUrl}?s=${storeId}&u=${p._id}`, 40)} alt="QR" style={{ width: 36, height: 36 }} />
                    </td>
                    <td>
                      <div className="table-actions">
                        <button className="btn btn-icon btn-secondary" onClick={() => openEdit(p)} title="Düzenle"><Icon name="edit" size={15} /></button>
                        <button className="btn btn-icon btn-danger" onClick={() => handleDelete(p)} title="Sil"><Icon name="trash" size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Product Modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === "add" ? "Yeni Ürün" : "Ürün Düzenle"}</h3>
              <button className="btn btn-icon btn-secondary" onClick={() => setModal(null)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              {/* Image upload */}
              <div className="form-group">
                <label className="form-label">Ürün Görseli</label>
                <input type="file" accept="image/*" ref={fileInputRef} style={{ display: "none" }} onChange={handleImageChange} />
                <div className={`image-upload-area ${imagePreview ? "has-image" : ""}`} onClick={() => fileInputRef.current?.click()}>
                  {imagePreview ? (
                    <img src={imagePreview} alt="preview" />
                  ) : (
                    <div>
                      <Icon name="upload" size={32} />
                      <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 8 }}>Tıklayarak görsel yükleyin</p>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">Ürün Adı *</label>
                  <input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ürün adı" />
                </div>
                <div className="form-group">
                  <label className="form-label">Barkod No</label>
                  <input className="form-input" value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} placeholder="8690000000000" />
                </div>
                <div className="form-group">
                  <label className="form-label">Kategori</label>
                  <select className="form-input" value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })}>
                    <option value="">Kategori seçin</option>
                    {categories.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Fiyat (₺) *</label>
                  <input className="form-input" type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="0.00" />
                </div>
                <div className="form-group">
                  <label className="form-label">Birim</label>
                  <select className="form-input" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                    <option value="adet">Adet</option>
                    <option value="kg">Kilogram</option>
                    <option value="lt">Litre</option>
                    <option value="paket">Paket</option>
                    <option value="kutu">Kutu</option>
                    <option value="metre">Metre</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Marka</label>
                  <input className="form-input" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} placeholder="Marka adı" />
                </div>
                <div className="form-group">
                  <label className="form-label">Ağırlık/Hacim</label>
                  <input className="form-input" value={form.weight} onChange={e => setForm({ ...form, weight: e.target.value })} placeholder="500ml, 1kg vb." />
                </div>
                <div className="form-group">
                  <label className="form-label">Menşei</label>
                  <input className="form-input" value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })} placeholder="Türkiye" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Açıklama</label>
                <textarea className="form-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Ürün açıklaması..." />
              </div>
              <div className="form-group">
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
                  <span className="form-label" style={{ margin: 0 }}>Aktif (QR tarandığında görünsün)</span>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>İptal</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={busy}>
                {busy ? "Kaydediliyor..." : "Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== BULK PRICE ====================
function BulkPricePage({ auth, storeId, categories, products, onRefresh, showToast }) {
  const [mode, setMode] = useState("percent"); // percent, fixed
  const [target, setTarget] = useState("all"); // all, category, brand
  const [targetValue, setTargetValue] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState("increase"); // increase, decrease
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const brands = [...new Set(products.map(p => p.brand).filter(Boolean))];

  const generatePreview = () => {
    if (!amount || parseFloat(amount) <= 0) return showToast("Geçerli bir tutar girin", "error");

    let filtered = [...products];
    if (target === "category" && targetValue) {
      filtered = filtered.filter(p => p.categoryId === targetValue);
    } else if (target === "brand" && targetValue) {
      filtered = filtered.filter(p => p.brand === targetValue);
    }

    const result = filtered.map(p => {
      const oldPrice = p.price || 0;
      let newPrice;
      if (mode === "percent") {
        const change = oldPrice * (parseFloat(amount) / 100);
        newPrice = direction === "increase" ? oldPrice + change : oldPrice - change;
      } else {
        newPrice = direction === "increase" ? oldPrice + parseFloat(amount) : oldPrice - parseFloat(amount);
      }
      newPrice = Math.max(0, Math.round(newPrice * 100) / 100);
      return { ...p, newPrice };
    });

    setPreview(result);
  };

  const applyChanges = async () => {
    if (!preview || preview.length === 0) return;
    if (!confirm(`${preview.length} ürünün fiyatı güncellenecek. Onaylıyor musunuz?`)) return;
    setBusy(true);
    try {
      for (const p of preview) {
        await fsUpdate(`qrmarket_products/${p._id}`, { price: p.newPrice, updatedAt: new Date().toISOString() }, auth.idToken);
      }
      showToast(`${preview.length} ürün fiyatı güncellendi!`);
      setPreview(null);
      setAmount("");
      onRefresh();
    } catch (e) { showToast("Hata: " + e.message, "error"); }
    setBusy(false);
  };

  return (
    <div>
      <div className="page-header"><h1>Toplu Fiyat Güncelleme</h1></div>
      <div className="card">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="form-group">
            <label className="form-label">Uygulama Hedefi</label>
            <select className="form-input" value={target} onChange={e => { setTarget(e.target.value); setTargetValue(""); setPreview(null); }}>
              <option value="all">Tüm Ürünler</option>
              <option value="category">Kategoriye Göre</option>
              <option value="brand">Markaya Göre</option>
            </select>
          </div>
          {target === "category" && (
            <div className="form-group">
              <label className="form-label">Kategori Seçin</label>
              <select className="form-input" value={targetValue} onChange={e => { setTargetValue(e.target.value); setPreview(null); }}>
                <option value="">Seçin...</option>
                {categories.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {target === "brand" && (
            <div className="form-group">
              <label className="form-label">Marka Seçin</label>
              <select className="form-input" value={targetValue} onChange={e => { setTargetValue(e.target.value); setPreview(null); }}>
                <option value="">Seçin...</option>
                {brands.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">İşlem Türü</label>
            <select className="form-input" value={mode} onChange={e => { setMode(e.target.value); setPreview(null); }}>
              <option value="percent">Yüzde (%)</option>
              <option value="fixed">Sabit Tutar (₺)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Yön</label>
            <select className="form-input" value={direction} onChange={e => { setDirection(e.target.value); setPreview(null); }}>
              <option value="increase">Zam (Artır)</option>
              <option value="decrease">İndirim (Azalt)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{mode === "percent" ? "Oran (%)" : "Tutar (₺)"}</label>
            <input className="form-input" type="number" step="0.01" value={amount} onChange={e => { setAmount(e.target.value); setPreview(null); }} placeholder={mode === "percent" ? "10" : "5.00"} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn btn-warning" onClick={generatePreview}>
            <Icon name="search" size={16} /> Önizle ({target === "all" ? products.length : target === "category" ? products.filter(p => p.categoryId === targetValue).length : products.filter(p => p.brand === targetValue).length} ürün)
          </button>
        </div>
      </div>

      {preview && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Önizleme ({preview.length} ürün)</span>
            <button className="btn btn-success" onClick={applyChanges} disabled={busy}>
              <Icon name="check" size={16} /> {busy ? "Uygulanıyor..." : "Onayla ve Uygula"}
            </button>
          </div>
          <div className="bulk-preview">
            {preview.map(p => (
              <div key={p._id} className="bulk-preview-item">
                <span>{p.name}</span>
                <div style={{ display: "flex", gap: 16 }}>
                  <span className="price-old">{formatPrice(p.price)}</span>
                  <span>→</span>
                  <span className="price-new">{formatPrice(p.newPrice)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== CAMPAIGNS ====================
function CampaignsPage({ auth, storeId, categories, products, onRefresh, showToast }) {
  const [modal, setModal] = useState(null);
  const [target, setTarget] = useState("product"); // product, category
  const [targetId, setTargetId] = useState("");
  const [discountType, setDiscountType] = useState("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);

  const activeCampaigns = products.filter(p => p.campaignPrice && p.campaignEnd && new Date(p.campaignEnd) > new Date());

  const applyCampaign = async () => {
    if (!discountValue || !endDate) return showToast("İndirim ve bitiş tarihi gerekli", "error");
    setBusy(true);
    try {
      let targets = [];
      if (target === "product" && targetId) {
        targets = products.filter(p => p._id === targetId);
      } else if (target === "category" && targetId) {
        targets = products.filter(p => p.categoryId === targetId);
      }

      for (const p of targets) {
        const discount = discountType === "percent"
          ? p.price * (parseFloat(discountValue) / 100)
          : parseFloat(discountValue);
        const campaignPrice = Math.max(0, Math.round((p.price - discount) * 100) / 100);
        await fsUpdate(`qrmarket_products/${p._id}`, {
          campaignPrice, campaignStart: startDate, campaignEnd: endDate,
          campaignDiscount: `${discountValue}${discountType === "percent" ? "%" : "₺"}`,
          updatedAt: new Date().toISOString()
        }, auth.idToken);
      }
      showToast(`${targets.length} ürüne kampanya uygulandı!`);
      setModal(null);
      onRefresh();
    } catch (e) { showToast("Hata: " + e.message, "error"); }
    setBusy(false);
  };

  const removeCampaign = async (p) => {
    try {
      await fsUpdate(`qrmarket_products/${p._id}`, {
        campaignPrice: 0, campaignStart: "", campaignEnd: "", campaignDiscount: "",
        updatedAt: new Date().toISOString()
      }, auth.idToken);
      showToast("Kampanya kaldırıldı!");
      onRefresh();
    } catch (e) { showToast("Hata: " + e.message, "error"); }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Kampanyalar</h1>
        <button className="btn btn-primary" onClick={() => setModal("add")}><Icon name="plus" size={16} /> Yeni Kampanya</button>
      </div>

      {activeCampaigns.length === 0 ? (
        <div className="card"><div className="empty-state"><Icon name="campaign" size={40} /><p>Aktif kampanya yok</p></div></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Ürün</th><th>Normal Fiyat</th><th>Kampanya Fiyat</th><th>İndirim</th><th>Bitiş</th><th>İşlem</th></tr></thead>
              <tbody>
                {activeCampaigns.map(p => (
                  <tr key={p._id}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td style={{ textDecoration: "line-through", color: "var(--text-muted)", fontFamily: "'JetBrains Mono'" }}>{formatPrice(p.price)}</td>
                    <td style={{ fontWeight: 700, color: "var(--success)", fontFamily: "'JetBrains Mono'" }}>{formatPrice(p.campaignPrice)}</td>
                    <td><span className="badge badge-orange">{p.campaignDiscount}</span></td>
                    <td>{formatDate(p.campaignEnd)}</td>
                    <td>
                      <button className="btn btn-sm btn-danger" onClick={() => removeCampaign(p)}>
                        <Icon name="x" size={14} /> Kaldır
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Yeni Kampanya</h3>
              <button className="btn btn-icon btn-secondary" onClick={() => setModal(null)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Hedef</label>
                <select className="form-input" value={target} onChange={e => { setTarget(e.target.value); setTargetId(""); }}>
                  <option value="product">Tek Ürün</option>
                  <option value="category">Kategori (Tüm Ürünler)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">{target === "product" ? "Ürün Seçin" : "Kategori Seçin"}</label>
                <select className="form-input" value={targetId} onChange={e => setTargetId(e.target.value)}>
                  <option value="">Seçin...</option>
                  {target === "product"
                    ? products.map(p => <option key={p._id} value={p._id}>{p.name} - {formatPrice(p.price)}</option>)
                    : categories.map(c => <option key={c._id} value={c._id}>{c.name}</option>)
                  }
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">İndirim Türü</label>
                  <select className="form-input" value={discountType} onChange={e => setDiscountType(e.target.value)}>
                    <option value="percent">Yüzde (%)</option>
                    <option value="fixed">Sabit Tutar (₺)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">{discountType === "percent" ? "Oran (%)" : "Tutar (₺)"}</label>
                  <input className="form-input" type="number" step="0.01" value={discountValue} onChange={e => setDiscountValue(e.target.value)} placeholder={discountType === "percent" ? "20" : "10.00"} />
                </div>
                <div className="form-group">
                  <label className="form-label">Başlangıç</label>
                  <input className="form-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Bitiş *</label>
                  <input className="form-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>İptal</button>
              <button className="btn btn-primary" onClick={applyCampaign} disabled={busy}>
                {busy ? "Uygulanıyor..." : "Kampanyayı Başlat"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== QR PRINT ====================
function QRPrintPage({ products, categories, storeInfo, storeId }) {
  const [filterCat, setFilterCat] = useState("");
  const [labelSize, setLabelSize] = useState("medium"); // small, medium, large
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [selectAll, setSelectAll] = useState(false);

  const baseUrl = storeInfo?.baseUrl || (window.location.origin + window.location.pathname);

  const filtered = filterCat ? products.filter(p => p.categoryId === filterCat) : products;

  const toggleAll = () => {
    if (selectAll) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(filtered.map(p => p._id));
    }
    setSelectAll(!selectAll);
  };

  const toggleProduct = (id) => {
    setSelectedProducts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const printLabels = () => {
    const selected = products.filter(p => selectedProducts.includes(p._id));
    if (selected.length === 0) return alert("Yazdırılacak ürün seçin!");

    const sizes = { small: { qr: 80, font: 9, pFont: 11 }, medium: { qr: 120, font: 11, pFont: 14 }, large: { qr: 160, font: 14, pFont: 18 } };
    const s = sizes[labelSize];

    const html = `<!DOCTYPE html><html><head><style>
      body { font-family: Arial, sans-serif; }
      .labels { display: flex; flex-wrap: wrap; }
      .label { display: inline-flex; flex-direction: column; align-items: center; padding: 10px; border: 1px dashed #ccc; margin: 6px; text-align: center; page-break-inside: avoid; }
      .label img { width: ${s.qr}px; height: ${s.qr}px; }
      .pname { font-size: ${s.font}px; font-weight: bold; margin-top: 6px; max-width: ${s.qr + 40}px; overflow: hidden; text-overflow: ellipsis; }
      .pprice { font-size: ${s.pFont}px; font-weight: bold; margin-top: 3px; }
      .pbarcode { font-size: 8px; color: #666; font-family: monospace; margin-top: 2px; }
    </style></head><body><div class="labels">
      ${selected.map(p => {
        const url = `${baseUrl}?s=${storeId}&u=${p._id}`;
        const displayPrice = (p.campaignPrice && p.campaignEnd && new Date(p.campaignEnd) > new Date()) ? p.campaignPrice : p.price;
        return `<div class="label">
          <img src="${generateQR(url, s.qr * 2)}" />
          <div class="pname">${p.name}</div>
          <div class="pprice">${formatPrice(displayPrice)}</div>
          ${p.barcode ? `<div class="pbarcode">${p.barcode}</div>` : ""}
        </div>`;
      }).join("")}
    </div><script>window.print();</script></body></html>`;

    const win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
  };

  return (
    <div>
      <div className="page-header">
        <h1>QR Etiket Yazdırma</h1>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={printLabels}>
            <Icon name="printer" size={16} /> Seçilenleri Yazdır ({selectedProducts.length})
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <select className="form-input" value={filterCat} onChange={e => { setFilterCat(e.target.value); setSelectedProducts([]); setSelectAll(false); }} style={{ width: 200 }}>
            <option value="">Tüm Kategoriler</option>
            {categories.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
          <select className="form-input" value={labelSize} onChange={e => setLabelSize(e.target.value)} style={{ width: 160 }}>
            <option value="small">Küçük Etiket</option>
            <option value="medium">Orta Etiket</option>
            <option value="large">Büyük Etiket</option>
          </select>
          <button className="btn btn-secondary btn-sm" onClick={toggleAll}>
            {selectAll ? "Hiçbirini Seçme" : "Tümünü Seç"}
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card"><div className="empty-state"><p>Ürün bulunamadı</p></div></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {filtered.map(p => {
            const selected = selectedProducts.includes(p._id);
            const url = `${baseUrl}?s=${storeId}&u=${p._id}`;
            return (
              <div key={p._id} className="card" onClick={() => toggleProduct(p._id)} style={{
                cursor: "pointer", padding: 16, textAlign: "center",
                borderColor: selected ? "var(--accent)" : "var(--border)",
                background: selected ? "var(--accent-soft)" : "var(--bg-card)"
              }}>
                <img src={generateQR(url, 120)} alt="QR" style={{ width: 100, height: 100 }} />
                <div style={{ fontWeight: 600, fontSize: 13, marginTop: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                <div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 15, marginTop: 4, color: "var(--accent)" }}>{formatPrice(p.price)}</div>
                {p.barcode && <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono'" }}>{p.barcode}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ==================== SUPER ADMIN PANEL ====================
function SuperAdminPanel({ auth, userRole, onLogout, showToast, sidebarOpen, setSidebarOpen }) {
  const [page, setPage] = useState("stores");
  const [stores, setStores] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, u] = await Promise.all([
        fsList("qrmarket_stores", auth.idToken),
        fsList("qrmarket_users", auth.idToken)
      ]);
      setStores(s || []);
      setUsers(u || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [auth.idToken]);

  useEffect(() => { loadData(); }, [loadData]);

  const navItems = [
    { id: "stores", label: "Marketler", icon: "store" },
    { id: "users", label: "Kullanıcılar", icon: "users" },
  ];

  const navigate = (p) => { setPage(p); setSidebarOpen(false); };

  const createUser = async (email, password, storeId, storeName) => {
    try {
      const data = await signUp(email, password);
      await fsCreate("qrmarket_users", {
        uid: data.localId, email, role: "store_admin", storeId, storeName,
        createdAt: new Date().toISOString()
      }, auth.idToken, data.localId);
      showToast("Kullanıcı oluşturuldu!");
      loadData();
    } catch (e) { showToast("Hata: " + e.message, "error"); }
  };

  return (
    <div className="app-layout">
      <div className="mobile-header">
        <button className="mobile-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
          <Icon name={sidebarOpen ? "x" : "grid"} size={24} />
        </button>
        <span style={{ fontWeight: 600 }}>Market Fiyat - Admin</span>
        <div style={{ width: 24 }} />
      </div>
      <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />
      <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <h2>📦 Market Fiyat</h2>
          <p>SuperAdmin</p>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <div key={item.id} className={`sidebar-item ${page === item.id ? "active" : ""}`} onClick={() => navigate(item.id)}>
              <Icon name={item.icon} size={18} />
              {item.label}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>{auth.email}</div>
          <button className="btn btn-secondary btn-sm btn-full" onClick={onLogout}>
            <Icon name="logout" size={16} /> Çıkış Yap
          </button>
        </div>
      </div>

      <div className="main-content">
        {loading ? (
          <div className="loading"><div className="spinner" /></div>
        ) : (
          <>
            {page === "stores" && (
              <div>
                <div className="page-header"><h1>Kayıtlı Marketler ({stores.length})</h1></div>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-icon blue"><Icon name="store" size={22} /></div>
                    <div><div className="stat-value">{stores.length}</div><div className="stat-label">Toplam Market</div></div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon green"><Icon name="users" size={22} /></div>
                    <div><div className="stat-value">{users.length}</div><div className="stat-label">Toplam Kullanıcı</div></div>
                  </div>
                </div>
                {stores.length === 0 ? (
                  <div className="card"><div className="empty-state"><Icon name="store" size={40} /><p>Henüz market yok</p></div></div>
                ) : (
                  <div className="card" style={{ padding: 0 }}>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Market</th><th>Şehir</th><th>Sahip</th><th>Durum</th><th>Kayıt</th></tr></thead>
                        <tbody>
                          {stores.map(s => (
                            <tr key={s._id}>
                              <td style={{ fontWeight: 600 }}>{s.name}</td>
                              <td>{s.city || "-"}</td>
                              <td style={{ fontSize: 13 }}>{s.ownerEmail}</td>
                              <td>{s.active !== false ? <span className="badge badge-green">Aktif</span> : <span className="badge badge-red">Pasif</span>}</td>
                              <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{formatDate(s.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
            {page === "users" && (
              <div>
                <div className="page-header"><h1>Kullanıcılar ({users.length})</h1></div>
                <div className="card" style={{ padding: 0 }}>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Email</th><th>Rol</th><th>Market</th><th>Kayıt</th></tr></thead>
                      <tbody>
                        {users.map(u => (
                          <tr key={u._id}>
                            <td>{u.email}</td>
                            <td><span className={`badge ${u.role === "superadmin" ? "badge-purple" : "badge-blue"}`}>{u.role}</span></td>
                            <td>{u.storeName || "-"}</td>
                            <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{formatDate(u.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ==================== CUSTOMER QR VIEW ====================
// Cart helper — uses window.sessionStorage scoped by storeId
const CART_KEY = (sid) => `mf_cart_${sid}`;
const getCart = (sid) => { try { return JSON.parse(sessionStorage.getItem(CART_KEY(sid)) || "[]"); } catch { return []; } };
const saveCart = (sid, items) => { sessionStorage.setItem(CART_KEY(sid), JSON.stringify(items)); };

function CustomerQRView({ productId, storeId }) {
  const [product, setProduct] = useState(null);
  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cartItems, setCartItems] = useState(() => getCart(storeId));
  const [showCart, setShowCart] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [showWeightInput, setShowWeightInput] = useState(false);
  const [weightValue, setWeightValue] = useState("");

  useEffect(() => { saveCart(storeId, cartItems); }, [cartItems, storeId]);

  useEffect(() => {
    const loadProduct = async () => {
      try {
        const pRes = await fetch(`${FB_BASE}/qrmarket_products/${productId}`);
        if (!pRes.ok) throw new Error("Ürün bulunamadı");
        const pData = parseDoc(await pRes.json());
        setProduct(pData);

        const sRes = await fetch(`${FB_BASE}/qrmarket_stores/${storeId}`);
        if (sRes.ok) setStore(parseDoc(await sRes.json()));
      } catch (e) {
        setError("Ürün bulunamadı veya QR kod geçersiz.");
      }
      setLoading(false);
    };
    loadProduct();
  }, [productId, storeId]);

  const isWeighed = product && (product.unit === "kg" || product.unit === "lt");

  const handleAddClick = () => {
    if (isWeighed) {
      setShowWeightInput(true);
      setWeightValue("");
    } else {
      addToCart(1);
    }
  };

  const addWeighed = () => {
    const w = parseFloat(weightValue);
    if (!w || w <= 0) return;
    addToCart(w);
    setShowWeightInput(false);
    setWeightValue("");
  };

  const addToCart = (qty) => {
    const hasCampaign = product.campaignPrice && product.campaignEnd && new Date(product.campaignEnd) > new Date();
    const displayPrice = hasCampaign ? product.campaignPrice : product.price;
    
    setCartItems(prev => {
      if (isWeighed) {
        // Tartılı ürünler her seferinde ayrı satır (farklı gramajlar olabilir)
        const uid = product._id + "_" + Date.now();
        return [...prev, {
          id: uid, productId: product._id, name: product.name, price: displayPrice,
          imageUrl: product.imageUrl || "", unit: product.unit || "kg", qty,
          isWeighed: true
        }];
      }
      const existing = prev.find(i => i.id === product._id);
      if (existing) {
        return prev.map(i => i.id === product._id ? { ...i, qty: i.qty + qty, price: displayPrice } : i);
      }
      return [...prev, {
        id: product._id, name: product.name, price: displayPrice,
        imageUrl: product.imageUrl || "", unit: product.unit || "adet", qty
      }];
    });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1500);
  };

  const updateQty = (id, delta) => {
    setCartItems(prev => {
      const updated = prev.map(i => i.id === id ? { ...i, qty: i.qty + delta } : i).filter(i => i.qty > 0);
      return updated;
    });
  };

  const clearCart = () => { setCartItems([]); setShowCart(false); };

  const cartTotal = cartItems.reduce((sum, i) => sum + (i.price * i.qty), 0);
  const cartCount = cartItems.length;

  if (loading) return <div className="customer-view"><div className="spinner" /></div>;
  if (error) return (
    <div className="customer-view">
      <div className="customer-card" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
        <h2 style={{ marginBottom: 8 }}>Ürün Bulunamadı</h2>
        <p style={{ color: "var(--text-muted)" }}>{error}</p>
      </div>
    </div>
  );

  const hasCampaign = product.campaignPrice && product.campaignEnd && new Date(product.campaignEnd) > new Date();
  const displayPrice = hasCampaign ? product.campaignPrice : product.price;
  const inCart = cartItems.find(i => i.id === product._id);

  // Cart Panel (full screen overlay)
  if (showCart) {
    return (
      <div className="cart-panel">
        <div className="cart-header">
          <button className="btn btn-icon btn-secondary" onClick={() => setShowCart(false)}><Icon name="back" size={20} /></button>
          <h2>🛒 Sepetim</h2>
          <span className="cart-item-count">{cartCount} ürün</span>
        </div>
        <div className="cart-items">
          {cartItems.length === 0 ? (
            <div className="cart-empty">
              <Icon name="cart" size={48} />
              <p>Sepetiniz boş</p>
              <p style={{ fontSize: 13 }}>QR kod okutarak ürün ekleyin</p>
            </div>
          ) : (
            cartItems.map(item => (
              <div key={item.id} className="cart-item">
                <div className="cart-item-img">
                  {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <Icon name="box" size={22} />}
                </div>
                <div className="cart-item-info">
                  <div className="cart-item-name">{item.name}</div>
                  {item.isWeighed ? (
                    <>
                      <div className="cart-item-price">{formatPrice(item.price)} / {item.unit}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                        {item.qty} {item.unit} × {formatPrice(item.price)} = <span style={{ color: "var(--success)", fontWeight: 600 }}>{formatPrice(item.price * item.qty)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="cart-item-price">{formatPrice(item.price)} / {item.unit}</div>
                  )}
                </div>
                {item.isWeighed ? (
                  <button className="btn btn-icon btn-danger" onClick={() => setCartItems(prev => prev.filter(i => i.id !== item.id))} style={{ flexShrink: 0 }}>
                    <Icon name="trash" size={16} />
                  </button>
                ) : (
                  <div className="cart-item-qty">
                    <button onClick={() => updateQty(item.id, -1)}>−</button>
                    <span>{item.qty}</span>
                    <button onClick={() => updateQty(item.id, 1)}>+</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        {cartItems.length > 0 && (
          <div className="cart-footer">
            <div className="cart-total">
              <span>Toplam</span>
              <span className="total-price">{formatPrice(cartTotal)}</span>
            </div>
            <button className="cart-clear-btn" onClick={clearCart}>
              <Icon name="trash" size={16} /> Sepeti Temizle
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="customer-view">
      <div className="customer-card">
        <div className="customer-card-image">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} />
          ) : (
            <div className="no-image"><Icon name="box" size={48} /></div>
          )}
        </div>
        <div className="customer-card-body">
          <h1>{product.name}</h1>
          {product.categoryName && <span className="badge badge-blue cat-badge">{product.categoryName}</span>}

          {hasCampaign && (
            <div className="customer-campaign-box">
              <Icon name="campaign" size={18} />
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--success)" }}>
                Kampanya! {product.campaignDiscount} İndirim
              </span>
            </div>
          )}

          <div className="customer-price-box">
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Fiyat</div>
              <div className="current-price">{formatPrice(displayPrice)}</div>
            </div>
            {hasCampaign && <div className="old-price">{formatPrice(product.price)}</div>}
          </div>

          {/* ADD TO CART */}
          {showWeightInput ? (
            <div style={{ marginTop: 20, background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20 }}>⚖️</span> Tartı Miktarını Girin
              </div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
                Tartı etiketindeki {product.unit === "kg" ? "kilogram" : "litre"} miktarını yazın
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  className="form-input"
                  type="number" step="0.001" min="0.001"
                  placeholder={product.unit === "kg" ? "Örn: 0.750" : "Örn: 1.5"}
                  value={weightValue}
                  onChange={e => setWeightValue(e.target.value)}
                  autoFocus
                  style={{ flex: 1, fontSize: 18, fontFamily: "'JetBrains Mono'", textAlign: "center", fontWeight: 700 }}
                />
                <span style={{ display: "flex", alignItems: "center", fontWeight: 700, fontSize: 16, color: "var(--text-secondary)" }}>{product.unit}</span>
              </div>
              {weightValue && parseFloat(weightValue) > 0 && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--accent-soft)", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{weightValue} {product.unit} × {formatPrice(displayPrice)}</span>
                  <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700, color: "var(--accent)", fontSize: 16 }}>{formatPrice(parseFloat(weightValue) * displayPrice)}</span>
                </div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <button className="btn btn-secondary" onClick={() => setShowWeightInput(false)} style={{ flex: 1 }}>İptal</button>
                <button className="add-to-cart-btn" onClick={addWeighed} style={{ flex: 2, margin: 0 }} disabled={!weightValue || parseFloat(weightValue) <= 0}>
                  <Icon name="cart" size={18} /> Sepete Ekle
                </button>
              </div>
            </div>
          ) : (
            <button className={`add-to-cart-btn ${justAdded ? "added" : ""}`} onClick={handleAddClick}>
              <Icon name="cart" size={20} />
              {justAdded ? "✓ Sepete Eklendi!" : isWeighed ? `⚖️ Tartı ile Sepete Ekle (${product.unit}/fiyat)` : inCart ? `Sepete Ekle (${inCart.qty} adet sepette)` : "Sepete Ekle"}
            </button>
          )}

          {product.description && <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, margin: "16px 0" }}>{product.description}</p>}

          <div className="customer-details">
            {product.brand && <div className="customer-detail-row"><span className="label">Marka</span><span>{product.brand}</span></div>}
            {product.weight && <div className="customer-detail-row"><span className="label">Ağırlık/Hacim</span><span>{product.weight}</span></div>}
            {product.unit && <div className="customer-detail-row"><span className="label">Birim</span><span>{product.unit}</span></div>}
            {product.origin && <div className="customer-detail-row"><span className="label">Menşei</span><span>{product.origin}</span></div>}
            {product.barcode && <div className="customer-detail-row"><span className="label">Barkod</span><span style={{ fontFamily: "'JetBrains Mono'", fontSize: 13 }}>{product.barcode}</span></div>}
          </div>

          {store && (
            <div className="customer-store-info">
              <h3>{store.name}</h3>
              {store.city && <p>{store.city}</p>}
              {store.phone && <p>{store.phone}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Floating Cart Button */}
      {cartCount > 0 && (
        <button className="cart-fab" onClick={() => setShowCart(true)}>
          <Icon name="cart" size={20} />
          Sepetim ({formatPrice(cartTotal)})
          <span className="cart-count">{cartCount}</span>
        </button>
      )}

      <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 16, marginBottom: cartCount > 0 ? 80 : 0 }}>Market Fiyat ile güçlendirilmiştir</p>
    </div>
  );
}
