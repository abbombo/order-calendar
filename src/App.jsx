import React, { useState, useEffect, useRef, Component } from 'react';
import { flushSync } from 'react-dom';

class ColumnMapperErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="font-semibold text-red-700 mb-2">Column Mapper Error</h3>
            <pre className="text-xs text-red-600 bg-red-50 p-3 rounded overflow-auto max-h-40">{this.state.error.message}</pre>
            <button onClick={this.props.onCancel} className="mt-4 px-4 py-2 bg-gray-200 rounded-lg text-sm">Close</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import { Upload, Calendar, TrendingDown, TrendingUp, ChevronLeft, ChevronRight, Filter, X, Download, LogIn, UserPlus, LogOut, User, RefreshCw, Sparkles, Tag, Repeat, XCircle, Edit, AlertTriangle, Folder, Trash2, Info, Columns, Check, CreditCard, ShoppingBag } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import ColumnMapper from './ColumnMapper';
import { parseBankCSV, BANK_FORMATS } from './bankFormats';
import { exportToImage } from './utils/exportUtils';

// Remove active-filter selections whose values are no longer present in the
// available options. Used when a file is deselected in the sidebar so its
// dependent filter values disappear instead of silently emptying the view.
// 'direction' (income/expense) is not a file-derived option, so it is kept.
const pruneActiveFilters = (active, options) => {
  const pruned = {};
  Object.keys(active || {}).forEach((key) => {
    if (key === 'direction') { if (active[key]?.length) pruned[key] = active[key]; return; }
    const opts = options[key];
    if (!opts) return; // whole option group gone
    const kept = (active[key] || []).filter((v) => opts.includes(String(v)));
    if (kept.length) pruned[key] = kept;
  });
  return pruned;
};

// ── Supabase client (null-safe: gracefully skips if env vars are absent) ──────
const _sbUrl = import.meta.env.VITE_SUPABASE_URL;
const _sbKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = _sbUrl && _sbKey ? createClient(_sbUrl, _sbKey) : null;

// ── Cloudflare Turnstile ──────────────────────────────────────────────────────
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
const TURNSTILE_ENABLED  = !!TURNSTILE_SITE_KEY;

function App() {
  // ── Authentication state ────────────────────────────────────────────────────
  const [isLoggedIn, setIsLoggedIn]   = useState(false);
  const [userId, setUserId]           = useState(null); // Supabase auth UUID
  const [storageLoading, setStorageLoading] = useState(false);
  const [showAuth, setShowAuth]       = useState(true);
  const [authMode, setAuthMode]       = useState('login');
  const [username, setUsername]       = useState(''); // display name (set to email on login)
  const [email, setEmail]             = useState(''); // form input
  const [password, setPassword]       = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError]     = useState('');
  const [authSuccess, setAuthSuccess] = useState('');
  // Anti-bot: honeypot (bots fill it, real users never see it)
  const [honeypot, setHoneypot]       = useState('');
  // Rate limiting
  const [loginLockedUntil, setLoginLockedUntil] = useState(() => {
    const stored = localStorage.getItem('tc_login_lock');
    return stored ? parseInt(stored, 10) : 0;
  });
  const [loginAttemptMsg, setLoginAttemptMsg] = useState('');
  // Cloudflare Turnstile
  const [turnstileToken, setTurnstileToken]   = useState('');
  const turnstileContainerRef = useRef(null);
  const turnstileWidgetIdRef  = useRef(null);
  const pendingModeRef = useRef(null); // mode chosen on mode-selector screen, committed on mapper complete
  const modeSelectorInputRef = useRef(null); // hidden file input for the mode selector screen
  
  // Transaction state
  const [transactions, setTransactions] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar', 'heatmap', or 'year'
  const [error, setError] = useState('');
  const [selectedDate, setSelectedDate] = useState(null);
  const [uploadedFileName, setUploadedFileName] = useState([]);

  // Ecommerce order state
  const [orders, setOrders] = useState([]);          // ecommerce orders
  const [ecomFilterCols, setEcomFilterCols] = useState([]); // custom column labels marked as_filter
  const [dataMode, setDataMode] = useState(() => {
    // Load from localStorage on init
    const stored = localStorage.getItem('data_mode');
    return stored === 'ecommerce' ? 'ecommerce' : null;
  });   // 'bank' | 'ecommerce' | null
  const [orderDateField, setOrderDateField] = useState('order'); // 'order' | 'fulfil'
  const [activePlatforms, setActivePlatforms] = useState(new Set()); // empty = show all
  const [activeStatus, setActiveStatus] = useState('all'); // 'all' | 'paid' | 'pending' | 'refunded' | 'cancelled'
  const [customFilters, setCustomFilters] = useState({}); // { columnLabel: Set(values) }
  
  // Filter state
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [activeFilters, setActiveFilters] = useState({});
  const [availableFilterOptions, setAvailableFilterOptions] = useState({});
  const [filterLogic, setFilterLogic] = useState('OR');
  const [amountFilter, setAmountFilter] = useState({ type: 'all', value: '' });
  const [filterSearchQuery, setFilterSearchQuery] = useState(''); // Search within filters
  
  // Recurring & Predictions
  const [recurringTransactions, setRecurringTransactions] = useState([]);
  const [predictedTransactions, setPredictedTransactions] = useState([]);
  const [manualRecurring, setManualRecurring] = useState([]); // User-defined recurring
  const [showPredictions, setShowPredictions] = useState(false);
  const [showRecurring, setShowRecurring] = useState(false);
  
  // Manual Recurring Modal
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [recurringConfig, setRecurringConfig] = useState({
    frequency: 'monthly', // 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom'
    customDays: 30,
    dayOfWeek: 1, // For weekly (0=Sunday, 6=Saturday)
    dayOfMonth: 1, // For monthly (1-31)
    endType: 'never', // 'never', 'date', 'count'
    endDate: '',
    endCount: 12
  });
  
  // Edit Recurring Modal
  const [showEditRecurringModal, setShowEditRecurringModal] = useState(false);
  const [editingRecurring, setEditingRecurring] = useState(null);
  
  // Export Modal
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportConfig, setExportConfig] = useState({
    includeHistoric: true,
    includePredicted: true,
    applyFilters: true,
    format: 'csv',      // 'csv', 'ics', 'json', 'xlsx', 'pdf'
    htmlView: 'heatmap', // 'heatmap' | 'year'
    imageFormat: 'jpg',  // 'jpg' | 'png'
    pdfMonths: [],       // { year, month }[] — months to include as calendar pages
    pdfYearViews: []     // year[] — years to include as year-overview pages
  });
  
  // Upload Mode Modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);

  // Duplicate Detection Modal
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [potentialDuplicates, setPotentialDuplicates] = useState([]);
  const [selectedDuplicates, setSelectedDuplicates] = useState({}); // Track which duplicates to delete

  // File Manager Modal
  const [showFileManager, setShowFileManager] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [sidebarMini, setSidebarMini] = useState(false);
  const [loadedFiles, setLoadedFiles] = useState([]);
  const [hiddenFiles, setHiddenFiles] = useState([]); // Files explicitly unchecked in sidebar (opt-out model)
  const [uploadedFiles, setUploadedFiles] = useState({}); // Store raw File objects by filename

  // Column Mapper Modal
  const [showColumnMapper, setShowColumnMapper] = useState(false);
  const [columnMapperFile, setColumnMapperFile] = useState(null);
  const [columnMapperMode, setColumnMapperMode] = useState('replace'); // 'replace' or 'merge'
  const [fileDetectionResults, setFileDetectionResults] = useState({}); // Store detection results per file

  // Upload queue — files waiting to go through Column Mapper
  const [uploadQueue, setUploadQueue] = useState([]); // Array of { file, mode }

  // Transaction Selection/Edit Mode (for day detail popup)
  const [isTransactionEditMode, setIsTransactionEditMode] = useState(false);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState(new Set());
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [deletedTransactionIds, setDeletedTransactionIds] = useState(new Set()); // Track deleted transactions

  // ── Anti-bot & rate limiting constants ───────────────────────────────────────
  const LOGIN_RATE_WINDOW_MS   = 60_000;       // sliding 1-minute window
  const LOGIN_RATE_MAX         = 8;            // max submissions per window
  const LOGIN_LOCKOUT_DURATION = 5 * 60_000;  // 5-minute lockout

  // ── Supabase: restore session on page load & listen for auth changes ─────────
  useEffect(() => {
    if (!supabase) return;

    // Handle email confirmation links on page load.
    // Two flows are supported:
    //   ?token_hash=...&type=signup  — scanner-safe template (recommended, set in Supabase email template)
    //   ?code=...                    — PKCE flow fallback
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get('token_hash');
    const type = params.get('type');
    const code = params.get('code');

    let sessionPromise;
    if (tokenHash && type) {
      sessionPromise = supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        .then(({ data }) => data.session);
    } else if (code) {
      sessionPromise = supabase.auth.exchangeCodeForSession(code)
        .then(({ data }) => data.session);
    } else {
      sessionPromise = supabase.auth.getSession().then(({ data }) => data.session);
    }

    sessionPromise.then((session) => {
      if (tokenHash || code) {
        const url = new URL(window.location.href);
        url.searchParams.delete('token_hash');
        url.searchParams.delete('type');
        url.searchParams.delete('code');
        window.history.replaceState({}, '', url.toString());
      }
      if (session) {
        setIsLoggedIn(true);
        setShowAuth(false);
        setUsername(session.user.email ?? '');
        setUserId(session.user.id);
      }
    });

    // Subscribe to future auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setIsLoggedIn(true);
        setShowAuth(false);
        setUsername(session.user.email ?? '');
        setUserId(session.user.id);
      } else {
        setIsLoggedIn(false);
        setShowAuth(true);
        setUsername('');
        setUserId(null);
        setEmail('');
        setPassword('');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Seed default e-commerce mapping profiles on first load ───────────────
  // Runs once on mount. Only writes if the key is missing or empty so that
  // existing user-created profiles are never overwritten.
  useEffect(() => {
    const PROFILES_KEY = 'csv_mapping_profiles';
    try {
      const existing = JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]');
      if (existing.length > 0) return; // already seeded — do not overwrite
      localStorage.setItem(PROFILES_KEY, JSON.stringify([
        {
          name: 'Shopify',
          mode: 'ecommerce',
          mapping: {
            order_id:    'Name',
            order_date:  'Created At',
            fulfil_date: 'Fulfilled At',
            customer:    'Billing Name',
            amount:      'Total',
            status:      'Financial Status'
          }
        },
        {
          name: 'TikTok Shop',
          mode: 'ecommerce',
          mapping: {
            order_id:    'Order ID',
            order_date:  'Order Creation Time',
            fulfil_date: 'Package Shipped Time',
            customer:    'Recipient',
            amount:      'Order Amount',
            status:      'Order Status'
          }
        },
        {
          name: 'Etsy',
          mode: 'ecommerce',
          mapping: {
            order_id:    'Order ID',
            order_date:  'Sale Date',
            fulfil_date: 'Ship Date',
            customer:    'Buyer Username',
            amount:      'Order Value',
            status:      'Status'
          }
        },
        {
          name: 'WooCommerce',
          mode: 'ecommerce',
          mapping: {
            order_id:    'Order ID',
            order_date:  'Order Date',
            fulfil_date: 'Date Completed',
            customer:    'Billing First Name',
            amount:      'Order Total',
            status:      'Status'
          }
        }
      ]));
    } catch (e) {
      console.error('Failed to seed e-commerce profiles:', e);
    }
  }, []);

  // ── Restore files from Supabase Storage on login ──────────────────────────
  useEffect(() => {
    if (userId && supabase) {
      loadFilesFromStorage(userId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Cloudflare Turnstile: render widget when auth form is visible ─────────────
  useEffect(() => {
    if (!showAuth || !TURNSTILE_ENABLED) return;

    let cancelled = false;

    const renderWidget = () => {
      if (cancelled) return;
      // Wait for both the DOM ref and the Turnstile script to be ready
      if (!turnstileContainerRef.current || !window.turnstile) {
        setTimeout(renderWidget, 150);
        return;
      }
      // Tear down any existing widget before mounting a fresh one
      if (turnstileWidgetIdRef.current !== null) {
        try { window.turnstile.remove(turnstileWidgetIdRef.current); } catch { /* no-op */ }
      }
      turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback:          (token) => setTurnstileToken(token),
        'expired-callback': ()     => setTurnstileToken(''),
        'error-callback':   ()     => setTurnstileToken(''),
        theme: 'light',
      });
    };

    renderWidget();

    return () => {
      cancelled = true;
      if (turnstileWidgetIdRef.current !== null && window.turnstile) {
        try { window.turnstile.remove(turnstileWidgetIdRef.current); } catch { /* no-op */ }
        turnstileWidgetIdRef.current = null;
      }
      setTurnstileToken('');
    };
  }, [showAuth]);

  // Reset Turnstile token when switching between login / sign-up modes
  useEffect(() => {
    if (!TURNSTILE_ENABLED || turnstileWidgetIdRef.current === null || !window.turnstile) return;
    try { window.turnstile.reset(turnstileWidgetIdRef.current); } catch { /* no-op */ }
    setTurnstileToken('');
    setAuthError('');
    setAuthSuccess('');
  }, [authMode]);

  // ── Turnstile helper ─────────────────────────────────────────────────────────
  const resetTurnstile = () => {
    if (!TURNSTILE_ENABLED || turnstileWidgetIdRef.current === null || !window.turnstile) return;
    try { window.turnstile.reset(turnstileWidgetIdRef.current); } catch { /* no-op */ }
    setTurnstileToken('');
  };

  // Authentication handlers
  const handleAuth = async (e) => {
    e.preventDefault();

    // 1. Honeypot — silently reject bot submissions
    if (honeypot) return;

    const now = Date.now();

    // 2. Existing lockout
    if (now < loginLockedUntil) {
      const secsLeft = Math.ceil((loginLockedUntil - now) / 1000);
      setLoginAttemptMsg(`Too many attempts. Please wait ${secsLeft}s before trying again.`);
      return;
    }

    // 3. Sliding-window rate limit
    const raw = localStorage.getItem('tc_login_attempts');
    const attempts = raw ? JSON.parse(raw) : [];
    const recent = attempts.filter(ts => now - ts < LOGIN_RATE_WINDOW_MS);
    recent.push(now);
    localStorage.setItem('tc_login_attempts', JSON.stringify(recent));

    if (recent.length > LOGIN_RATE_MAX) {
      const lockUntil = now + LOGIN_LOCKOUT_DURATION;
      localStorage.setItem('tc_login_lock', String(lockUntil));
      setLoginLockedUntil(lockUntil);
      setLoginAttemptMsg('Too many login attempts. Please wait 5 minutes.');
      return;
    }

    // 4. Turnstile must be solved if enabled
    if (TURNSTILE_ENABLED && !turnstileToken) {
      setAuthError('Please complete the security check first.');
      return;
    }

    setAuthLoading(true);
    setAuthError('');
    setAuthSuccess('');
    setLoginAttemptMsg('');

    try {
      // 5. Verify Turnstile token server-side (prevents replay attacks)
      if (TURNSTILE_ENABLED) {
        const res = await fetch('/api/verify-turnstile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: turnstileToken }),
        });
        const { success } = await res.json();
        if (!success) {
          setAuthError('Security verification failed. Please solve the challenge again.');
          resetTurnstile();
          return;
        }
      }

      // 6a. Supabase auth path
      if (supabase) {
        if (authMode === 'login') {
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
          // onAuthStateChange listener handles setIsLoggedIn / setShowAuth
          localStorage.removeItem('tc_login_attempts');
        } else {
          const { error } = await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}/app` },
          });
          if (error) throw error;
          setAuthSuccess('Account created! Check your email and click the confirmation link, then log in.');
        }
      } else {
        // 6b. Demo fallback (no Supabase configured)
        if (email.trim()) {
          setIsLoggedIn(true);
          setShowAuth(false);
          setUsername(email);
          localStorage.removeItem('tc_login_attempts');
        }
      }
    } catch (err) {
      setAuthError(err?.message || 'Authentication failed. Please try again.');
      resetTurnstile();
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!window.confirm('Are you sure you want to logout? All unsaved data will be cleared.')) return;

    // Clear in-app data immediately
    setTransactions([]);
    setRecurringTransactions([]);
    setPredictedTransactions([]);
    setManualRecurring([]);
    setUploadedFileName([]);
    setPassword('');
    setEmail('');

    if (supabase) {
      // onAuthStateChange will set isLoggedIn→false and showAuth→true
      await supabase.auth.signOut();
    } else {
      // Demo fallback
      setIsLoggedIn(false);
      setShowAuth(true);
      setUsername('');
    }
  };

  // ── Supabase Storage helpers ───────────────────────────────────────────────
  const STORAGE_BUCKET = 'csv-files';

  const uploadFileToStorage = async (file, uid) => {
    if (!supabase || !uid) return;
    try {
      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(`${uid}/${file.name}`, file, { upsert: true });
      if (error) console.warn('[Storage] Upload failed:', error.message);
      else console.log('[Storage] Uploaded:', file.name);
    } catch (err) {
      console.warn('[Storage] Upload error:', err);
    }
  };

  const deleteFileFromStorage = async (fileName, uid) => {
    if (!supabase || !uid) return;
    try {
      await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([`${uid}/${fileName}`]);
      console.log('[Storage] Deleted:', fileName);
    } catch (err) {
      console.warn('[Storage] Delete error:', err);
    }
  };

  const loadFilesFromStorage = async (uid) => {
    if (!supabase || !uid) return;
    try {
      const { data: files, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .list(uid, { limit: 100, sortBy: { column: 'created_at', order: 'asc' } });

      if (error) { console.warn('[Storage] List error:', error.message); return; }
      if (!files || files.length === 0) return;

      setStorageLoading(true);
      console.log('[Storage] Restoring', files.length, 'file(s) for user', uid);

      for (const fileItem of files) {
        try {
          const { data: blob, error: dlError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .download(`${uid}/${fileItem.name}`);

          if (dlError || !blob) {
            console.warn('[Storage] Download failed:', fileItem.name, dlError?.message);
            continue;
          }

          // Restore File object so column remapper can use it later
          const file = new File([blob], fileItem.name, { type: 'text/csv' });
          setUploadedFiles(prev => ({ ...prev, [fileItem.name]: file }));

          // Always register the file name (applyParsedTransactions updates loadedFiles
          // but not uploadedFileName — the sidebar Files section reads uploadedFileName)
          setUploadedFileName(prev =>
            prev.includes(fileItem.name) ? prev : [...prev, fileItem.name]
          );

          // Parse silently — bypass column mapper even on low confidence
          const text = await blob.text();
          const parseResult = parseBankCSV(text, fileItem.name);
          const confidence = parseResult.format.confidence || (parseResult.format.score / 10);

          setFileDetectionResults(prev => ({
            ...prev,
            [fileItem.name]: { ...parseResult.format, confidence }
          }));

          if (parseResult.transactions.length > 0) {
            applyParsedTransactions(parseResult.transactions, fileItem.name, 'merge');
          }
          // (0-transaction files: name is already registered above, user can remap)
        } catch (err) {
          console.warn('[Storage] Error restoring file:', fileItem.name, err);
        }
      }

      setStorageLoading(false);
    } catch (err) {
      console.warn('[Storage] Load error:', err);
      setStorageLoading(false);
    }
  };
  // ──────────────────────────────────────────────────────────────────────────

  const handleFileRemove = (fileName, e) => {
    // Stop event propagation to prevent triggering checkbox toggle
    if (e) {
      e.stopPropagation();
    }

    if (window.confirm(`Delete ${fileName} from File Manager?\n\nThis will remove the file and all its transactions.`)) {
      // Remove transactions from this file
      const filteredTransactions = transactions.filter(t => t.sourceFile !== fileName);
      setTransactions(filteredTransactions);

      // Remove file name from list
      const filteredFileNames = uploadedFileName.filter(f => f !== fileName);
      setUploadedFileName(filteredFileNames);

      // Remove from uploaded files object
      const newUploadedFiles = { ...uploadedFiles };
      delete newUploadedFiles[fileName];
      setUploadedFiles(newUploadedFiles);

      // Remove from loaded files
      const filteredLoadedFiles = loadedFiles.filter(f => f !== fileName);
      setLoadedFiles(filteredLoadedFiles);

      // Remove from hidden files list
      setHiddenFiles(prev => prev.filter(f => f !== fileName));

      // Remove from Supabase Storage
      deleteFileFromStorage(fileName, userId);

      // If no files left, clear manual recurring and filters
      if (filteredFileNames.length === 0) {
        setManualRecurring([]);
        setAvailableFilterOptions({});
        setActiveFilters({});
      } else {
        // Rebuild filter options from remaining transactions
        const filterOptions = {
          type: [...new Set(filteredTransactions.map(t => t.type).filter(v => v))],
          category: [...new Set(filteredTransactions.map(t => t.category).filter(v => v))],
          description: [...new Set(filteredTransactions.map(t => t.description).filter(v => v))],
          reference: [...new Set(filteredTransactions.map(t => t.reference).filter(v => v))]
        };
        setAvailableFilterOptions(filterOptions);
      }
    }
  };

  // Switch Mode — returns user to mode selector
  const handleSwitchMode = () => {
    if (!window.confirm('Switch data mode? This will clear all loaded data (mapping profiles will be kept).')) return;
    setTransactions([]);
    setOrders([]);
    setLoadedFiles([]);
    setDataMode(null);
    localStorage.removeItem('data_mode');
    setActivePlatforms(new Set());
    setActiveFilters({});
    setEcomFilterCols([]);
  };

  const MAX_FILE_SIZE_MB = 50;

  const handleMultiFileUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // Enforce per-file size limit to prevent browser freeze
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE_MB * 1024 * 1024);
    if (oversized.length > 0) {
      const names = oversized.map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`).join('\n');
      alert(`The following file(s) exceed the ${MAX_FILE_SIZE_MB} MB limit and cannot be uploaded:\n\n${names}`);
      e.target.value = '';
      return;
    }

    // Check for duplicate files and ask user to confirm overwrite
    const duplicates = files.filter(file => uploadedFileName.includes(file.name));

    let filesToProcess = [...files];

    if (duplicates.length > 0) {
      const duplicateNames = duplicates.map(f => f.name).join(', ');
      const confirmOverwrite = window.confirm(
        `The following file(s) already exist in File Manager:\n\n${duplicateNames}\n\n` +
        `Click OK to OVERWRITE these files\n` +
        `Click Cancel to skip uploading duplicates`
      );

      if (!confirmOverwrite) {
        filesToProcess = files.filter(file => !uploadedFileName.includes(file.name));
        if (filesToProcess.length === 0) {
          e.target.value = '';
          return;
        }
      } else {
        // Remove old versions of overwritten files from state
        const newUploadedFiles = { ...uploadedFiles };
        const newFileNames = uploadedFileName.filter(name => !duplicates.find(d => d.name === name));
        const newLoadedFiles = loadedFiles.filter(name => !duplicates.find(d => d.name === name));
        const newTransactions = transactions.filter(t => !duplicates.find(d => d.name === t.sourceFile));
        duplicates.forEach(file => { delete newUploadedFiles[file.name]; });
        setUploadedFiles(newUploadedFiles);
        setUploadedFileName(newFileNames);
        setLoadedFiles(newLoadedFiles);
        setTransactions(newTransactions);
      }
    }

    // Store raw File objects immediately so they're accessible
    const newUploadedFiles = { ...uploadedFiles };
    filesToProcess.forEach(file => { newUploadedFiles[file.name] = file; });
    setUploadedFiles(newUploadedFiles);

    // First file replaces if no existing data, rest always merge
    const queue = filesToProcess.map((file, idx) => ({
      file,
      mode: idx === 0 && transactions.length === 0 ? 'replace' : 'merge'
    }));

    // If column mapper is already open, append to queue; otherwise open for first file
    if (showColumnMapper) {
      setUploadQueue(prev => [...prev, ...queue]);
    } else {
      const [first, ...rest] = queue;
      setUploadQueue(rest);
      // Run auto-detection to pre-populate mapper, then open it
      openColumnMapperForFile(first.file, first.mode);
    }

    e.target.value = '';
  };

  // Open the Column Mapper for a file, running auto-detection first to pre-populate suggestions
  const openColumnMapperForFile = (file, mode) => {
    // Run detection so ColumnMapper can show suggested mappings
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parseResult = parseBankCSV(ev.target.result, file.name);
        const confidence = parseResult.format.confidence || (parseResult.format.score / 10);
        setFileDetectionResults(prev => ({
          ...prev,
          [file.name]: { ...parseResult.format, confidence }
        }));
      } catch { /* ignore, mapper will handle it */ }
      setColumnMapperFile(file);
      setColumnMapperMode(mode);
      setShowColumnMapper(true);
    };
    reader.onerror = () => {
      // Open mapper anyway
      setColumnMapperFile(file);
      setColumnMapperMode(mode);
      setShowColumnMapper(true);
    };
    reader.readAsText(file);
  };

  // FIXED: toggleFileInCalendar - no longer deletes transactions when unloading
  const toggleFileInCalendar = (fileName) => {
    console.log('[toggleFileInCalendar] Called for:', fileName);
    const isCurrentlyLoaded = loadedFiles.includes(fileName);
    console.log('[toggleFileInCalendar] Currently loaded:', isCurrentlyLoaded);

    if (isCurrentlyLoaded) {
      // Unload file from calendar - but KEEP the transactions in state
      // Just remove from loadedFiles so they won't be displayed
      const newLoadedFiles = loadedFiles.filter(f => f !== fileName);
      setLoadedFiles(newLoadedFiles);

      // Rebuild filter options from remaining loaded transactions
      if (newLoadedFiles.length === 0) {
        setAvailableFilterOptions({});
        setActiveFilters({});
      } else {
        // Filter transactions by remaining loaded files
        const remainingTransactions = transactions.filter(t => newLoadedFiles.includes(t.sourceFile));
        const filterOptions = {
          type: [...new Set(remainingTransactions.map(t => t.type).filter(v => v))],
          category: [...new Set(remainingTransactions.map(t => t.category).filter(v => v))],
          description: [...new Set(remainingTransactions.map(t => t.description).filter(v => v))],
          reference: [...new Set(remainingTransactions.map(t => t.reference).filter(v => v))]
        };
        setAvailableFilterOptions(filterOptions);
      }
    } else {
      // Load file to calendar
      const file = uploadedFiles[fileName];
      if (!file) return;

      // Clear any deleted transaction IDs for this file (restore deleted transactions)
      const fileTransactions = transactions.filter(t => t.sourceFile === fileName);
      if (fileTransactions.length > 0 && deletedTransactionIds.size > 0) {
        const fileTransactionIds = new Set(fileTransactions.map(t => getTransactionId(t)));
        setDeletedTransactionIds(prev => {
          const newSet = new Set(prev);
          fileTransactionIds.forEach(id => newSet.delete(id));
          return newSet;
        });
      }

      // Check if this file's transactions are already in the transactions array
      const existingTransactions = transactions.filter(t => t.sourceFile === fileName);

      if (existingTransactions.length > 0) {
        console.log('[toggleFileInCalendar] Found', existingTransactions.length, 'existing transactions, just adding to loadedFiles');
        // Transactions already exist in state, just add to loaded files to display them
        const newLoadedFiles = [...new Set([...loadedFiles, fileName])];
        setLoadedFiles(newLoadedFiles);

        // Rebuild filter options from all loaded files including this one
        const allLoadedTransactions = transactions.filter(t => newLoadedFiles.includes(t.sourceFile));
        const filterOptions = {
          type: [...new Set(allLoadedTransactions.map(t => t.type).filter(v => v))],
          category: [...new Set(allLoadedTransactions.map(t => t.category).filter(v => v))],
          description: [...new Set(allLoadedTransactions.map(t => t.description).filter(v => v))],
          reference: [...new Set(allLoadedTransactions.map(t => t.reference).filter(v => v))]
        };
        setAvailableFilterOptions(filterOptions);

        // Jump to last transaction month of loaded files
        if (allLoadedTransactions.length > 0) {
          const lastTransaction = allLoadedTransactions.reduce((latest, t) =>
            t.date > latest.date ? t : latest
          );
          setCurrentDate(new Date(lastTransaction.date.getFullYear(), lastTransaction.date.getMonth(), 1));
          setViewMode('calendar');
        }
      } else {
        console.log('[toggleFileInCalendar] No existing transactions, need to parse file');
        // Need to process the file - no transactions exist yet
        // FIX: Use 'merge' if ANY other files have transactions to prevent race conditions
        const hasExistingData = transactions.length > 0;
        const fileMode = hasExistingData ? 'merge' : 'replace';
        processFileUpload(file, fileMode);
        // processFileUpload already updates loadedFiles, so we're done
      }
    }
  };


  // Calculate variable amount for predictions based on historical variance
  const calculateVariableAmount = (historicalTransactions) => {
    if (historicalTransactions.length < 2) {
      return {
        amount: historicalTransactions[0].amount,
        isVariable: false,
        variance: 0
      };
    }

    const amounts = historicalTransactions.map(t => t.amount);
    const avgAmount = amounts.reduce((sum, amt) => sum + amt, 0) / amounts.length;
    
    // Calculate variance (standard deviation)
    const squaredDiffs = amounts.map(amt => Math.pow(amt - avgAmount, 2));
    const variance = Math.sqrt(squaredDiffs.reduce((sum, val) => sum + val, 0) / amounts.length);
    
    // Consider it variable if variance is > 5% of average
    const isVariable = Math.abs(variance / avgAmount) > 0.05;
    
    return {
      amount: avgAmount,
      isVariable: isVariable,
      variance: variance,
      minAmount: Math.min(...amounts),
      maxAmount: Math.max(...amounts)
    };
  };

  // Enhanced recurring detection with multi-interval and day-of-month patterns
  const detectRecurringTransactions = (txns) => {
    const recurring = [];
    const grouped = {};

    txns.forEach(t => {
      const key = `${t.description}_${Math.abs(t.amount).toFixed(2)}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(t);
    });

    Object.values(grouped).forEach(group => {
      if (group.length >= 3) {
        group.sort((a, b) => a.date - b.date);
        
        const intervals = [];
        for (let i = 1; i < group.length; i++) {
          const days = Math.round((group[i].date - group[i-1].date) / (1000 * 60 * 60 * 24));
          intervals.push(days);
        }
        
        // Check for multiple common patterns
        const patterns = [
          { name: 'Weekly', target: 7, tolerance: 1 },
          { name: 'Bi-weekly', target: 14, tolerance: 2 },
          { name: 'Monthly', target: 30, tolerance: 3 },
          { name: 'Quarterly', target: 91, tolerance: 5 },
          { name: 'Yearly', target: 365, tolerance: 7 }
        ];
        
        for (const pattern of patterns) {
          const matchingIntervals = intervals.filter(i => 
            Math.abs(i - pattern.target) <= pattern.tolerance
          );
          
          if (matchingIntervals.length >= intervals.length * 0.7) { // 70% match
            const avgInterval = matchingIntervals.reduce((a, b) => a + b, 0) / matchingIntervals.length;
            
            // Calculate variable amount
            const amountData = calculateVariableAmount(group);
            
            // Check for day-of-month pattern (for monthly/quarterly/yearly)
            let dayOfMonthPattern = null;
            if (['Monthly', 'Quarterly', 'Yearly'].includes(pattern.name)) {
              const daysOfMonth = group.map(t => t.date.getDate());
              const mostCommonDay = daysOfMonth.sort((a, b) =>
                daysOfMonth.filter(v => v === a).length - daysOfMonth.filter(v => v === b).length
              ).pop();
              
              const dayMatches = daysOfMonth.filter(d => Math.abs(d - mostCommonDay) <= 3).length;
              if (dayMatches >= daysOfMonth.length * 0.7) {
                dayOfMonthPattern = mostCommonDay;
              }
            }
            
            // Check for day-of-week pattern (for weekly/bi-weekly)
            let dayOfWeekPattern = null;
            if (['Weekly', 'Bi-weekly'].includes(pattern.name)) {
              const daysOfWeek = group.map(t => t.date.getDay());
              const mostCommonDay = daysOfWeek.sort((a, b) =>
                daysOfWeek.filter(v => v === a).length - daysOfWeek.filter(v => v === b).length
              ).pop();
              
              const dayMatches = daysOfWeek.filter(d => d === mostCommonDay).length;
              if (dayMatches >= daysOfWeek.length * 0.7) {
                dayOfWeekPattern = mostCommonDay;
              }
            }
            
            recurring.push({
              id: `auto_${group[0].description}_${Math.abs(group[0].amount).toFixed(2)}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              description: group[0].description,
              amount: amountData.amount,
              isVariableAmount: amountData.isVariable,
              amountVariance: amountData.variance,
              minAmount: amountData.minAmount,
              maxAmount: amountData.maxAmount,
              category: group[0].category,
              type: group[0].type,
              frequency: Math.round(avgInterval),
              patternName: pattern.name,
              occurrences: group.length,
              lastDate: group[group.length - 1].date,
              dayOfMonth: dayOfMonthPattern,
              dayOfWeek: dayOfWeekPattern,
              isAutoDetected: true,
              historicalTransactions: group
            });
            break; // Use first matching pattern
          }
        }
      }
    });

    return recurring;
  };


    // Detect potential duplicate recurring transactions
    // Helper function to normalize description for matching
    const normalizeDescription = (desc) => {
      return desc
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[^a-z0-9\s]/g, ''); // Remove special characters
    };
    
    // Helper function to check if two descriptions are similar
    const areSimilarDescriptions = (desc1, desc2) => {
      const norm1 = normalizeDescription(desc1);
      const norm2 = normalizeDescription(desc2);
      
      // Exact match
      if (norm1 === norm2) return true;
      
      // One contains the other
      if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
      
      // Check for common words (at least 2 common significant words)
      const words1 = norm1.split(' ').filter(w => w.length > 3);
      const words2 = norm2.split(' ').filter(w => w.length > 3);
      const commonWords = words1.filter(w => words2.includes(w));
      if (commonWords.length >= 2) return true;
      
      // Check for very close match (Levenshtein-like similarity)
      const longer = norm1.length > norm2.length ? norm1 : norm2;
      const shorter = norm1.length > norm2.length ? norm2 : norm1;
      const ratio = shorter.length / longer.length;
      if (ratio > 0.7 && longer.includes(shorter.substring(0, 5))) return true;
      
      return false;
    };

    const detectDuplicates = (recurring) => {
      const duplicateGroups = [];
      const processed = new Set();
      
      // Find all similar transactions
      for (let i = 0; i < recurring.length; i++) {
        if (processed.has(i)) continue;
        
        const similar = [i];
        const r1 = recurring[i];
        
        // Find all transactions similar to r1
        for (let j = i + 1; j < recurring.length; j++) {
          if (processed.has(j)) continue;
          
          const r2 = recurring[j];
          
          // Check if descriptions are similar
          const isSimilarDescription = areSimilarDescriptions(r1.description, r2.description);
          
          if (isSimilarDescription) {
            similar.push(j);
            processed.add(j);
          }
        }
        
        // If we found similar transactions, create a group
        if (similar.length > 1) {
          processed.add(i);
          duplicateGroups.push({
            id: `dup_group_${i}`,
            transactions: similar.map(idx => recurring[idx]),
            indices: similar
          });
        }
      }
      
      return duplicateGroups;
    };

  // Generate predictions from both auto-detected and manual recurring
  const generatePredictions = (autoRecurring, manualRecurring) => {
    const predictions = [];
    const today = new Date();
    const futureMonths = 6; // Predict 6 months ahead by default
    const maxDate = new Date(today.getFullYear(), today.getMonth() + futureMonths, today.getDate());

    // Auto-detected recurring
    autoRecurring.forEach(r => {
      let nextDate = new Date(r.lastDate);
      
      if (r.dayOfMonth) {
        // Use day-of-month pattern
        nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, r.dayOfMonth);
        if (r.patternName === 'Quarterly') {
          nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 3, r.dayOfMonth);
        } else if (r.patternName === 'Yearly') {
          nextDate = new Date(nextDate.getFullYear() + 1, nextDate.getMonth(), r.dayOfMonth);
        }
      } else if (r.dayOfWeek !== null) {
        // Use day-of-week pattern
        nextDate.setDate(nextDate.getDate() + r.frequency);
        // Adjust to correct day of week
        while (nextDate.getDay() !== r.dayOfWeek) {
          nextDate.setDate(nextDate.getDate() + 1);
        }
      } else {
        // Use simple interval
        nextDate.setDate(nextDate.getDate() + r.frequency);
      }

      while (nextDate <= maxDate) {
        // Only predict future transactions
        if (nextDate > today) {
          predictions.push({
            date: new Date(nextDate),
            description: r.description,
            amount: r.amount,
            isVariableAmount: r.isVariableAmount,
            amountVariance: r.amountVariance,
            minAmount: r.minAmount,
            maxAmount: r.maxAmount,
            category: r.category,
            type: r.type,
            isPredicted: true,
            isAutoDetected: true,
            confidence: r.occurrences >= 6 ? 'high' : 'medium',
            frequency: r.patternName,
            sourceRecurringId: null
          });
        }
        
        // Calculate next occurrence
        if (r.dayOfMonth) {
          if (r.patternName === 'Monthly') {
            nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, r.dayOfMonth);
          } else if (r.patternName === 'Quarterly') {
            nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 3, r.dayOfMonth);
          } else if (r.patternName === 'Yearly') {
            nextDate = new Date(nextDate.getFullYear() + 1, nextDate.getMonth(), r.dayOfMonth);
          }
        } else if (r.dayOfWeek !== null) {
          nextDate.setDate(nextDate.getDate() + r.frequency);
          while (nextDate.getDay() !== r.dayOfWeek) {
            nextDate.setDate(nextDate.getDate() + 1);
          }
        } else {
          nextDate.setDate(nextDate.getDate() + r.frequency);
        }
      }
    });

    // Manual recurring
    manualRecurring.forEach(r => {
      let nextDate = new Date(r.startDate);
      let count = 0;

      // Check if we should stop generating
      const shouldContinue = (date, count) => {
        if (r.endType === 'never') return date <= maxDate;
        if (r.endType === 'date') return date <= new Date(r.endDate) && date <= maxDate;
        if (r.endType === 'count') return count < r.endCount && date <= maxDate;
        return false;
      };

      while (shouldContinue(nextDate, count)) {
        // Skip if it's the original transaction date
        const isOriginalDate = nextDate.getDate() === r.startDate.getDate() &&
                               nextDate.getMonth() === r.startDate.getMonth() &&
                               nextDate.getFullYear() === r.startDate.getFullYear();
        
        if (!isOriginalDate && nextDate > today) {
          predictions.push({
            date: new Date(nextDate),
            description: r.description,
            amount: r.amount,
            isVariableAmount: r.isVariableAmount || false,
            category: r.category,
            type: r.type,
            reference: r.reference,
            isPredicted: true,
            isManual: true,
            confidence: 'manual',
            frequency: r.frequencyLabel,
            sourceRecurringId: r.id
          });
        }
        
        // Calculate next occurrence based on frequency
        if (r.frequency === 'weekly') {
          nextDate = new Date(nextDate);
          nextDate.setDate(nextDate.getDate() + 7);
        } else if (r.frequency === 'biweekly') {
          nextDate = new Date(nextDate);
          nextDate.setDate(nextDate.getDate() + 14);
        } else if (r.frequency === 'monthly') {
          nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, r.dayOfMonth || nextDate.getDate());
        } else if (r.frequency === 'quarterly') {
          nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 3, r.dayOfMonth || nextDate.getDate());
        } else if (r.frequency === 'yearly') {
          nextDate = new Date(nextDate.getFullYear() + 1, nextDate.getMonth(), r.dayOfMonth || nextDate.getDate());
        } else if (r.frequency === 'custom') {
          nextDate = new Date(nextDate);
          nextDate.setDate(nextDate.getDate() + r.customDays);
        }
        
        count++;
        
        // Safety check to prevent infinite loops
        if (count > 500) break;
      }
    });

    return predictions;
  };

  // Rebuild sidebar filter options for ecommerce mode whenever orders or loaded files change
  useEffect(() => {
    if (dataMode !== 'ecommerce' || orders.length === 0) return;
    // Only build options from files that are both loaded AND not hidden in the sidebar
    const loaded = orders.filter(o => loadedFiles.includes(o.sourceFile) && !hiddenFiles.includes(o.sourceFile));

    const opts = {};
    const addVal = (key, val) => {
      const v = String(val ?? '').trim();
      if (!v) return;
      if (!opts[key]) opts[key] = new Set();
      opts[key].add(v);
    };

    loaded.forEach(o => {
      if (o.status)   addVal('status',   o.status);
      if (o.platform) addVal('platform', o.platform);
      if (o.channel)  addVal('channel',  o.channel);
      if (o.customer) addVal('customer', o.customer);
      if (o.custom) {
        Object.entries(o.custom).forEach(([label, val]) => addVal(label, val));
      }
    });

    const result = {};
    Object.entries(opts).forEach(([k, s]) => { result[k] = [...s].sort(); });
    setAvailableFilterOptions(result);

    // Prune selections that no longer have any visible orders (file deselected)
    const presentPlatforms = new Set(loaded.map(o => o.platform).filter(Boolean));
    setActivePlatforms(prev => {
      const next = new Set([...prev].filter(p => presentPlatforms.has(p)));
      return next.size === prev.size ? prev : next;
    });
    const presentStatuses = new Set(loaded.map(o => (o.status || '').toLowerCase()).filter(Boolean));
    setActiveStatus(prev => (prev === 'all' || presentStatuses.has(prev)) ? prev : 'all');
    setActiveFilters(prev => pruneActiveFilters(prev, result));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, loadedFiles, hiddenFiles, dataMode]);

  // Rebuild sidebar filter options for bank mode from only the visible files,
  // so deselecting a file in the sidebar also removes that file's filter values.
  // Mirrors the visibility predicate used by getFilteredTransactions (hiddenFiles).
  useEffect(() => {
    if (dataMode === 'ecommerce') return;
    if (transactions.length === 0) { setAvailableFilterOptions({}); return; }
    const visible = transactions.filter(t => !hiddenFiles.includes(t.sourceFile));
    const result = {
      type:        [...new Set(visible.map(t => t.type).filter(Boolean))],
      category:    [...new Set(visible.map(t => t.category).filter(Boolean))],
      description: [...new Set(visible.map(t => t.description).filter(Boolean))],
      reference:   [...new Set(visible.map(t => t.reference).filter(Boolean))],
    };
    setAvailableFilterOptions(result);
    setActiveFilters(prev => pruneActiveFilters(prev, result));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, hiddenFiles, dataMode]);

  // Update predictions when transactions or manual recurring changes
  useEffect(() => {
    if (transactions.length > 0) {
      const recurring = detectRecurringTransactions(transactions);
      setRecurringTransactions(recurring);
      
      // Auto-tag Direct Debit transactions as recurring
      const directDebits = transactions.filter(t => 
        t.type && (
          t.type.toLowerCase().includes('direct debit') ||
          t.type.toLowerCase().includes('dd') ||
          t.type.toLowerCase() === 'direct_debit'
        )
      );
      
      // Group direct debits by description and amount
      const ddGroups = {};
      directDebits.forEach(dd => {
        const key = `${dd.description}_${Math.abs(dd.amount).toFixed(2)}`;
        if (!ddGroups[key]) {
          ddGroups[key] = [];
        }
        ddGroups[key].push(dd);
      });
      
      // Auto-create manual recurring for direct debits that aren't already tagged
      const newManualRecurring = [];
      Object.values(ddGroups).forEach(group => {
        if (group.length > 0) {
          // Sort by date to get the first occurrence
          group.sort((a, b) => a.date - b.date);
          const firstDD = group[0];
          
          // Check if this DD is already in manual recurring
          const alreadyExists = manualRecurring.some(r => 
            r.description === firstDD.description && 
            Math.abs(r.amount - firstDD.amount) < 0.01
          );
          
          if (!alreadyExists) {
            // Calculate frequency from intervals if multiple occurrences
            let frequency = 'monthly';
            let dayOfMonth = firstDD.date.getDate();
            
            // Calculate variable amount for direct debits
            const amountData = calculateVariableAmount(group);
            
            if (group.length >= 2) {
              const intervals = [];
              for (let i = 1; i < group.length; i++) {
                const days = Math.round((group[i].date - group[i-1].date) / (1000 * 60 * 60 * 24));
                intervals.push(days);
              }
              const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
              
              if (avgInterval >= 6 && avgInterval <= 8) frequency = 'weekly';
              else if (avgInterval >= 13 && avgInterval <= 15) frequency = 'biweekly';
              else if (avgInterval >= 27 && avgInterval <= 33) frequency = 'monthly';
              else if (avgInterval >= 88 && avgInterval <= 94) frequency = 'quarterly';
              else if (avgInterval >= 360 && avgInterval <= 370) frequency = 'yearly';
            }
            
            const frequencyLabels = {
              weekly: 'Weekly',
              biweekly: 'Bi-weekly',
              monthly: 'Monthly',
              quarterly: 'Quarterly',
              yearly: 'Yearly'
            };
            
            newManualRecurring.push({
              id: `dd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              ...firstDD,
              amount: amountData.amount,
              isVariableAmount: amountData.isVariable,
              amountVariance: amountData.variance,
              minAmount: amountData.minAmount,
              maxAmount: amountData.maxAmount,
              startDate: firstDD.date,
              frequency: frequency,
              frequencyLabel: frequencyLabels[frequency],
              customDays: 30,
              dayOfWeek: firstDD.date.getDay(),
              dayOfMonth: dayOfMonth,
              endType: 'never',
              endDate: '',
              endCount: 12,
              isManual: true,
              isAutoTagged: true // Mark as auto-tagged from Direct Debit
            });
          }
        }
      });
      
      // Add new auto-tagged Direct Debits to manual recurring
      if (newManualRecurring.length > 0) {
        setManualRecurring(prev => [...prev, ...newManualRecurring]);
      }
    }
  }, [transactions]);

  useEffect(() => {
    const predictions = generatePredictions(recurringTransactions, manualRecurring);
    setPredictedTransactions(predictions);
    
    // Detect duplicates in manual recurring transactions
    const dups = detectDuplicates(manualRecurring);
    setPotentialDuplicates(dups);
    
    // Initialize selection state for duplicates (all transactions in a group can be selected)
    const initialSelection = {};
    dups.forEach(dup => {
      initialSelection[dup.id] = dup.transactions.map(() => false);
    });
    setSelectedDuplicates(initialSelection);
  }, [recurringTransactions, manualRecurring]);

  
  // Toggle selection of a duplicate for deletion
  const toggleDuplicateSelection = (dupId, index) => {
    setSelectedDuplicates(prev => {
      const newState = { ...prev };
      const groupSelections = [...(newState[dupId] || [])];
      groupSelections[index] = !groupSelections[index];
      newState[dupId] = groupSelections;
      return newState;
    });
  };

  // Delete selected duplicates
  const deleteSelectedDuplicates = () => {
    const toDeleteManual = [];
    const toDeleteAuto = [];

    potentialDuplicates.forEach(dup => {
      const selections = selectedDuplicates[dup.id] || [];
      selections.forEach((isSelected, idx) => {
        if (isSelected) {
          const txn = dup.transactions[idx];
          if (txn.source === 'manual' || txn.isManual) {
            toDeleteManual.push(txn.id);
          } else {
            toDeleteAuto.push(txn.id);
          }
        }
      });
    });

    const totalToDelete = toDeleteManual.length + toDeleteAuto.length;

    if (totalToDelete === 0) {
      alert('Please select at least one transaction to delete.');
      return;
    }

    let message = `Delete ${totalToDelete} recurring transaction(s)?`;
    if (toDeleteAuto.length > 0) {
      message += `\n\nNote: ${toDeleteAuto.length} auto-detected transaction(s) will be removed from the recurring list.`;
    }

    if (window.confirm(message)) {
      // Remove from manual recurring
      if (toDeleteManual.length > 0) {
        setManualRecurring(manualRecurring.filter(r => !toDeleteManual.includes(r.id)));
      }

      // Remove from auto-detected recurring
      if (toDeleteAuto.length > 0) {
        setRecurringTransactions(recurringTransactions.filter(r => !toDeleteAuto.includes(r.id)));
      }

      setShowDuplicateModal(false);
    }
  };

  // Keep both transactions (remove from duplicates list)
  const keepBothDuplicates = (dupId) => {
    setPotentialDuplicates(potentialDuplicates.filter(d => d.id !== dupId));
  };

  // Open recurring modal for a transaction
  const openRecurringModal = (transaction) => {
    setSelectedTransaction(transaction);
    setRecurringConfig({
      frequency: 'monthly',
      customDays: 30,
      dayOfWeek: transaction.date.getDay(),
      dayOfMonth: transaction.date.getDate(),
      endType: 'never',
      endDate: '',
      endCount: 12
    });
    setShowRecurringModal(true);
  };

  // Save manual recurring transaction
  const saveManualRecurring = () => {
    if (!selectedTransaction) return;

    const frequencyLabels = {
      weekly: 'Weekly',
      biweekly: 'Bi-weekly',
      monthly: 'Monthly',
      quarterly: 'Quarterly',
      yearly: 'Yearly',
      custom: `Every ${recurringConfig.customDays} days`
    };

    const newRecurring = {
      id: Date.now().toString(),
      ...selectedTransaction,
      startDate: selectedTransaction.date,
      frequency: recurringConfig.frequency,
      frequencyLabel: frequencyLabels[recurringConfig.frequency],
      customDays: recurringConfig.customDays,
      dayOfWeek: recurringConfig.dayOfWeek,
      dayOfMonth: recurringConfig.dayOfMonth,
      endType: recurringConfig.endType,
      endDate: recurringConfig.endDate,
      endCount: recurringConfig.endCount,
      isManual: true
    };

    setManualRecurring([...manualRecurring, newRecurring]);
    setShowRecurringModal(false);
    setSelectedTransaction(null);
  };

  // Remove manual recurring transaction
  const removeManualRecurring = (recurring) => {
    const isAuto = recurring.source === 'auto' || (!recurring.isManual && !recurring.isAutoTagged);
    const message = isAuto
      ? 'Remove this auto-detected recurring transaction from the list? This will only remove it from recurring tracking, not delete historical transactions.'
      : 'Remove this recurring transaction? Future predictions will be deleted.';

    if (window.confirm(message)) {
      if (isAuto) {
        // Remove from auto-detected recurring transactions
        setRecurringTransactions(recurringTransactions.filter(r => r.id !== recurring.id));
      } else {
        // Remove from manual recurring
        setManualRecurring(manualRecurring.filter(r => r.id !== recurring.id));
      }
    }
  };

  // Open edit modal for recurring transaction
  const openEditRecurringModal = (recurring) => {
    setEditingRecurring(recurring);
    setRecurringConfig({
      frequency: recurring.frequency,
      customDays: recurring.customDays || 30,
      dayOfWeek: recurring.dayOfWeek || 1,
      dayOfMonth: recurring.dayOfMonth || 1,
      endType: recurring.endType,
      endDate: recurring.endDate,
      endCount: recurring.endCount
    });
    setShowEditRecurringModal(true);
  };

  // Update manual recurring transaction
  const updateManualRecurring = () => {
    if (!editingRecurring) return;

    const frequencyLabels = {
      weekly: 'Weekly',
      biweekly: 'Bi-weekly',
      monthly: 'Monthly',
      quarterly: 'Quarterly',
      yearly: 'Yearly',
      custom: `Every ${recurringConfig.customDays} days`
    };

    const updatedRecurring = {
      ...editingRecurring,
      frequency: recurringConfig.frequency,
      frequencyLabel: frequencyLabels[recurringConfig.frequency],
      customDays: recurringConfig.customDays,
      dayOfWeek: recurringConfig.dayOfWeek,
      dayOfMonth: recurringConfig.dayOfMonth,
      endType: recurringConfig.endType,
      endDate: recurringConfig.endDate,
      endCount: recurringConfig.endCount
    };

    setManualRecurring(manualRecurring.map(r => 
      r.id === editingRecurring.id ? updatedRecurring : r
    ));
    
    setShowEditRecurringModal(false);
    setEditingRecurring(null);
  };

  // Export ecommerce orders in multiple formats (CSV / JSON / ICS / XLSX / PDF).
  // Mirrors what the calendar shows: loaded & not-hidden files, optionally
  // narrowed by the active sidebar filters (platform / status / custom).
  const exportOrders = async () => {
    let ordersToExport = orders.filter(
      o => loadedFiles.includes(o.sourceFile) && !hiddenFiles.includes(o.sourceFile)
    );
    if (exportConfig.applyFilters && hasActiveFilters()) {
      ordersToExport = getFilteredOrders();
    }
    ordersToExport = [...ordersToExport].sort((a, b) => a.date - b.date);

    if (ordersToExport.length === 0) {
      alert('No orders to export. Check that at least one file is selected in the sidebar.');
      return;
    }

    // Union of custom column labels present across the exported orders
    const customKeys = [...new Set(
      ordersToExport.flatMap(o => (o.custom ? Object.keys(o.custom) : []))
    )];

    const fmtDate = (d) => (d instanceof Date && !isNaN(d)) ? d.toISOString().split('T')[0] : '';
    const baseFilename = `orders_${new Date().toISOString().split('T')[0]}`;

    let content, mimeType, extension;

    switch (exportConfig.format) {
      case 'ics': {
        const escapeIcsText = (str) =>
          (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
        content = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Order Calendar//EN\nCALSCALE:GREGORIAN\n';
        ordersToExport.forEach((o, idx) => {
          const evDate = (orderDateField === 'fulfil' && o.fulfil_date) ? o.fulfil_date : o.date;
          const dateStr = fmtDate(evDate).replace(/-/g, '');
          if (!dateStr) return;
          const summary = `${o.order_id ? o.order_id + ' — ' : ''}£${Math.abs(o.amount || 0).toFixed(2)}${o.platform ? ' (' + (PLATFORM_LABELS[o.platform] || o.platform) + ')' : ''}`;
          const desc = [
            `Amount: £${Math.abs(o.amount || 0).toFixed(2)}`,
            o.customer ? `Customer: ${o.customer}` : '',
            o.product  ? `Product: ${o.product}`   : '',
            o.status   ? `Status: ${o.status}`     : '',
            o.platform ? `Platform: ${PLATFORM_LABELS[o.platform] || o.platform}` : '',
            o.channel  ? `Channel: ${o.channel}`   : '',
          ].filter(Boolean).join('\n');
          content += 'BEGIN:VEVENT\n';
          content += `UID:order-${idx}@order-calendar\n`;
          content += `DTSTAMP:${dateStr}T120000Z\n`;
          content += `DTSTART:${dateStr}\n`;
          content += `SUMMARY:${escapeIcsText(summary)}\n`;
          content += `DESCRIPTION:${escapeIcsText(desc)}\n`;
          content += 'END:VEVENT\n';
        });
        content += 'END:VCALENDAR';
        mimeType = 'text/calendar';
        extension = 'ics';
        break;
      }

      case 'json': {
        const jsonData = ordersToExport.map(o => ({
          order_id:    o.order_id || null,
          order_date:  fmtDate(o.order_date || o.date) || null,
          fulfil_date: o.fulfil_date ? fmtDate(o.fulfil_date) : null,
          customer:    o.customer || null,
          product:     o.product || null,
          amount:      o.amount ?? null,
          status:      o.status || null,
          platform:    o.platform || null,
          channel:     o.channel || null,
          custom:      o.custom || {},
          sourceFile:  o.sourceFile || null,
        }));
        const revenue = ordersToExport.reduce((s, o) => s + (o.amount || 0), 0);
        content = JSON.stringify({
          exportDate:   new Date().toISOString(),
          totalOrders:  jsonData.length,
          totalRevenue: Number(revenue.toFixed(2)),
          loadedFiles:  loadedFiles.filter(f => !hiddenFiles.includes(f)),
          orders:       jsonData,
        }, null, 2);
        mimeType = 'application/json';
        extension = 'json';
        break;
      }

      case 'csv': {
        const sanitizeCsvText = (val) => {
          const str = String(val ?? '').replace(/"/g, '""');
          if (/^[=+\-@\t\r]/.test(str)) return `"\t${str}"`;
          return `"${str}"`;
        };
        const headers = ['Order ID', 'Order Date', 'Fulfil Date', 'Customer', 'Product', 'Amount', 'Status', 'Platform', 'Channel', ...customKeys, 'Source File'];
        const rows = ordersToExport.map(o => [
          sanitizeCsvText(o.order_id),
          fmtDate(o.order_date || o.date),
          o.fulfil_date ? fmtDate(o.fulfil_date) : '',
          sanitizeCsvText(o.customer),
          sanitizeCsvText(o.product),
          (o.amount ?? 0).toFixed(2),
          sanitizeCsvText(o.status),
          sanitizeCsvText(PLATFORM_LABELS[o.platform] || o.platform),
          sanitizeCsvText(o.channel),
          ...customKeys.map(k => sanitizeCsvText(o.custom?.[k])),
          sanitizeCsvText(o.sourceFile),
        ]);
        content = headers.map(h => `"${h}"`).join(',') + '\n' + rows.map(r => r.join(',')).join('\n');
        mimeType = 'text/csv';
        extension = 'csv';
        break;
      }

      case 'xlsx': {
        await new Promise((resolve, reject) => {
          if (window.XLSX) { resolve(); return; }
          const script = document.createElement('script');
          script.id = 'sheetjs-script';
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
          script.integrity = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
          script.crossOrigin = 'anonymous';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        const XLSXLib = window.XLSX;
        const wb = XLSXLib.utils.book_new();

        const headers = ['Order ID', 'Order Date', 'Fulfil Date', 'Customer', 'Product', 'Amount', 'Status', 'Platform', 'Channel', ...customKeys, 'Source File'];
        const aoa = [headers];
        ordersToExport.forEach(o => {
          aoa.push([
            o.order_id || '',
            fmtDate(o.order_date || o.date),
            o.fulfil_date ? fmtDate(o.fulfil_date) : '',
            o.customer || '',
            o.product || '',
            Number((o.amount ?? 0).toFixed(2)),
            o.status || '',
            PLATFORM_LABELS[o.platform] || o.platform || '',
            o.channel || '',
            ...customKeys.map(k => o.custom?.[k] ?? ''),
            o.sourceFile || '',
          ]);
        });
        const ordersWs = XLSXLib.utils.aoa_to_sheet(aoa);
        ordersWs['!cols'] = headers.map((h, i) => ({ wch: i === 4 ? 28 : 16 }));
        XLSXLib.utils.book_append_sheet(wb, ordersWs, 'Orders');

        // Summary sheet grouped by platform
        const byPlatform = {};
        ordersToExport.forEach(o => {
          const p = PLATFORM_LABELS[o.platform] || o.platform || 'Other';
          if (!byPlatform[p]) byPlatform[p] = { count: 0, revenue: 0 };
          byPlatform[p].count += 1;
          byPlatform[p].revenue += (o.amount || 0);
        });
        const summaryRows = [['Platform', 'Orders', 'Revenue', 'AOV']];
        Object.entries(byPlatform).forEach(([p, v]) => {
          summaryRows.push([p, v.count, Number(v.revenue.toFixed(2)), Number((v.revenue / v.count).toFixed(2))]);
        });
        const totalRev = ordersToExport.reduce((s, o) => s + (o.amount || 0), 0);
        summaryRows.push(['TOTAL', ordersToExport.length, Number(totalRev.toFixed(2)), Number((totalRev / ordersToExport.length).toFixed(2))]);
        const summaryWs = XLSXLib.utils.aoa_to_sheet(summaryRows);
        summaryWs['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
        XLSXLib.utils.book_append_sheet(wb, summaryWs, 'Summary');
        wb.SheetNames = ['Summary', ...wb.SheetNames.filter(s => s !== 'Summary')];

        const wbOut = XLSXLib.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob  = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url   = URL.createObjectURL(blob);
        const link  = document.createElement('a');
        link.href = url;
        link.download = `${baseFilename}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
        setShowExportModal(false);
        return;
      }

      case 'pdf': {
        const htmlView = exportConfig.htmlView || 'heatmap';
        const imgFmt   = exportConfig.imageFormat || 'jpg';
        const prevViewMode = viewMode;
        flushSync(() => setViewMode(htmlView));
        await exportToImage(imgFmt, 'orders');
        setViewMode(prevViewMode);
        setShowExportModal(false);
        return;
      }

      default:
        alert('Unknown export format');
        return;
    }

    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseFilename}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
    setShowExportModal(false);
  };

  // Export transactions in multiple formats
  const exportTransactions = async () => {
    // Ecommerce mode exports orders, not bank transactions
    if (dataMode === 'ecommerce') {
      await exportOrders();
      return;
    }
    let transactionsToExport = [];
    
    // Get historic transactions - always respect loaded files, optionally apply filters
    if (exportConfig.includeHistoric) {
      // Always filter by loaded files first (what you see is what you export)
      let historic = transactions.filter(t => loadedFiles.includes(t.sourceFile));
      
      // Then apply additional filters if enabled
      if (exportConfig.applyFilters && hasActiveFilters()) {
        historic = getFilteredTransactions();
      }
      
      transactionsToExport = [...transactionsToExport, ...historic];
    }
    
    // Get predicted transactions
    if (exportConfig.includePredicted && showPredictions) {
      transactionsToExport = [...transactionsToExport, ...predictedTransactions];
    }
    
    // Sort all transactions by date ascending, regardless of source file
    transactionsToExport.sort((a, b) => a.date - b.date);

    if (transactionsToExport.length === 0) {
      alert(`No ${dataMode === 'ecommerce' ? 'orders' : 'transactions'} to export. Please select at least one option.`);
      return;
    }

    let content, mimeType, extension;
    const baseFilename = `${dataMode === 'ecommerce' ? 'orders' : 'transactions'}_${exportConfig.includeHistoric ? 'historic' : ''}${exportConfig.includeHistoric && exportConfig.includePredicted ? '_and_' : ''}${exportConfig.includePredicted ? 'predicted' : ''}_${new Date().toISOString().split('T')[0]}`;

    switch (exportConfig.format) {
      case 'ics': {
        // ICS Calendar Format
        // RFC 5545: escape backslash, semicolons, commas, and newlines in text properties
        const escapeIcsText = (str) =>
          (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

        content = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Transaction Calendar//EN\nCALSCALE:GREGORIAN\n';

        transactionsToExport.forEach((t, idx) => {
          const dateStr = t.date.toISOString().split('T')[0].replace(/-/g, '');
          const amountPrefix = t.isPredicted && t.isVariableAmount ? '~' : '';
          const rawSummary = `${t.description} - ${amountPrefix}£${Math.abs(t.amount).toFixed(2)}`;
          const rawDescription = `Amount: ${t.amount >= 0 ? '+' : '-'}${amountPrefix}£${Math.abs(t.amount).toFixed(2)}\nCategory: ${t.category || 'N/A'}\nType: ${t.type || 'N/A'}${t.isPredicted ? '\n[PREDICTED - ' + (t.confidence || '').toUpperCase() + ']' : ''}${t.isVariableAmount ? '\n[Variable Amount: £' + t.minAmount.toFixed(2) + ' - £' + t.maxAmount.toFixed(2) + ']' : ''}`;

          content += `BEGIN:VEVENT\n`;
          content += `UID:transaction-${idx}@calendar\n`;
          content += `DTSTAMP:${dateStr}T120000Z\n`;
          content += `DTSTART:${dateStr}\n`;
          content += `SUMMARY:${escapeIcsText(rawSummary)}\n`;
          content += `DESCRIPTION:${escapeIcsText(rawDescription)}\n`;
          content += `END:VEVENT\n`;
        });

        content += 'END:VCALENDAR';
        mimeType = 'text/calendar';
        extension = 'ics';
        break;
      }

      case 'csv': {
        // CSV Format
        // Sanitize text fields to prevent formula injection in spreadsheet apps
        const sanitizeCsvText = (val) => {
          const str = (val || '').replace(/"/g, '""');
          // Prefix with a tab if the value starts with a formula trigger character
          if (/^[=+\-@\t\r]/.test(str)) return `"\t${str}"`;
          return `"${str}"`;
        };
        const csvHeaders = ['Date', 'Time', 'Description', 'Amount', 'Type', 'Category', 'Reference', 'Source File', 'Is Predicted', 'Confidence'];
        const csvRows = transactionsToExport.map(t => [
          t.date.toISOString().split('T')[0],
          t.time || '',
          sanitizeCsvText(t.description),
          t.amount.toFixed(2),
          sanitizeCsvText(t.type),
          sanitizeCsvText(t.category),
          sanitizeCsvText(t.reference),
          sanitizeCsvText(t.sourceFile),
          t.isPredicted ? 'Yes' : 'No',
          t.isPredicted ? (t.confidence || 'N/A') : ''
        ]);

        content = csvHeaders.join(',') + '\n' + csvRows.map(row => row.join(',')).join('\n');
        mimeType = 'text/csv';
        extension = 'csv';
        break;
      }

      case 'json': {
        // JSON Format
        const jsonData = transactionsToExport.map(t => ({
          date: t.date.toISOString().split('T')[0],
          time: t.time || null,
          description: t.description,
          amount: t.amount,
          type: t.type || null,
          category: t.category || null,
          reference: t.reference || null,
          sourceFile: t.sourceFile || null,
          isPredicted: t.isPredicted || false,
          confidence: t.isPredicted ? (t.confidence || null) : null,
          isVariableAmount: t.isVariableAmount || false,
          minAmount: t.minAmount || null,
          maxAmount: t.maxAmount || null
        }));

        content = JSON.stringify({
          exportDate: new Date().toISOString(),
          totalTransactions: jsonData.length,
          historicCount: exportConfig.includeHistoric ? transactionsToExport.filter(t => !t.isPredicted).length : 0,
          predictedCount: exportConfig.includePredicted && showPredictions ? transactionsToExport.filter(t => t.isPredicted).length : 0,
          loadedFiles: loadedFiles,
          transactions: jsonData
        }, null, 2);
        mimeType = 'application/json';
        extension = 'json';
        break;
      }

      case 'xlsx': {
        // Load SheetJS from CDN with SRI integrity check
        await new Promise((resolve, reject) => {
          if (window.XLSX) { resolve(); return; }
          const script = document.createElement('script');
          script.id = 'sheetjs-script';
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
          script.integrity = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
          script.crossOrigin = 'anonymous';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });

        const XLSXLib = window.XLSX;
        const wb = XLSXLib.utils.book_new();

        // ── Helper: encode column letter (0-indexed) ──────────────────────
        const col = (n) => String.fromCharCode(65 + n);

        // ── Colour palette ────────────────────────────────────────────────
        const INDIGO     = '4338CA'; // header bg
        const WHITE      = 'FFFFFF';
        const INCOME_BG  = 'DCFCE7'; // green-100
        const INCOME_FG  = '166534'; // green-800
        const EXPENSE_BG = 'FEE2E2'; // red-100
        const EXPENSE_FG = '991B1B'; // red-800
        const PREDICT_BG = 'EDE9FE'; // violet-100
        const PREDICT_FG = '5B21B6'; // violet-800
        const DAY_HDR_BG = 'EEF2FF'; // indigo-50
        const NEUTRAL_BG = 'F9FAFB'; // gray-50
        const BORDER_CLR = 'C7D2FE'; // indigo-200

        const cellStyle = (bg, fg, bold = false, italic = false, wrap = false, halign = 'left') => ({
          font:      { name: 'Arial', sz: 9, bold, italic, color: { rgb: fg || '111827' } },
          fill:      bg ? { patternType: 'solid', fgColor: { rgb: bg } } : undefined,
          alignment: { wrapText: wrap, vertical: 'top', horizontal: halign },
          border: {
            top:    { style: 'thin', color: { rgb: BORDER_CLR } },
            bottom: { style: 'thin', color: { rgb: BORDER_CLR } },
            left:   { style: 'thin', color: { rgb: BORDER_CLR } },
            right:  { style: 'thin', color: { rgb: BORDER_CLR } }
          }
        });

        // ── Group transactions by year+month ──────────────────────────────
        const byMonth = {};
        transactionsToExport.forEach(t => {
          const key = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`;
          if (!byMonth[key]) byMonth[key] = [];
          byMonth[key].push(t);
        });

        const monthKeys = Object.keys(byMonth).sort();

        // ── Build one sheet per month ─────────────────────────────────────
        monthKeys.forEach(key => {
          const [yr, mo] = key.split('-').map(Number);
          const monthTxns = byMonth[key];
          const monthDate = new Date(yr, mo - 1, 1);
          const monthLabel = monthDate.toLocaleString('default', { month: 'long', year: 'numeric' });
          const daysInMonth = new Date(yr, mo, 0).getDate();
          const firstDow = new Date(yr, mo - 1, 1).getDay(); // 0=Sun

          // Per-day lookup
          const dayMap = {};
          monthTxns.forEach(t => {
            const d = t.date.getDate();
            if (!dayMap[d]) dayMap[d] = [];
            dayMap[d].push(t);
          });

          // Month totals
          const mIncome  = monthTxns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
          const mExpense = monthTxns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
          const mNet     = mIncome - mExpense;

          // ── Sheet data array ──────────────────────────────────────────
          // Col layout: 7 day columns (A–G), each 18 chars wide
          // Row 1  : Month title (merged A1:G1)
          // Row 2  : Month summary income / expenses / net
          // Row 3  : Day-of-week headers
          // Row 4+ : Calendar rows (each day cell = up to 8 rows tall)

          const ws = {};
          const merges = [];
          const ROW_TITLE   = 1; // 1-indexed for xlsx
          const ROW_SUMMARY = 2;
          const ROW_DOW     = 3;
          const ROWS_PER_DAY = 8; // number of Excel rows per calendar week-row
          const DAY_COLS = 7;

          const setCell = (r, c, v, style) => {
            const addr = `${col(c)}${r}`;
            ws[addr] = { v, t: typeof v === 'number' ? 'n' : 's', s: style };
          };

          // ── Row 1: Title ──────────────────────────────────────────────
          setCell(ROW_TITLE, 0, `Transaction Cal — ${monthLabel}`, {
            font:      { name: 'Arial', sz: 14, bold: true, color: { rgb: WHITE } },
            fill:      { patternType: 'solid', fgColor: { rgb: INDIGO } },
            alignment: { horizontal: 'center', vertical: 'center' },
            border:    {}
          });
          for (let c2 = 1; c2 < DAY_COLS; c2++) {
            setCell(ROW_TITLE, c2, '', {
              fill: { patternType: 'solid', fgColor: { rgb: INDIGO } }, border: {}
            });
          }
          merges.push({ s: { r: ROW_TITLE - 1, c: 0 }, e: { r: ROW_TITLE - 1, c: DAY_COLS - 1 } });

          // ── Row 2: Summary ────────────────────────────────────────────
          const summaryStyle = (fg) => ({
            font:      { name: 'Arial', sz: 9, bold: true, color: { rgb: fg } },
            fill:      { patternType: 'solid', fgColor: { rgb: DAY_HDR_BG } },
            alignment: { horizontal: 'center', vertical: 'center' },
            border:    { bottom: { style: 'medium', color: { rgb: INDIGO } } }
          });
          setCell(ROW_SUMMARY, 0, `Income: +£${mIncome.toFixed(2)}`,  summaryStyle('166534'));
          setCell(ROW_SUMMARY, 1, '',  { fill: { patternType: 'solid', fgColor: { rgb: DAY_HDR_BG } }, border: {} });
          setCell(ROW_SUMMARY, 2, `Expenses: -£${mExpense.toFixed(2)}`, summaryStyle('991B1B'));
          setCell(ROW_SUMMARY, 3, '',  { fill: { patternType: 'solid', fgColor: { rgb: DAY_HDR_BG } }, border: {} });
          setCell(ROW_SUMMARY, 4, '',  { fill: { patternType: 'solid', fgColor: { rgb: DAY_HDR_BG } }, border: {} });
          setCell(ROW_SUMMARY, 5, '',  { fill: { patternType: 'solid', fgColor: { rgb: DAY_HDR_BG } }, border: {} });
          setCell(ROW_SUMMARY, 6, `Net: ${mNet >= 0 ? '+' : ''}£${mNet.toFixed(2)}`, summaryStyle(mNet >= 0 ? '166534' : '991B1B'));
          merges.push({ s: { r: ROW_SUMMARY - 1, c: 0 }, e: { r: ROW_SUMMARY - 1, c: 1 } });
          merges.push({ s: { r: ROW_SUMMARY - 1, c: 2 }, e: { r: ROW_SUMMARY - 1, c: 4 } });
          merges.push({ s: { r: ROW_SUMMARY - 1, c: 5 }, e: { r: ROW_SUMMARY - 1, c: 6 } });

          // ── Row 3: Day headers ────────────────────────────────────────
          ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d, i) => {
            setCell(ROW_DOW, i, d, {
              font:      { name: 'Arial', sz: 10, bold: true, color: { rgb: WHITE } },
              fill:      { patternType: 'solid', fgColor: { rgb: INDIGO } },
              alignment: { horizontal: 'center', vertical: 'center' },
              border:    {}
            });
          });

          // ── Calendar day cells ────────────────────────────────────────
          // Build a 6-week grid (42 slots)
          const grid = new Array(42).fill(null);
          for (let d = 1; d <= daysInMonth; d++) grid[firstDow + d - 1] = d;

          for (let slot = 0; slot < 42; slot++) {
            const weekRow  = Math.floor(slot / 7);        // 0-5
            const dayOfWk  = slot % 7;                    // 0-6
            const excelRow = ROW_DOW + 1 + weekRow * ROWS_PER_DAY; // first excel row of this week-row
            const dayNum   = grid[slot];

            if (dayNum === null) {
              // Empty cell (before month start / after month end)
              for (let r2 = 0; r2 < ROWS_PER_DAY; r2++) {
                setCell(excelRow + r2, dayOfWk, '', {
                  fill:  { patternType: 'solid', fgColor: { rgb: 'F3F4F6' } },
                  border: {
                    top:    { style: 'thin', color: { rgb: BORDER_CLR } },
                    bottom: { style: 'thin', color: { rgb: BORDER_CLR } },
                    left:   { style: 'thin', color: { rgb: BORDER_CLR } },
                    right:  { style: 'thin', color: { rgb: BORDER_CLR } }
                  }
                });
              }
              continue;
            }

            const txns = dayMap[dayNum] || [];
            const dayTotal = txns.reduce((s, t) => s + t.amount, 0);

            // Row 0: day number header
            const isWeekend = dayOfWk === 0 || dayOfWk === 6;
            setCell(excelRow, dayOfWk, dayNum, {
              font:      { name: 'Arial', sz: 9, bold: true, color: { rgb: isWeekend ? '6366F1' : '1F2937' } },
              fill:      { patternType: 'solid', fgColor: { rgb: DAY_HDR_BG } },
              alignment: { horizontal: 'right', vertical: 'center' },
              border: {
                top:    { style: 'medium', color: { rgb: INDIGO } },
                bottom: { style: 'thin',   color: { rgb: BORDER_CLR } },
                left:   { style: 'thin',   color: { rgb: BORDER_CLR } },
                right:  { style: 'thin',   color: { rgb: BORDER_CLR } }
              }
            });

            // Rows 1–6: individual transactions (up to 5, last row for totals)
            const MAX_TX = 5;
            for (let ti = 0; ti < MAX_TX; ti++) {
              const t = txns[ti];
              const r = excelRow + 1 + ti;
              if (t) {
                const isPred    = t.isPredicted;
                const isIncome  = t.amount > 0;
                const bg  = isPred ? PREDICT_BG : isIncome ? INCOME_BG  : EXPENSE_BG;
                const fg  = isPred ? PREDICT_FG : isIncome ? INCOME_FG  : EXPENSE_FG;
                const prefix = isPred ? '⟳ ' : (isIncome ? '+' : '');
                const label = `${prefix}£${Math.abs(t.amount).toFixed(2)} ${t.description.substring(0, 22)}`;
                setCell(r, dayOfWk, label, cellStyle(bg, fg, false, isPred, true));
              } else {
                setCell(r, dayOfWk, '', cellStyle(null, null));
              }
            }

            // Last row: day total
            const totalRow = excelRow + ROWS_PER_DAY - 1;
            if (txns.length > 0) {
              const totalLabel = `Net: ${dayTotal >= 0 ? '+' : ''}£${dayTotal.toFixed(2)}`;
              setCell(totalRow, dayOfWk, totalLabel, {
                font:      { name: 'Arial', sz: 8, bold: true, color: { rgb: dayTotal >= 0 ? INCOME_FG : EXPENSE_FG } },
                fill:      { patternType: 'solid', fgColor: { rgb: dayTotal >= 0 ? 'BBF7D0' : 'FECACA' } },
                alignment: { horizontal: 'right', vertical: 'center' },
                border: {
                  top:    { style: 'thin',   color: { rgb: BORDER_CLR } },
                  bottom: { style: 'medium', color: { rgb: INDIGO } },
                  left:   { style: 'thin',   color: { rgb: BORDER_CLR } },
                  right:  { style: 'thin',   color: { rgb: BORDER_CLR } }
                }
              });
            } else {
              setCell(totalRow, dayOfWk, '', cellStyle(NEUTRAL_BG, null));
            }
          }

          // ── Sheet range ───────────────────────────────────────────────
          const totalWeekRows = Math.ceil((firstDow + daysInMonth) / 7);
          const lastExcelRow  = ROW_DOW + totalWeekRows * ROWS_PER_DAY;
          ws['!ref'] = `A1:${col(DAY_COLS - 1)}${lastExcelRow}`;
          ws['!merges'] = merges;

          // ── Column widths & row heights ───────────────────────────────
          ws['!cols'] = Array(7).fill({ wch: 20 });
          const rowHeights = [];
          rowHeights[ROW_TITLE   - 1] = { hpt: 28 };
          rowHeights[ROW_SUMMARY - 1] = { hpt: 18 };
          rowHeights[ROW_DOW     - 1] = { hpt: 18 };
          for (let wk = 0; wk < totalWeekRows; wk++) {
            const base = ROW_DOW + wk * ROWS_PER_DAY;
            rowHeights[base]     = { hpt: 16 }; // day number row
            for (let r2 = 1; r2 < ROWS_PER_DAY - 1; r2++) {
              rowHeights[base + r2] = { hpt: 14 };
            }
            rowHeights[base + ROWS_PER_DAY - 1] = { hpt: 13 }; // total row
          }
          ws['!rows'] = rowHeights;

          // Sheet name: "Jan 2024" style (max 31 chars)
          const sheetName = monthDate.toLocaleString('default', { month: 'short', year: 'numeric' }).replace('/', '-');
          XLSXLib.utils.book_append_sheet(wb, ws, sheetName);
        });

        // ── Summary sheet ─────────────────────────────────────────────────
        const summaryWs = {};
        const summaryRows = [
          ['Month', 'Income', 'Expenses', 'Net', 'Transactions']
        ];
        monthKeys.forEach(key => {
          const txns    = byMonth[key];
          const [yr, mo] = key.split('-').map(Number);
          const label   = new Date(yr, mo - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
          const income  = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
          const expense = txns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
          summaryRows.push([label, income, expense, income - expense, txns.length]);
        });
        // Totals row
        const allIncome  = transactionsToExport.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
        const allExpense = transactionsToExport.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
        summaryRows.push(['TOTAL', allIncome, allExpense, allIncome - allExpense, transactionsToExport.length]);

        XLSXLib.utils.sheet_add_aoa(summaryWs, summaryRows, { origin: 'A1' });
        summaryWs['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
        XLSXLib.utils.book_append_sheet(wb, summaryWs, 'Summary');

        // Move Summary to front
        wb.SheetNames = ['Summary', ...wb.SheetNames.filter(s => s !== 'Summary')];

        // ── Write & download ──────────────────────────────────────────────
        const wbOut = XLSXLib.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
        const blob  = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url   = URL.createObjectURL(blob);
        const link  = document.createElement('a');
        link.href     = url;
        link.download = `${baseFilename}_calendar.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
        setShowExportModal(false);
        return;
      }

      case 'pdf': {
        // Switch to chosen view synchronously so #export-card renders
        // the right content before html-to-image captures it
        const htmlView = exportConfig.htmlView || 'heatmap';
        const imgFmt   = exportConfig.imageFormat || 'jpg';
        const prevViewMode = viewMode;
        flushSync(() => setViewMode(htmlView));

        await exportToImage(imgFmt, 'transactions');

        setViewMode(prevViewMode);
        setShowExportModal(false);
        return;
      }

      default:
        alert('Unknown export format');
        return;
    }
    
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseFilename}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
    
    setShowExportModal(false);
  };

  // Confidence threshold for auto-detection (0.0 to 1.0)
  const AUTO_DETECTION_CONFIDENCE_THRESHOLD = 0.6;

  const processFileUpload = (file, mode, forceColumnMapper = false) => {
    if (!file) return;

    console.log('[processFileUpload] Starting:', file.name, 'mode:', mode, 'forceColumnMapper:', forceColumnMapper);

    // Store the file object (in case it's not already stored)
    setUploadedFiles(prev => ({ ...prev, [file.name]: file }));

    // Only add to uploadedFileName if it's not already there
    setUploadedFileName(prev => {
      if (prev.includes(file.name)) {
        return prev; // Already in list, don't add again
      }
      // Add to list
      if (mode === 'merge') {
        return [...prev, file.name];
      } else {
        return [file.name];
      }
    });

    // Back up raw CSV to Supabase Storage (fire-and-forget)
    uploadFileToStorage(file, userId);

    // Read file content for the new parser
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      
      try {
        // Use the new bank-agnostic parser
        const parseResult = parseBankCSV(content, file.name);
        const parsed = parseResult.transactions;
        const confidence = parseResult.format.confidence || (parseResult.format.score / 10); // Estimate confidence from score
        
        console.log('[processFileUpload] Detected format:', parseResult.format.format.name);
        console.log('[processFileUpload] Confidence:', confidence);
        console.log('[processFileUpload] Parsed', parsed.length, 'transactions from', file.name);
        console.log('[processFileUpload] Stats:', parseResult.stats);

        // Store detection result for this file
        setFileDetectionResults(prev => ({
          ...prev,
          [file.name]: {
            ...parseResult.format,
            confidence: confidence
          }
        }));
        
        // Check if we need manual column mapping
        if (forceColumnMapper || parsed.length === 0 || confidence < AUTO_DETECTION_CONFIDENCE_THRESHOLD) {
          console.log('[processFileUpload] Low confidence or no transactions - opening Column Mapper');
          setColumnMapperFile(file);
          setColumnMapperMode(mode);
          setShowColumnMapper(true);
          return;
        }

        // High confidence - proceed with auto-detected transactions
        applyParsedTransactions(parsed, file.name, mode);
      } catch (err) {
        console.error('[processFileUpload] Error:', err);
        // On error, offer column mapper as fallback
        setColumnMapperFile(file);
        setColumnMapperMode(mode);
        setShowColumnMapper(true);
      }
    };
    
    reader.onerror = () => {
      setError('Failed to read file');
    };
    
    reader.readAsText(file);
  };

  // Handle completion from Column Mapper
  const handleColumnMapperComplete = (mappedTransactions, metadata) => {
    console.log('[handleColumnMapperComplete] Received', mappedTransactions.length, 'transactions');
    console.log('[handleColumnMapperComplete] Metadata:', metadata);

    // Use sourceFile from metadata — avoids stale columnMapperFile closure
    // when the queue fires the next file before this callback reads state.
    const fileName = metadata?.sourceFile || columnMapperFile?.name || 'Unknown';
    const mode = columnMapperMode;
    console.log('[handleColumnMapperComplete] fileName:', fileName, 'mode:', mode, 'txCount:', mappedTransactions.length, 'metadata.sourceFile:', metadata?.sourceFile, 'columnMapperFile:', columnMapperFile?.name);

    // Ensure file name is registered
    setUploadedFileName(prev =>
      prev.includes(fileName) ? prev : [...prev, fileName]
    );

    // ── Ecommerce branch ──────────────────────────────────────────────────────
    if (metadata?.mapperMode === 'ecommerce') {
      // Orders are already in the correct shape from ColumnMapper:
      // { order_id, order_date, fulfil_date, customer, product, amount, status, platform, channel, custom, sourceFile }
      // We need to add a `date` field for compatibility with calendar rendering
      const enriched = mappedTransactions.map(o => ({
        ...o,
        date: o.order_date || o.date, // Ensure `date` field exists for calendar
      }));
      const mode = columnMapperMode;
      setUploadedFileName(prev => prev.includes(fileName) ? prev : [...prev, fileName]);
      setLoadedFiles(prev => mode === 'merge' ? [...new Set([...prev, fileName])] : [fileName]);
      setOrders(prev => {
        if (mode === 'replace') return enriched;
        const combined = [...prev, ...enriched];
        // Deduplicate by order_id + sourceFile, or by date + amount + sourceFile if no order_id
        return combined.filter((o, i, arr) =>
          arr.findIndex(x =>
            (o.order_id && x.order_id === o.order_id && x.sourceFile === o.sourceFile) ||
            (!o.order_id && x.date.getTime() === o.date.getTime() && x.amount === o.amount && x.sourceFile === o.sourceFile)
          ) === i
        );
      });
      setDataMode('ecommerce');
      localStorage.setItem('data_mode', 'ecommerce');
      if (metadata?.filterCols?.length > 0) {
        setEcomFilterCols(prev => [...new Set([...prev, ...metadata.filterCols])]);
      }
      if (enriched.length > 0) {
        const last = enriched.reduce((a, b) => a.date > b.date ? a : b);
        setCurrentDate(new Date(last.date.getFullYear(), last.date.getMonth(), 1));
      }
      setError(null);
      setShowColumnMapper(false);
      setColumnMapperFile(null);
      setUploadQueue(prev => {
        if (prev.length === 0) return prev;
        const [next, ...rest] = prev;
        setTimeout(() => openColumnMapperForFile(next.file, next.mode), 50);
        return rest;
      });
      return;
    }

    applyParsedTransactions(mappedTransactions, fileName, mode);
    setDataMode('bank');
    localStorage.setItem('data_mode', 'bank');

    // Close the column mapper and clear file ref BEFORE opening next
    setShowColumnMapper(false);
    setColumnMapperFile(null);

    // Process next file in queue if any
    setUploadQueue(prev => {
      if (prev.length === 0) return prev;
      const [next, ...rest] = prev;
      // Snapshot next before async — avoids closure staleness
      const nextFile = next.file;
      const nextMode = next.mode;
      setTimeout(() => openColumnMapperForFile(nextFile, nextMode), 50);
      return rest;
    });
  };

  // Handle cancellation of Column Mapper
  const handleColumnMapperCancel = () => {
    setShowColumnMapper(false);

    // Remove the file from uploaded files if it was never processed
    if (columnMapperFile) {
      const fileName = columnMapperFile.name;
      const hasTransactions = transactions.some(t => t.sourceFile === fileName);

      if (!hasTransactions) {
        setUploadedFileName(prev => prev.filter(f => f !== fileName));
        setUploadedFiles(prev => {
          const newFiles = { ...prev };
          delete newFiles[fileName];
          return newFiles;
        });
      }
    }

    // Clear pending mode if the user cancelled before any data was imported
    // so the mode-selector screen shows again (not a blank calendar)
    if (!dataMode) pendingModeRef.current = null;

    setColumnMapperFile(null);

    // Process next queued file
    setUploadQueue(prev => {
      if (prev.length === 0) return prev;
      const [next, ...rest] = prev;
      setTimeout(() => openColumnMapperForFile(next.file, next.mode), 50);
      return rest;
    });
  };

  // Apply parsed transactions to state (shared by auto-detection and column mapper)
  const applyParsedTransactions = (parsed, fileName, mode) => {
    if (parsed.length === 0) {
      console.log('[applyParsedTransactions] WARNING: 0 transactions!');
      setError(`No transactions found in ${fileName}. Please try using the Column Mapper.`);
      return;
    }

    console.log('[applyParsedTransactions] Applying', parsed.length, 'transactions from', fileName, 'mode:', mode);

    // Update loaded files list
    setLoadedFiles(prev => {
      if (mode === 'merge') {
        return [...new Set([...prev, fileName])];
      } else {
        return [fileName];
      }
    });

    // Apply mode: replace or merge
    if (mode === 'merge') {
      // Combine with existing transactions using functional updater to avoid stale closure
      setTransactions(prev => {
        const combined = [...prev, ...parsed];
        // Remove duplicates based on date, description, amount AND sourceFile
        // (same transaction in different files is not a duplicate)
        return combined.filter((t, index, self) =>
          index === self.findIndex((other) => (
            other.date.getTime() === t.date.getTime() &&
            other.description === t.description &&
            other.amount === t.amount &&
            other.sourceFile === t.sourceFile
          ))
        );
      });

      // Merge filter options using functional updater to avoid stale closure
      setAvailableFilterOptions(prev => ({
        type: [...new Set([...prev.type || [], ...parsed.map(t => t.type).filter(v => v)])],
        category: [...new Set([...prev.category || [], ...parsed.map(t => t.category).filter(v => v)])],
        description: [...new Set([...prev.description || [], ...parsed.map(t => t.description).filter(v => v)])],
        reference: [...new Set([...prev.reference || [], ...parsed.map(t => t.reference).filter(v => v)])]
      }));

      // Navigate to last transaction month across all loaded data so the calendar isn't blank
      setTransactions(prev => {
        const allLoaded = [...prev, ...parsed];
        if (allLoaded.length > 0) {
          const lastTransaction = allLoaded.reduce((latest, t) => t.date > latest.date ? t : latest);
          setCurrentDate(new Date(lastTransaction.date.getFullYear(), lastTransaction.date.getMonth(), 1));
        }
        return prev; // don't modify transactions here, just read them for navigation
      });
      setViewMode('calendar');
    } else {
      // Replace mode (default)
      setTransactions(parsed);
      
      const filterOptions = {
        type: [...new Set(parsed.map(t => t.type).filter(v => v))],
        category: [...new Set(parsed.map(t => t.category).filter(v => v))],
        description: [...new Set(parsed.map(t => t.description).filter(v => v))],
        reference: [...new Set(parsed.map(t => t.reference).filter(v => v))]
      };
      setAvailableFilterOptions(filterOptions);
      
      // Clear manual recurring when replacing
      setManualRecurring([]);
      
      // Set calendar to the last transaction's month
      if (parsed.length > 0) {
        const lastTransaction = parsed.reduce((latest, t) => 
          t.date > latest.date ? t : latest
        );
        setCurrentDate(new Date(lastTransaction.date.getFullYear(), lastTransaction.date.getMonth(), 1));
      }
    }

    setActiveFilters({});
    setAmountFilter({ type: 'all', value: '' });
    setError('');
    setShowUploadModal(false);
    setPendingFile(null);
  };

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    return { daysInMonth, startingDayOfWeek, year, month };
  };

  const getTransactionsForDate = (date) => {
    const actual = getFilteredTransactions().filter(t => 
      t.date.getDate() === date.getDate() &&
      t.date.getMonth() === date.getMonth() &&
      t.date.getFullYear() === date.getFullYear() &&
      !deletedTransactionIds.has(getTransactionId(t))
    );
    
    const predicted = showPredictions ? predictedTransactions.filter(t => 
      t.date.getDate() === date.getDate() &&
      t.date.getMonth() === date.getMonth() &&
      t.date.getFullYear() === date.getFullYear()
    ) : [];
    
    return [...actual, ...predicted];
  };

  // Helper to generate transaction ID (defined early for use in getTransactionsForDate)
  const getTransactionId = (t) => {
    return `${t.date.getTime()}_${t.description}_${t.amount}_${t.sourceFile || ''}`;
  };

  const getFilteredTransactions = () => {
    let filtered = transactions;

    // If no transactions loaded yet, return empty
    if (transactions.length === 0) {
      return [];
    }

    // Hide files that have been explicitly unchecked (opt-out model — all visible by default)
    if (hiddenFiles.length > 0) {
      filtered = filtered.filter(t => !hiddenFiles.includes(t.sourceFile));
    }

    if (amountFilter.type !== 'all' && amountFilter.value) {
      const amount = parseFloat(amountFilter.value);
      if (!isNaN(amount)) {
        if (amountFilter.type === 'less') {
          filtered = filtered.filter(t => Math.abs(t.amount) < amount);
        } else if (amountFilter.type === 'more') {
          filtered = filtered.filter(t => Math.abs(t.amount) > amount);
        } else if (amountFilter.type === 'lessEqual') {
          filtered = filtered.filter(t => Math.abs(t.amount) <= amount);
        } else if (amountFilter.type === 'moreEqual') {
          filtered = filtered.filter(t => Math.abs(t.amount) >= amount);
        }
      }
    }

    // Handle direction filter (income/expense) separately
    const directionFilter = activeFilters.direction;
    if (directionFilter?.length === 1) {
      if (directionFilter.includes('income')) {
        filtered = filtered.filter(t => t.amount > 0);
      } else if (directionFilter.includes('expense')) {
        filtered = filtered.filter(t => t.amount < 0);
      }
    }
    // If both are selected or neither, show all (no filtering needed)

    // Handle other filters (exclude direction from normal filter logic)
    const activeFilterKeys = Object.keys(activeFilters).filter(key =>
      key !== 'direction' && activeFilters[key]?.length > 0
    );
    
    if (activeFilterKeys.length > 0) {
      if (filterLogic === 'AND') {
        filtered = filtered.filter(t => {
          return activeFilterKeys.every(filterKey => {
            const filterValues = activeFilters[filterKey];
            return filterValues.includes(t[filterKey]);
          });
        });
      } else {
        filtered = filtered.filter(t => {
          return activeFilterKeys.some(filterKey => {
            const filterValues = activeFilters[filterKey];
            return filterValues.includes(t[filterKey]);
          });
        });
      }
    }
    
    return filtered;
  };

  const toggleFilter = (filterType, value) => {
    setActiveFilters(prev => {
      const currentFilters = prev[filterType] || [];
      const newFilters = currentFilters.includes(value)
        ? currentFilters.filter(v => v !== value)
        : [...currentFilters, value];
      
      return {
        ...prev,
        [filterType]: newFilters.length > 0 ? newFilters : undefined
      };
    });
  };

  const clearAllFilters = () => {
    setActiveFilters({});
    setHiddenFiles([]); // Un-hide all files
    setAmountFilter({ type: 'all', value: '' });
  };

  const hasActiveFilters = () => {
    const nonFileFiltersActive = Object.keys(activeFilters).some(
      key => activeFilters[key]?.length > 0
    );
    return nonFileFiltersActive || amountFilter.type !== 'all' || hiddenFiles.length > 0;
  };

  // Close filter menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showFilterMenu) {
        const filterMenu = document.getElementById('filter-menu');
        const filterButton = document.getElementById('filter-button');
        
        if (filterMenu && filterButton && 
            !filterMenu.contains(event.target) && 
            !filterButton.contains(event.target)) {
          setShowFilterMenu(false);
          setFilterSearchQuery(''); // Reset search when closing
        }
      }
    };

    if (showFilterMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFilterMenu]);

  // Reset transaction edit mode when selected date changes
  useEffect(() => {
    setIsTransactionEditMode(false);
    setSelectedTransactionIds(new Set());
  }, [selectedDate]);

  // Show file manager on first login if user has uploaded files but none loaded
  useEffect(() => {
    if (isLoggedIn && uploadedFileName.length > 0 && loadedFiles.length === 0) {
      setShowFileManager(true);
    }
  }, [isLoggedIn, uploadedFileName.length, loadedFiles.length]);

  // Transaction selection helpers
  const toggleTransactionSelection = (transactionId) => {
    setSelectedTransactionIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(transactionId)) {
        newSet.delete(transactionId);
      } else {
        newSet.add(transactionId);
      }
      return newSet;
    });
  };

  const selectAllDayTransactions = () => {
    const dayTransactions = getTransactionsForDate(selectedDate).filter(t => !t.isPredicted);
    if (selectedTransactionIds.size === dayTransactions.length) {
      setSelectedTransactionIds(new Set());
    } else {
      setSelectedTransactionIds(new Set(dayTransactions.map(t => getTransactionId(t))));
    }
  };

  const clearTransactionSelection = () => {
    setSelectedTransactionIds(new Set());
    setIsTransactionEditMode(false);
  };

  // Delete selected transactions (session only)
  const deleteSelectedTransactions = () => {
    setDeletedTransactionIds(prev => {
      const newSet = new Set(prev);
      selectedTransactionIds.forEach(id => newSet.add(id));
      return newSet;
    });
    setSelectedTransactionIds(new Set());
    setIsTransactionEditMode(false);
    setShowDeleteConfirmModal(false);
  };

  // Filter options based on search query
  const getFilteredOptions = (filterType) => {
    const options = availableFilterOptions[filterType] || [];
    if (!filterSearchQuery) return options;
    
    return options.filter(option => 
      option.toLowerCase().includes(filterSearchQuery.toLowerCase())
    );
  };

  const getDayTotal = (date) => {
    const dayTransactions = getTransactionsForDate(date);
    return dayTransactions.reduce((sum, t) => sum + t.amount, 0);
  };

  const getDayStats = (date) => {
    const dayTransactions = getTransactionsForDate(date);
    const income = dayTransactions.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const expenses = dayTransactions.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    return { income, expenses, net: income - expenses };
  };

  const getMonthStats = () => {
    const monthTransactions = getFilteredTransactions().filter(t =>
      t.date.getMonth() === currentDate.getMonth() &&
      t.date.getFullYear() === currentDate.getFullYear()
    );

    const income = monthTransactions.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const expenses = monthTransactions.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);

    return { income, expenses, net: income - expenses };
  };

  const getYearStats = () => {
    const yearTransactions = getFilteredTransactions().filter(t =>
      t.date.getFullYear() === currentDate.getFullYear()
    );

    const income = yearTransactions.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const expenses = yearTransactions.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);

    return { income, expenses, net: income - expenses };
  };

  // ── Ecommerce helper functions ─────────────────────────────────────────────

  // Platform colours for dots
  const PLATFORM_COLORS = {
    shopify: '#96BF48',
    tiktok:  '#111111',
    etsy:    '#F56400',
    woo:     '#7f54b3',
    other:   '#9ca3af',
  };
  const PLATFORM_LABELS = {
    shopify: 'Shopify', tiktok: 'TikTok Shop', etsy: 'Etsy', woo: 'WooCommerce', other: 'Other',
  };

  // Filtered orders (respects activePlatforms, activeStatus, sidebar activeFilters, and customFilters)
  const getFilteredOrders = () => {
    let filtered = orders.filter(o => loadedFiles.includes(o.sourceFile) && !hiddenFiles.includes(o.sourceFile));
    if (activePlatforms.size > 0) {
      filtered = filtered.filter(o => activePlatforms.has(o.platform));
    }
    if (activeStatus !== 'all') {
      filtered = filtered.filter(o => (o.status || '').toLowerCase() === activeStatus);
    }
    // Sidebar activeFilters — standard fields (status, platform, channel, customer)
    // plus custom column labels stored in o.custom
    const activeFilterKeys = Object.keys(activeFilters).filter(k => activeFilters[k]?.length > 0);
    activeFilterKeys.forEach(key => {
      const values = activeFilters[key];
      filtered = filtered.filter(o => {
        // standard fields live directly on the order
        if (key in o) return values.includes(String(o[key] ?? ''));
        // custom fields live in o.custom
        return values.includes(String(o.custom?.[key] ?? ''));
      });
    });
    return filtered;
  };

  // Orders for a specific calendar day (respects orderDateField toggle)
  const getOrdersForDay = (date) => {
    return getFilteredOrders().filter(o => {
      const d = (orderDateField === 'fulfil' && o.fulfil_date) ? o.fulfil_date : o.date;
      return d.getDate() === date.getDate() &&
             d.getMonth() === date.getMonth() &&
             d.getFullYear() === date.getFullYear();
    });
  };

  // Heatmap intensity based on order count
  const getOrderHeatmapIntensity = (count) => {
    if (count === 0) return 'bg-gray-100';
    if (count <= 2)  return 'bg-[oklch(93%_0.04_148.98)]';
    if (count <= 5)  return 'bg-[oklch(83%_0.07_148.98)]';
    if (count <= 10) return 'bg-[oklch(74%_0.11_148.98)]';
    if (count <= 20) return 'bg-[oklch(64%_0.13_148.98)]';
    return 'bg-[oklch(53%_0.15_148.98)]';
  };

  // Ecommerce stats for a period
  const getEcomStats = (orderList) => {
    const count = orderList.length;
    const revenue = orderList.reduce((s, o) => s + (o.amount || 0), 0);
    const aov = count > 0 ? revenue / count : 0;
    const fulfilled = orderList.filter(o => o.fulfil_date).length;
    const fulfilRate = count > 0 ? Math.round((fulfilled / count) * 100) : 0;
    return { count, revenue, aov, fulfilRate };
  };

  // Platforms present in the visible orders (loaded and not hidden in the sidebar)
  const getPresentPlatforms = () => {
    const all = orders.filter(o => loadedFiles.includes(o.sourceFile) && !hiddenFiles.includes(o.sourceFile));
    return [...new Set(all.map(o => o.platform))].filter(Boolean);
  };

  // Get custom filter options from loaded orders (only columns flagged as_filter)
  const getCustomFilterOptions = () => {
    if (ecomFilterCols.length === 0) return {};
    const all = orders.filter(o => loadedFiles.includes(o.sourceFile) && !hiddenFiles.includes(o.sourceFile));
    const filterOptions = {};

    all.forEach(order => {
      if (order.custom) {
        Object.entries(order.custom).forEach(([label, value]) => {
          if (!ecomFilterCols.includes(label)) return;
          if (!filterOptions[label]) filterOptions[label] = new Set();
          if (value !== undefined && value !== '') filterOptions[label].add(String(value));
        });
      }
    });

    const result = {};
    Object.entries(filterOptions).forEach(([label, valueSet]) => {
      if (valueSet.size > 0) result[label] = [...valueSet].sort();
    });
    return result;
  };

  // ──────────────────────────────────────────────────────────────────────────

  const getMonthTotal = (month, year) => {
    const monthTransactions = getFilteredTransactions().filter(t =>
      t.date.getMonth() === month &&
      t.date.getFullYear() === year
    );
    
    const monthPredicted = showPredictions ? predictedTransactions.filter(t =>
      t.date.getMonth() === month &&
      t.date.getFullYear() === year
    ) : [];
    
    const allTransactions = [...monthTransactions, ...monthPredicted];
    return allTransactions.reduce((sum, t) => sum + t.amount, 0);
  };

  const getHeatmapIntensity = (amount) => {
    if (amount === 0) return 'bg-gray-100';
    const absAmount = Math.abs(amount);
    if (absAmount < 50)  return amount > 0 ? 'bg-[oklch(93%_0.04_148.98)]'  : 'bg-[oklch(93%_0.03_27.518)]';
    if (absAmount < 100) return amount > 0 ? 'bg-[oklch(83%_0.07_148.98)]'  : 'bg-[oklch(83%_0.07_27.518)]';
    if (absAmount < 200) return amount > 0 ? 'bg-[oklch(74%_0.11_148.98)]'  : 'bg-[oklch(72%_0.13_27.518)]';
    if (absAmount < 500) return amount > 0 ? 'bg-[oklch(64%_0.13_148.98)]'  : 'bg-[oklch(62%_0.17_27.518)]';
    return amount > 0 ? 'bg-[oklch(53%_0.15_148.98)]' : 'bg-[oklch(50.5%_0.213_27.518)]';
  };

  // Returns a contrasting text-color class for the heatmap background at a given amount.
  // Lighter shades (levels 1-3, L≥72%) get a dark tinted text; darker shades (levels 4-5) get white.
  const getHeatmapTextColor = (amount) => {
    if (amount === 0) return 'text-gray-500';
    const absAmount = Math.abs(amount);
    if (amount > 0) {
      // green backgrounds: levels 1-3 (<200) are light enough for dark text
      if (absAmount < 200) return 'text-[oklch(32%_0.12_148.98)]'; // dark forest green
      return 'text-white';                                           // levels 4-5 → white
    } else {
      // red backgrounds: levels 1-3 (<200) are light enough for dark text
      if (absAmount < 200) return 'text-[oklch(30%_0.15_27.518)]'; // dark brick red
      return 'text-white';                                           // levels 4-5 → white
    }
  };

  const changeMonth = (delta) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + delta, 1));
  };

  const changeYear = (delta) => {
    setCurrentDate(new Date(currentDate.getFullYear() + delta, currentDate.getMonth(), 1));
  };

  // Check if transaction is marked as recurring
  const isTransactionRecurring = (transaction) => {
    return manualRecurring.some(r => 
      r.startDate.getTime() === transaction.date.getTime() &&
      r.description === transaction.description &&
      r.amount === transaction.amount
    );
  };

  const dayOfWeekNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Auth Screen
  if (showAuth) {
    const isLocked = Date.now() < loginLockedUntil;
    const submitDisabled = authLoading || isLocked || (TURNSTILE_ENABLED && !turnstileToken);

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-600 to-indigo-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-xl p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <Calendar className="w-10 h-10 text-indigo-600 mx-auto mb-3" />
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Order Calendar</h1>
            <p className="text-sm text-gray-500">See your orders in calendar format</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {/* Honeypot — off-screen, invisible to humans, caught by bots */}
            <div
              aria-hidden="true"
              style={{ position: 'absolute', left: '-9999px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}
            >
              <label htmlFor="tc_website">Website</label>
              <input
                id="tc_website"
                type="text"
                name="website"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder={authMode === 'signup' ? 'Minimum 6 characters' : 'Enter your password'}
                autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                required
              />
            </div>

            {/* Cloudflare Turnstile widget */}
            {TURNSTILE_ENABLED && (
              <div className="flex justify-center">
                <div ref={turnstileContainerRef} />
              </div>
            )}

            {/* Error messages (rate-limit lockout or Supabase errors) */}
            {(loginAttemptMsg || authError) && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                {loginAttemptMsg || authError}
              </p>
            )}

            {/* Success message (e.g. "check your email") */}
            {authSuccess && (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
                {authSuccess}
              </p>
            )}

            <button
              type="submit"
              disabled={submitDisabled}
              className="w-full px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {authLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : authMode === 'login' ? (
                <LogIn className="w-4 h-4" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              {authLoading ? 'Please wait…' : authMode === 'login' ? 'Log In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
              className="text-indigo-600 hover:text-indigo-700 text-sm font-medium"
            >
              {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
            </button>
          </div>

          {!supabase && (
            <div className="mt-5 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              <p className="text-center">
                <strong>Demo mode:</strong> Supabase not configured — enter any email to continue.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Mode Selector Screen — shown when no data is loaded.
  // Rendered as an overlay rather than an early return so the ColumnMapper modal
  // (rendered at the bottom of the main JSX) remains in the DOM and can open.
  const showModeSelector = !dataMode && transactions.length === 0 && orders.length === 0;

  const handleModeChoice = (mode) => {
    // Store chosen mode without setting state — dataMode is committed in
    // handleColumnMapperComplete once the import succeeds, so this screen
    // stays visible until then.
    pendingModeRef.current = mode;
    if (modeSelectorInputRef.current) {
      modeSelectorInputRef.current.value = '';
      modeSelectorInputRef.current.click();
    }
  };

  // Main App
  const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(currentDate);
  const monthName = currentDate.toLocaleString('default', { month: 'long' });
  const stats = getMonthStats();
  const yearStats = getYearStats();

  const isEcomMode = dataMode === 'ecommerce' && orders.length > 0;
  const filteredOrders = isEcomMode ? getFilteredOrders() : [];
  const periodOrders = isEcomMode ? filteredOrders.filter(o => {
    const d = (orderDateField === 'fulfil' && o.fulfil_date) ? o.fulfil_date : o.date;
    return viewMode === 'year'
      ? d.getFullYear() === currentDate.getFullYear()
      : d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear();
  }) : [];
  const ecomStats = isEcomMode ? getEcomStats(periodOrders) : null;
  const presentPlatforms = isEcomMode ? getPresentPlatforms() : [];

  const calendarDays = [];
  for (let i = 0; i < startingDayOfWeek; i++) {
    calendarDays.push(<div key={`empty-${i}`} className="aspect-square" />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dayTransactions = getTransactionsForDate(date);
    
    // Sort transactions: recurring first, then by amount
    const sortedTransactions = dayTransactions.sort((a, b) => {
      // Check if transaction is recurring (either predicted or manually tagged)
      const aIsRecurring = a.isPredicted || isTransactionRecurring(a);
      const bIsRecurring = b.isPredicted || isTransactionRecurring(b);
      
      if (aIsRecurring && !bIsRecurring) return -1;
      if (!aIsRecurring && bIsRecurring) return 1;
      return Math.abs(b.amount) - Math.abs(a.amount); // Then by amount
    });
    
    const dayTotal = getDayTotal(date);
    const isSelected = selectedDate && 
      selectedDate.getDate() === date.getDate() &&
      selectedDate.getMonth() === date.getMonth() &&
      selectedDate.getFullYear() === date.getFullYear();
    
    const hasPredictions = dayTransactions.some(t => t.isPredicted);

    if (isEcomMode) {
      const dayOrders = getOrdersForDay(date);
      const orderCount = dayOrders.length;
      const dayGMV = dayOrders.reduce((s, o) => s + (o.amount || 0), 0);
      const dayPlatforms = [...new Set(dayOrders.map(o => o.platform))];

      calendarDays.push(
        <div
          key={day}
          onClick={() => setSelectedDate(date)}
          className={`aspect-square border border-gray-200 p-1 overflow-hidden cursor-pointer transition-colors relative ${
            isSelected ? 'ring-2 ring-indigo-500' : ''
          } ${viewMode === 'heatmap' ? getOrderHeatmapIntensity(orderCount) : 'bg-white hover:bg-gray-50'}`}
        >
          <div className="text-xs font-medium text-gray-400 mb-0.5">{day}</div>
          {orderCount > 0 && (
            <>
              <div className="text-xs font-bold text-gray-700">{orderCount} order{orderCount !== 1 ? 's' : ''}</div>
              <div className="text-xs text-gray-500">£{dayGMV.toFixed(0)}</div>
              <div className="flex gap-0.5 mt-0.5 flex-wrap">
                {dayPlatforms.map(p => (
                  <div key={p} className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: PLATFORM_COLORS[p] || '#9ca3af' }} title={PLATFORM_LABELS[p] || p} />
                ))}
              </div>
            </>
          )}
        </div>
      );
    } else {
      calendarDays.push(
        <div
          key={day}
          onClick={() => setSelectedDate(date)}
          className={`aspect-square border border-gray-200 p-1 overflow-hidden cursor-pointer transition-colors relative ${
            isSelected ? 'ring-2 ring-indigo-500' : ''
          } ${
            viewMode === 'heatmap' ? getHeatmapIntensity(dayTotal) : 'bg-white hover:bg-gray-50'
          }`}
        >
          {hasPredictions && (
            <Sparkles className="absolute top-1 right-1 w-3 h-3 text-purple-500" />
          )}
          <div className={`text-xs font-medium mb-1 ${viewMode === 'heatmap' && dayTotal !== 0 ? getHeatmapTextColor(dayTotal) : 'text-gray-400'}`}>{day}</div>
          {viewMode === 'calendar' && sortedTransactions.length > 0 && (
            <div className="space-y-0.5">
              {sortedTransactions.slice(0, 3).map((t, i) => {
                const isRecurring = t.isPredicted || isTransactionRecurring(t);
                const isDirectDebit = t.type && (t.type.toLowerCase().includes('direct debit') || t.type.toLowerCase().includes('dd'));

                return (
                  <div
                    key={i}
                    className={`text-xs p-0.5 rounded flex items-center gap-0.5 ${
                      isRecurring
                        ? 'bg-indigo-50 text-indigo-600 border border-indigo-100'
                        : t.amount > 0
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700'
                    }`}
                    title={`${t.description}: ${t.isPredicted && t.isVariableAmount ? '~' : ''}£${Math.abs(t.amount).toFixed(2)}${t.isPredicted ? ' (Predicted)' : isRecurring ? ' (Recurring)' : ''}${t.isVariableAmount ? ` (Variable: £${t.minAmount.toFixed(2)}-£${t.maxAmount.toFixed(2)})` : ''}`}
                  >
                    {isDirectDebit && !t.isPredicted && (
                      <span className="text-[9px] font-bold flex-shrink-0">DD</span>
                    )}
                    {isRecurring && !t.isPredicted && (
                      <Repeat className="w-2.5 h-2.5 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{t.description}</div>
                      <div className="text-xs font-semibold">
                        {t.isPredicted && t.isVariableAmount ? '~' : ''}£{Math.abs(t.amount).toFixed(2)}
                      </div>
                    </div>
                  </div>
                );
              })}
              {sortedTransactions.length > 3 && (
                <div className="text-xs text-gray-500 font-medium">+{sortedTransactions.length - 3} more</div>
              )}
            </div>
          )}
          {viewMode === 'heatmap' && dayTotal !== 0 && (
            <div className={`text-sm font-bold ${getHeatmapTextColor(dayTotal)}`}>
              {dayTotal < 0 ? '-' : ''}£{Math.abs(dayTotal).toFixed(0)}
            </div>
          )}
        </div>
      );
    }
  }

  // Year View
  const yearView = [];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  for (let m = 0; m < 12; m++) {
    if (isEcomMode) {
      const monthOrders = getFilteredOrders().filter(o => {
        const d = (orderDateField === 'fulfil' && o.fulfil_date) ? o.fulfil_date : o.date;
        return d.getMonth() === m && d.getFullYear() === year;
      });
      const monthOrderCount = monthOrders.length;
      const monthOrderColor = getOrderHeatmapIntensity(monthOrderCount);
      const monthGMV = monthOrders.reduce((s, o) => s + (o.amount || 0), 0);

      yearView.push(
        <div
          key={m}
          onClick={() => {
            setCurrentDate(new Date(year, m, 1));
            setViewMode('calendar');
          }}
          className={`${monthOrderColor} border border-gray-300 rounded-md p-4 cursor-pointer hover:shadow-lg transition-all relative`}
        >
          <div className="text-sm font-bold mb-2 text-gray-700">{monthNames[m]}</div>
          <div className="text-sm font-bold text-gray-800">{monthOrderCount} orders</div>
          <div className="text-xs text-gray-600">£{monthGMV.toFixed(0)}</div>
        </div>
      );
    } else {
      const monthTotal = getMonthTotal(m, year);
      const monthColor = monthTotal === 0 ? 'bg-gray-100' : getHeatmapIntensity(monthTotal);

      // Check if month has predicted transactions
      const hasPredictions = showPredictions && predictedTransactions.some(t =>
        t.date.getMonth() === m &&
        t.date.getFullYear() === year
      );

      yearView.push(
        <div
          key={m}
          onClick={() => {
            setCurrentDate(new Date(year, m, 1));
            setViewMode('calendar');
          }}
          className={`${monthColor} border border-gray-300 rounded-md p-4 cursor-pointer hover:shadow-lg transition-all relative`}
        >
          {hasPredictions && (
            <Sparkles className="absolute top-2 right-2 w-4 h-4 text-purple-600" />
          )}
          <div className={`text-sm font-bold mb-2 ${monthTotal === 0 ? 'text-gray-600' : getHeatmapTextColor(monthTotal)}`}>{monthNames[m]}</div>
          <div className={`text-sm font-bold ${monthTotal === 0 ? 'text-gray-700' : getHeatmapTextColor(monthTotal)}`}>
            {monthTotal >= 0 ? '+' : ''}£{monthTotal.toFixed(0)}
          </div>
        </div>
      );
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <nav className="bg-white border-b border-gray-200">
        <div className="flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8">
            <Calendar className="w-6 h-6 text-indigo-500" />
            <div className="relative">
              <button
                onClick={() => setShowProfileMenu(v => !v)}
                className="flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
              >
                <User className="w-5 h-5" />
              </button>
              {showProfileMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowProfileMenu(false)} />
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-20 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-xs text-gray-500">Signed in as</p>
                      <p className="text-sm font-medium text-gray-900 truncate">{username}</p>
                    </div>
                    <div className="py-1">
                      <button
                        onClick={() => { setShowFileManager(true); setShowProfileMenu(false); }}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <Folder className="w-4 h-4 text-gray-400" />
                        File Manager
                      </button>
                      <button
                        onClick={() => { handleSwitchMode(); setShowProfileMenu(false); }}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <RefreshCw className="w-4 h-4 text-gray-400" />
                        Switch mode
                      </button>
                    </div>
                    <div className="py-1 border-t border-gray-100">
                      <button
                        onClick={() => { handleLogout(); setShowProfileMenu(false); }}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <LogOut className="w-4 h-4 text-gray-400" />
                        Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
        </div>
      </nav>

      <div className="flex">
        {/* Filter Sidebar */}
        <aside className={`hidden lg:flex lg:flex-col bg-white border-r border-gray-200 flex-shrink-0 min-h-[calc(100vh-3.5rem)] transition-all duration-200 ${sidebarMini ? 'w-16' : 'w-64'}`}>
          {/* Sidebar header */}
          <div className={`flex items-center border-b border-gray-100 py-3 ${sidebarMini ? 'justify-center px-2' : 'justify-between px-4'}`}>
            {!sidebarMini && (
              <div className="flex items-center gap-2 min-w-0">
                <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-xs font-semibold text-gray-700">Filters</span>
                {hasActiveFilters() && (
                  <span className="inline-flex items-center justify-center w-4 h-4 text-xs font-bold bg-indigo-100 text-indigo-700 rounded-full flex-shrink-0">
                    {Object.values(activeFilters).reduce((sum, arr) => sum + (arr?.length || 0), 0) +
                     (amountFilter.type !== 'all' ? 1 : 0) +
                     (hiddenFiles.length > 0 ? 1 : 0)}
                  </span>
                )}
              </div>
            )}
            {sidebarMini && (
              <Filter className={`w-4 h-4 ${hasActiveFilters() ? 'text-indigo-500' : 'text-gray-400'}`} />
            )}
            <button
              onClick={() => setSidebarMini(v => !v)}
              className={`p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 ${sidebarMini ? 'mt-2' : ''}`}
              title={sidebarMini ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarMini ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>

          {/* Sidebar body */}
          {sidebarMini ? (
            /* Mini state: just icons for active states */
            <div className="flex flex-col items-center gap-3 py-4 px-2">
              {hasActiveFilters() && (
                <button
                  onClick={clearAllFilters}
                  className="p-1.5 rounded-md hover:bg-red-50 text-red-400 hover:text-red-500 transition-colors"
                  title="Clear all filters"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
              <div
                className={`p-1.5 rounded-md ${amountFilter.type !== 'all' ? 'text-indigo-500 bg-indigo-50' : 'text-gray-300'}`}
                title="Amount filter"
              >
                <span className="text-xs font-bold leading-none">£</span>
              </div>
              <div
                className={`p-1.5 rounded-md ${activeFilters.direction?.includes('income') ? 'text-emerald-600 bg-emerald-50' : 'text-gray-300'}`}
                title="Income filter"
              >
                <TrendingUp className="w-4 h-4" />
              </div>
              <div
                className={`p-1.5 rounded-md ${activeFilters.direction?.includes('expense') ? 'text-rose-600 bg-rose-50' : 'text-gray-300'}`}
                title="Expense filter"
              >
                <TrendingDown className="w-4 h-4" />
              </div>
            </div>
          ) : (
            /* Full state: all filter controls */
            <div className="flex flex-col gap-5 overflow-y-auto px-4 py-5 flex-1">
              {/* Clear all */}
              {hasActiveFilters() && (
                <button onClick={clearAllFilters} className="text-xs text-red-500 hover:text-red-600 font-medium text-left">
                  Clear all filters
                </button>
              )}

              {/* Files filter — shown first so users see what's loaded */}
              {uploadedFileName.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Files</p>
                  <div className="space-y-0.5 max-h-36 overflow-y-auto">
                    {uploadedFileName.map(fileName => (
                      <label key={fileName} className="flex items-center gap-2 px-1 py-1.5 hover:bg-gray-50 rounded-md cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!hiddenFiles.includes(fileName)}
                          onChange={() => setHiddenFiles(prev =>
                            prev.includes(fileName) ? prev.filter(f => f !== fileName) : [...prev, fileName]
                          )}
                          className="w-3.5 h-3.5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                        />
                        <span className="text-xs text-gray-700 truncate" title={fileName}>{fileName}</span>
                      </label>
                    ))}
                  </div>
                  {hiddenFiles.length > 0 && hiddenFiles.length < uploadedFileName.length && (
                    <p className="text-xs text-gray-400 mt-1 px-1">{uploadedFileName.length - hiddenFiles.length} of {uploadedFileName.length} selected</p>
                  )}
                </div>
              )}

              {/* Search */}
              <input
                type="text"
                placeholder="Search filters..."
                value={filterSearchQuery}
                onChange={(e) => setFilterSearchQuery(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 bg-gray-50"
              />

              {/* Filter Logic */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Logic</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setFilterLogic('OR')}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors border ${filterLogic === 'OR' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                  >OR</button>
                  <button
                    onClick={() => setFilterLogic('AND')}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors border ${filterLogic === 'AND' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                  >AND</button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">{filterLogic === 'OR' ? 'Match any filter' : 'Match all filters'}</p>
              </div>

              {/* Amount — bank mode only */}
              {!isEcomMode && <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Amount</p>
                <div className="space-y-2">
                  <select
                    value={amountFilter.type}
                    onChange={(e) => setAmountFilter({ ...amountFilter, type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                  >
                    <option value="all">All amounts</option>
                    <option value="less">Less than</option>
                    <option value="lessEqual">Less than or equal to</option>
                    <option value="more">More than</option>
                    <option value="moreEqual">More than or equal to</option>
                  </select>
                  {amountFilter.type !== 'all' && (
                    <input
                      type="number"
                      placeholder="Amount (£)"
                      value={amountFilter.value}
                      onChange={(e) => setAmountFilter({ ...amountFilter, value: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                      step="0.01" min="0"
                    />
                  )}
                </div>
              </div>}

              {/* Only show income or expense — bank mode only */}
              {!isEcomMode && <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Only show income or expense</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => toggleFilter('direction', 'income')}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors border flex items-center justify-center gap-1 ${activeFilters.direction?.includes('income') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                  >
                    <TrendingUp className="w-3 h-3" /> Income
                  </button>
                  <button
                    onClick={() => toggleFilter('direction', 'expense')}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors border flex items-center justify-center gap-1 ${activeFilters.direction?.includes('expense') ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                  >
                    <TrendingDown className="w-3 h-3" /> Expense
                  </button>
                </div>
              </div>}

              {/* Column filters (bank: type/category/etc; ecommerce: status/platform/channel/customer/custom) */}
              {Object.keys(availableFilterOptions).map(filterType => {
                const filteredOptions = getFilteredOptions(filterType);
                if (filterSearchQuery && filteredOptions.length === 0) return null;
                return (
                  <div key={filterType}>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 capitalize">{filterType}</p>
                    <div className="space-y-0.5 max-h-44 overflow-y-auto">
                      {filteredOptions.length > 0 ? filteredOptions.sort().map(option => (
                        <label key={option} className="flex items-center gap-2 px-1 py-1.5 hover:bg-gray-50 rounded-md cursor-pointer">
                          <input
                            type="checkbox"
                            checked={activeFilters[filterType]?.includes(option) || false}
                            onChange={() => toggleFilter(filterType, option)}
                            className="w-3.5 h-3.5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                          />
                          <span className="text-xs text-gray-700 truncate">{option}</span>
                        </label>
                      )) : (
                        <p className="text-xs text-gray-400 italic px-1">No options available</p>
                      )}
                    </div>
                  </div>
                );
              })}

              {filterSearchQuery && Object.keys(availableFilterOptions).every(ft => getFilteredOptions(ft).length === 0) && (
                <p className="text-xs text-gray-400 text-center py-2">No filters match "{filterSearchQuery}"</p>
              )}
            </div>
          )}
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6">
        <div id="export-card" className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          {/* Date range + transaction/order count */}
          {(() => {
            if (isEcomMode) {
              const displayOrders = getFilteredOrders();
              if (displayOrders.length === 0) return null;
              return (
                <div className="text-center mb-4">
                  <p className="text-xs text-gray-500">
                    📅 {new Date(Math.min(...displayOrders.map(o => o.date.getTime()))).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} – {new Date(Math.max(...displayOrders.map(o => o.date.getTime()))).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                    <span className="text-gray-300 mx-1.5">•</span>
                    {`${displayOrders.length} orders${activePlatforms.size > 0 ? ' (filtered)' : ''}`}
                  </p>
                </div>
              );
            }
            const displayTransactions = getFilteredTransactions();
            if (displayTransactions.length === 0) return null;
            return (
              <div className="text-center mb-4">
                <p className="text-xs text-gray-500">
                  📅 {new Date(Math.min(...displayTransactions.map(t => t.date.getTime()))).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} – {new Date(Math.max(...displayTransactions.map(t => t.date.getTime()))).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                  <span className="text-gray-300 mx-1.5">•</span>
                  {`${displayTransactions.length} ${dataMode === 'ecommerce' ? 'orders' : 'transactions'}${hasActiveFilters() ? ' (filtered)' : ''}`}
                </p>
              </div>
            );
          })()}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          {(isEcomMode ? periodOrders.length > 0 : getFilteredTransactions().length > 0) && (
            <>
              {/* Stats Cards */}
              {isEcomMode ? (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-indigo-800">
                        {viewMode === 'year' ? 'Year Orders' : 'Month Orders'}
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-indigo-700">
                      {ecomStats.count}
                    </div>
                  </div>

                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-5 h-5 text-green-600" />
                      <span className="text-sm font-medium text-green-800">
                        {viewMode === 'year' ? 'Year Revenue' : 'Month Revenue'}
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-green-700">
                      £{ecomStats.revenue.toFixed(2)}
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-blue-800">Avg Order Value</span>
                    </div>
                    <div className="text-2xl font-bold text-blue-700">
                      £{ecomStats.aov.toFixed(2)}
                    </div>
                  </div>

                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-purple-800">Fulfilment Rate</span>
                    </div>
                    <div className="text-2xl font-bold text-purple-700">
                      {ecomStats.fulfilRate}%
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-5 h-5 text-green-600" />
                      <span className="text-sm font-medium text-green-800">
                        {viewMode === 'year' ? 'Year Income' : 'Month Income'}
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-green-700">
                      £{(viewMode === 'year' ? yearStats : stats).income.toFixed(2)}
                    </div>
                  </div>

                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingDown className="w-5 h-5 text-red-600" />
                      <span className="text-sm font-medium text-red-800">
                        {viewMode === 'year' ? 'Year Expenses' : 'Month Expenses'}
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-red-700">
                      £{(viewMode === 'year' ? yearStats : stats).expenses.toFixed(2)}
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-blue-800">
                        {viewMode === 'year' ? 'Year Net' : 'Month Net'}
                      </span>
                    </div>
                    <div className={`text-2xl font-bold ${(viewMode === 'year' ? yearStats : stats).net >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                      £{(viewMode === 'year' ? yearStats : stats).net.toFixed(2)}
                    </div>
                  </div>

                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <RefreshCw className="w-5 h-5 text-purple-600" />
                      <span className="text-sm font-medium text-purple-800">Recurring Transactions</span>
                      {potentialDuplicates.length > 0 && (
                        <AlertTriangle className="w-5 h-5 text-amber-600" />
                      )}
                    </div>
                    <div className="text-2xl font-bold text-purple-700">
                      {recurringTransactions.length + manualRecurring.length}
                      <span className="text-lg font-semibold text-purple-600 ml-2">
                        (£{(
                          [...recurringTransactions, ...manualRecurring]
                            .reduce((sum, r) => sum + Math.abs(r.amount), 0)
                        ).toFixed(2)}/mo)
                      </span>
                    </div>
                    <button
                      onClick={() => setShowRecurring(!showRecurring)}
                      className="text-xs text-purple-600 hover:text-purple-700 mt-1"
                    >
                      {showRecurring ? 'Hide' : 'View'} details
                    </button>
                  </div>
                </div>
              )}

              {/* Recurring Transactions Panel — bank mode only */}
              {!isEcomMode && showRecurring && (recurringTransactions.length > 0 || manualRecurring.length > 0) && (
                <div className="mb-6 border border-gray-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-medium text-gray-700">Recurring Transactions</span>
                    </div>
                    {potentialDuplicates.length > 0 && (
                      <button
                        onClick={() => setShowDuplicateModal(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors text-xs font-medium text-amber-700"
                        title="Click to review potential duplicates"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {potentialDuplicates.length} duplicate{potentialDuplicates.length !== 1 ? 's' : ''} — review
                      </button>
                    )}
                  </div>
                  <div className="p-4">
                  
                  {(() => {
                    // Combine and group all recurring transactions by similar names
                    const allRecurring = [
                      ...recurringTransactions.map(r => ({ ...r, source: 'auto' })),
                      ...manualRecurring.map(r => ({ ...r, source: 'manual' }))
                    ];
                    
                    // Separate Direct Debits from other recurring transactions
                    const directDebits = [];
                    const otherRecurring = [];
                    
                    // Group by similar descriptions
                    const groupTransactions = (transactions) => {
                      const groups = [];
                      const processed = new Set();
                      
                      transactions.forEach((r, idx) => {
                        if (processed.has(idx)) return;
                        
                        const group = [r];
                        
                        // Find similar transactions
                        transactions.forEach((r2, idx2) => {
                          if (idx !== idx2 && !processed.has(idx2)) {
                            if (areSimilarDescriptions(r.description, r2.description)) {
                              group.push(r2);
                              processed.add(idx2);
                            }
                          }
                        });
                        
                        processed.add(idx);
                        groups.push(group);
                      });
                      
                      return groups;
                    };
                    
                    // Separate transactions by type
                    allRecurring.forEach(r => {
                      if (r.isAutoTagged) {
                        directDebits.push(r);
                      } else {
                        otherRecurring.push(r);
                      }
                    });
                    
                    const directDebitGroups = groupTransactions(directDebits);
                    const otherRecurringGroups = groupTransactions(otherRecurring);
                    
                    return (
                      <div className="space-y-6">
                        {/* Direct Debits Section */}
                        {directDebits.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Direct Debits</p>
                            <div className="space-y-1.5">
                              {directDebitGroups.map((group, groupIdx) => (
                                <div key={`dd-${groupIdx}`} className={group.length > 1 ? 'border border-amber-200 rounded-lg p-2 bg-amber-50' : ''}>
                                  {group.length > 1 && (
                                    <p className="text-xs text-amber-600 font-medium mb-1.5">{group.length} similar</p>
                                  )}
                                  <div className="space-y-1">
                                    {group.map((r, idx) => (
                                      <div key={r.id || idx} className={`rounded-lg px-3 py-2.5 flex justify-between items-center bg-white border border-gray-200 ${group.length > 1 ? 'ml-2' : ''}`}>
                                        <div className="min-w-0 flex-1 mr-3">
                                          <div className="text-sm font-medium text-gray-800 flex items-center gap-1.5 flex-wrap">
                                            {r.description}
                                            <span className="text-xs bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded font-medium">DD</span>
                                          </div>
                                          <div className="text-xs text-gray-400 mt-0.5">
                                            {r.patternName || r.frequencyLabel}
                                            {r.dayOfMonth && ` · ${r.dayOfMonth}${r.dayOfMonth === 1 ? 'st' : r.dayOfMonth === 2 ? 'nd' : r.dayOfMonth === 3 ? 'rd' : 'th'}`}
                                            {r.dayOfWeek !== null && ` · ${dayOfWeekNames[r.dayOfWeek]}s`}
                                            {r.category && ` · ${r.category}`}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                          <span className={`text-sm font-semibold ${r.amount > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                            {r.isVariableAmount && '~'}{r.amount > 0 ? '+' : '-'}£{Math.abs(r.amount).toFixed(2)}
                                          </span>
                                          <button onClick={() => openEditRecurringModal(r)} className="text-gray-400 hover:text-gray-600 p-1" title="Edit">
                                            <Edit className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Recurring Transactions Section */}
                        {otherRecurring.length > 0 && (
                          <div className={directDebits.length > 0 ? 'mt-4' : ''}>
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recurring</p>
                            <div className="space-y-1.5">
                              {otherRecurringGroups.map((group, groupIdx) => (
                                <div key={`rec-${groupIdx}`} className={group.length > 1 ? 'border border-amber-200 rounded-lg p-2 bg-amber-50' : ''}>
                                  {group.length > 1 && (
                                    <p className="text-xs text-amber-600 font-medium mb-1.5">{group.length} similar</p>
                                  )}
                                  <div className="space-y-1">
                                    {group.map((r, idx) => (
                                      <div key={r.id || idx} className={`rounded-lg px-3 py-2.5 flex justify-between items-center bg-white border border-gray-200 ${group.length > 1 ? 'ml-2' : ''}`}>
                                        <div className="min-w-0 flex-1 mr-3">
                                          <div className="text-sm font-medium text-gray-800 flex items-center gap-1.5 flex-wrap">
                                            {r.description}
                                            <span className="text-xs bg-gray-100 text-gray-500 border border-gray-200 px-1.5 py-0.5 rounded font-medium">
                                              {r.source === 'auto' ? 'auto' : 'manual'}
                                            </span>
                                          </div>
                                          <div className="text-xs text-gray-400 mt-0.5">
                                            {r.patternName || r.frequencyLabel}
                                            {r.dayOfMonth && ` · ${r.dayOfMonth}${r.dayOfMonth === 1 ? 'st' : r.dayOfMonth === 2 ? 'nd' : r.dayOfMonth === 3 ? 'rd' : 'th'}`}
                                            {r.dayOfWeek !== null && ` · ${dayOfWeekNames[r.dayOfWeek]}s`}
                                            {r.category && ` · ${r.category}`}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                          <span className={`text-sm font-semibold ${r.amount > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                            {r.isVariableAmount && '~'}{r.amount > 0 ? '+' : '-'}£{Math.abs(r.amount).toFixed(2)}
                                          </span>
                                          <button onClick={() => openEditRecurringModal(r)} className="text-gray-400 hover:text-gray-600 p-1" title="Edit">
                                            <Edit className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Calendar always visible when data is loaded — even if filters show 0 results */}
          {(isEcomMode || transactions.length > 0) && (
            <>
              {isEcomMode && filteredOrders.length === 0 && orders.length > 0 && (
                <div className="text-center py-6 text-sm text-gray-400">
                  No orders match the current filter.
                </div>
              )}

              {/* Navigation and View Controls */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => viewMode === 'year' ? changeYear(-1) : changeMonth(-1)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ChevronLeft className="w-6 h-6 text-gray-600" />
                </button>

                <button
                  onClick={() => setViewMode(viewMode === 'year' ? 'calendar' : 'year')}
                  className="text-sm font-semibold text-gray-700 hover:text-indigo-600 transition-colors cursor-pointer tracking-tight"
                >
                  {viewMode === 'year' ? `${year}` : `${monthName} ${year}`}
                </button>

                <button
                  onClick={() => viewMode === 'year' ? changeYear(1) : changeMonth(1)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ChevronRight className="w-6 h-6 text-gray-600" />
                </button>
              </div>

              {/* Platform filter pills — ecommerce mode only */}
              {isEcomMode && presentPlatforms.length > 0 && (
                <div data-no-export className="flex gap-2 mb-3 flex-wrap">
                  <button
                    onClick={() => setActivePlatforms(new Set())}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      activePlatforms.size === 0 ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                    }`}
                  >All</button>
                  {presentPlatforms.map(p => (
                    <button
                      key={p}
                      onClick={() => setActivePlatforms(prev => {
                        const next = new Set(prev);
                        if (next.has(p)) next.delete(p); else next.add(p);
                        return next;
                      })}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                        activePlatforms.has(p) ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                      }`}
                      style={activePlatforms.has(p) ? { backgroundColor: PLATFORM_COLORS[p] } : {}}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[p] }} />
                      {PLATFORM_LABELS[p] || p}
                    </button>
                  ))}
                </div>
              )}

              {/* Status filter pills — ecommerce mode only */}
              {isEcomMode && (
                <div data-no-export className="flex gap-2 mb-3 flex-wrap">
                  <button
                    onClick={() => setActiveStatus('all')}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      activeStatus === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                    }`}
                  >All</button>
                  {[
                    { key: 'paid', label: 'Paid', color: 'bg-emerald-500' },
                    { key: 'completed', label: 'Completed', color: 'bg-emerald-500' },
                    { key: 'pending', label: 'Pending', color: 'bg-amber-500' },
                    { key: 'refunded', label: 'Refunded', color: 'bg-blue-500' },
                    { key: 'cancelled', label: 'Cancelled', color: 'bg-red-500' }
                  ].map(({ key, label, color }) => (
                    <button
                      key={key}
                      onClick={() => setActiveStatus(key)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        activeStatus === key ? `${color} text-white border-transparent` : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                      }`}
                    >{label}</button>
                  ))}
                </div>
              )}

              {/* Order date / Fulfilment date toggle — ecommerce mode only */}
              {isEcomMode && (
                <div data-no-export className="flex gap-2 mb-3">
                  <button
                    onClick={() => setOrderDateField('order')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      orderDateField === 'order' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                    }`}
                  >Order date</button>
                  <button
                    onClick={() => setOrderDateField('fulfil')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      orderDateField === 'fulfil' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                    }`}
                  >Fulfilment date</button>
                </div>
              )}

              {/* View Mode Buttons */}
              <div data-no-export className="flex gap-2 mb-4 flex-wrap">
                <button
                  onClick={() => setViewMode('calendar')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    viewMode === 'calendar'
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Calendar
                </button>
                <button
                  onClick={() => setViewMode('heatmap')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    viewMode === 'heatmap'
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Heatmap
                </button>
                <button
                  onClick={() => setViewMode('year')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    viewMode === 'year'
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Year
                </button>

                <button
                  onClick={() => setShowExportModal(true)}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors flex items-center gap-2 ml-auto"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
              </div>

              {/* Calendar/Heatmap/Year View */}
              {viewMode === 'year' ? (
                <div id="calendar-root" className="grid grid-cols-3 md:grid-cols-4 gap-2">
                  {yearView}
                </div>
              ) : (
                <div id="calendar-root">
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                      <div key={day} className="text-center text-xs font-medium text-gray-400 uppercase tracking-wide py-2">
                        {day}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays}
                  </div>
                </div>
              )}

              {viewMode === 'heatmap' && (
                <div className="mt-4 flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                  <span>Less</span>
                  <div className="flex gap-1">
                    <div className="w-4 h-4 bg-gray-100 border border-gray-200 rounded-sm"></div>
                    <div className="w-4 h-4 bg-[oklch(93%_0.03_27.518)] rounded-sm"></div>
                    <div className="w-4 h-4 bg-[oklch(72%_0.13_27.518)] rounded-sm"></div>
                    <div className="w-4 h-4 bg-[oklch(50.5%_0.213_27.518)] rounded-sm"></div>
                  </div>
                  <span>More Expenses</span>
                  <div className="flex gap-1 ml-3">
                    <div className="w-4 h-4 bg-[oklch(93%_0.04_148.98)] rounded-sm"></div>
                    <div className="w-4 h-4 bg-[oklch(74%_0.11_148.98)] rounded-sm"></div>
                    <div className="w-4 h-4 bg-[oklch(53%_0.15_148.98)] rounded-sm"></div>
                  </div>
                  <span>More Income</span>
                  <div className="flex gap-1 ml-3">
                    <div className="w-4 h-4 bg-indigo-100 border border-indigo-200 rounded-sm"></div>
                    <span>Manual Recurring</span>
                  </div>
                </div>
              )}

              {/* Selected Date Details */}
              {selectedDate && viewMode !== 'year' && (
                <div className="mt-5 border-t border-gray-100 pt-5">
                  {isEcomMode ? (
                    (() => {
                      const dayOrds = getOrdersForDay(selectedDate);
                      const STATUS_COLORS = {
                        paid: 'bg-emerald-100 text-emerald-800',
                        completed: 'bg-emerald-100 text-emerald-800',
                        pending: 'bg-amber-100 text-amber-800',
                        refunded: 'bg-blue-100 text-blue-800',
                        cancelled: 'bg-red-100 text-red-800',
                      };
                      return dayOrds.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <h3 className="text-sm font-semibold text-gray-800">
                                {selectedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                              </h3>
                              <p className="text-xs text-gray-400 mt-0.5">{dayOrds.length} order{dayOrds.length !== 1 ? 's' : ''} · £{dayOrds.reduce((s,o) => s+o.amount,0).toFixed(2)} GMV</p>
                            </div>
                          </div>
                          <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Order ID</th>
                                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Amount</th>
                                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Platform</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {dayOrds.map((o, i) => {
                                  const statusKey = (o.status || '').toLowerCase();
                                  const badgeClass = STATUS_COLORS[statusKey] || 'bg-gray-100 text-gray-700';
                                  return (
                                    <tr key={i} className="hover:bg-gray-50">
                                      <td className="px-3 py-2 text-gray-600 font-mono text-xs">{o.order_id || '—'}</td>
                                      <td className="px-3 py-2 text-gray-900 max-w-[140px] truncate" title={o.product}>{o.product || o.customer || '—'}</td>
                                      <td className="px-3 py-2 text-right font-medium text-gray-900">£{Math.abs(o.amount).toFixed(2)}</td>
                                      <td className="px-3 py-2">
                                        {o.status ? <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${badgeClass}`}>{o.status}</span> : <span className="text-gray-400">—</span>}
                                      </td>
                                      <td className="px-3 py-2">
                                        <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[o.platform] || '#9ca3af' }} />
                                          {PLATFORM_LABELS[o.platform] || o.platform || '—'}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-6 text-gray-400 text-sm">No orders on this day</div>
                      );
                    })()
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h3 className="text-sm font-semibold text-gray-800">
                            {selectedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                          </h3>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {getTransactionsForDate(selectedDate).length} transaction{getTransactionsForDate(selectedDate).length !== 1 ? 's' : ''}
                          </p>
                        </div>

                        {getTransactionsForDate(selectedDate).filter(t => !t.isPredicted).length > 0 && (
                          !isTransactionEditMode ? (
                            <button
                              onClick={() => setIsTransactionEditMode(true)}
                              className="px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            >
                              Edit
                            </button>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={selectAllDayTransactions}
                                className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                              >
                                {selectedTransactionIds.size === getTransactionsForDate(selectedDate).filter(t => !t.isPredicted).length
                                  ? 'Deselect All'
                                  : 'Select All'}
                              </button>
                              <button
                                onClick={clearTransactionSelection}
                                className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                              >
                                Done
                              </button>
                            </div>
                          )
                        )}
                      </div>

                      {getTransactionsForDate(selectedDate).length > 0 ? (
                        <div className="space-y-2">
                          {getTransactionsForDate(selectedDate).map((transaction, idx) => {
                            const transactionId = getTransactionId(transaction);
                            const isSelected = selectedTransactionIds.has(transactionId);
                            const isSelectableTransaction = !transaction.isPredicted;

                            return (
                              <div
                                key={idx}
                                onClick={() => isTransactionEditMode && isSelectableTransaction && toggleTransactionSelection(transactionId)}
                                className={`p-3 rounded-lg border border-gray-100 border-l-4 transition-colors ${
                                  isTransactionEditMode && isSelectableTransaction ? 'cursor-pointer' : ''
                                } ${
                                  isSelected
                                    ? 'bg-red-50 border-l-red-400 border-gray-100'
                                    : transaction.amount > 0
                                      ? 'bg-emerald-50 border-l-emerald-300'
                                      : 'bg-rose-50 border-l-rose-300'
                                }`}
                              >
                                <div className="flex justify-between items-start mb-2">
                                  {/* Checkbox in edit mode */}
                                  {isTransactionEditMode && isSelectableTransaction && (
                                    <div
                                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors mr-3 flex-shrink-0 mt-1 ${
                                        isSelected
                                          ? 'bg-red-500 border-red-500'
                                          : 'border-gray-300 bg-white hover:border-red-300'
                                      }`}
                                    >
                                      {isSelected && (
                                        <Check className="w-3 h-3 text-white" />
                                      )}
                                    </div>
                                  )}

                                  <div className="flex-1 min-w-0">
                                    <div className={`text-sm font-medium flex items-center gap-1.5 flex-wrap ${isSelected ? 'text-red-900' : 'text-gray-900'}`}>
                                      {transaction.description}
                                      {transaction.type && (transaction.type.toLowerCase().includes('direct debit') || transaction.type.toLowerCase().includes('dd')) && (
                                        <span className="text-xs bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded font-medium">DD</span>
                                      )}
                                      {!transaction.isPredicted && isTransactionRecurring(transaction) && (
                                        <span className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                                          <Repeat className="w-2.5 h-2.5" />
                                          recurring
                                        </span>
                                      )}
                                    </div>
                                    {transaction.time && (
                                      <div className="text-xs text-gray-400 mt-0.5">
                                        {transaction.time}
                                      </div>
                                    )}
                                    {transaction.frequency && (
                                      <div className="text-xs text-gray-400 mt-0.5">
                                        {transaction.frequency}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                    <div className={`text-sm font-semibold ${
                                      isSelected ? 'text-red-700'
                                        : transaction.amount > 0 ? 'text-emerald-700' : 'text-rose-700'
                                    }`}>
                                      {transaction.amount > 0 ? '+' : '-'}£{Math.abs(transaction.amount).toFixed(2)}
                                    </div>
                                    {/* Recurring button - only show when NOT in edit mode */}
                                    {!isTransactionEditMode && !transaction.isPredicted && !transaction.type?.toLowerCase().includes('direct debit') && !transaction.type?.toLowerCase().includes('dd') && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openRecurringModal(transaction);
                                        }}
                                        className="text-gray-400 hover:text-indigo-500 p-1.5 hover:bg-indigo-50 rounded-lg transition-colors"
                                        title="Mark as recurring"
                                      >
                                        <Repeat className="w-4 h-4" />
                                      </button>
                                    )}
                                    {!isTransactionEditMode && !transaction.isPredicted && (transaction.type?.toLowerCase().includes('direct debit') || transaction.type?.toLowerCase().includes('dd')) && (
                                      <div className="text-xs text-sky-600 bg-sky-50 border border-sky-100 px-2 py-1 rounded">
                                        Auto-recurring
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {(transaction.type || transaction.category || transaction.reference) && (
                                  <div className={`flex flex-wrap gap-1.5 mt-2 ${isTransactionEditMode && isSelectableTransaction ? 'ml-7' : ''}`}>
                                    {transaction.type && (
                                      <span className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded px-2 py-0.5">{transaction.type}</span>
                                    )}
                                    {transaction.category && (
                                      <span className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded px-2 py-0.5">{transaction.category}</span>
                                    )}
                                    {transaction.reference && (
                                      <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded px-2 py-0.5">{transaction.reference}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {/* Delete Action Bar - shown when items selected */}
                          {selectedTransactionIds.size > 0 && (
                            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
                              <span className="text-sm font-medium text-red-800">
                                {selectedTransactionIds.size} transaction{selectedTransactionIds.size > 1 ? 's' : ''} selected
                              </span>
                              <button
                                onClick={() => setShowDeleteConfirmModal(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium text-sm"
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete Selected
                              </button>
                            </div>
                          )}

                          {selectedTransactionIds.size === 0 && (
                            <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                              <div className="space-y-1.5">
                                <div className="flex justify-between items-center">
                                  <span className="text-sm text-gray-500">Income</span>
                                  <span className="text-sm font-semibold text-emerald-700">+£{getDayStats(selectedDate).income.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-sm text-gray-500">Expenses</span>
                                  <span className="text-sm font-semibold text-rose-700">-£{getDayStats(selectedDate).expenses.toFixed(2)}</span>
                                </div>
                                <div className="border-t border-gray-200 pt-1.5 flex justify-between items-center">
                                  <span className="text-sm font-medium text-gray-600">Net</span>
                                  <span className={`text-sm font-semibold ${getDayStats(selectedDate).net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                    {getDayStats(selectedDate).net >= 0 ? '+' : ''}£{getDayStats(selectedDate).net.toFixed(2)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-gray-500 text-center py-8">No transactions on this date</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {transactions.length === 0 && orders.length === 0 && (
            <div className="text-center py-16">
              {storageLoading ? (
                <>
                  <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-500">Restoring your files…</p>
                  <p className="text-xs text-gray-400 mt-1">Loading saved transactions from your profile</p>
                </>
              ) : (
                <button
                  onClick={() => setShowFileManager(true)}
                  className="group w-full flex flex-col items-center focus:outline-none"
                >
                  <Upload className="w-10 h-10 text-gray-300 group-hover:text-indigo-400 mx-auto mb-3 transition-colors" />
                  <p className="text-sm font-medium text-gray-500 group-hover:text-indigo-600 transition-colors">Upload a CSV file to get started</p>
                  <p className="text-xs text-gray-400 mt-1">Your CSV should contain date, amount, and description columns</p>
                </button>
              )}
            </div>
          )}
        </div>
        </main>
      </div>

      {/* Recurring Modal */}
      {showRecurringModal && selectedTransaction && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-lg w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Repeat className="w-4 h-4 text-gray-400" />
                Mark as Recurring
              </h3>
              <button
                onClick={() => setShowRecurringModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4">
              <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs">
                <div className="font-semibold text-gray-800">{selectedTransaction.description}</div>
                <div className={`font-bold mt-0.5 ${selectedTransaction.amount > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {selectedTransaction.amount > 0 ? '+' : '-'}£{Math.abs(selectedTransaction.amount).toFixed(2)}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Frequency</label>
                  <select
                    value={recurringConfig.frequency}
                    onChange={(e) => setRecurringConfig({ ...recurringConfig, frequency: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly (Every 2 weeks)</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                    <option value="custom">Custom (specify days)</option>
                  </select>
                </div>

                {recurringConfig.frequency === 'custom' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Every X days</label>
                    <input
                      type="number"
                      min="1"
                      value={recurringConfig.customDays}
                      onChange={(e) => setRecurringConfig({ ...recurringConfig, customDays: parseInt(e.target.value) || 30 })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                )}

                {(recurringConfig.frequency === 'monthly' || recurringConfig.frequency === 'quarterly' || recurringConfig.frequency === 'yearly') && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Day of Month</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={recurringConfig.dayOfMonth}
                      onChange={(e) => setRecurringConfig({ ...recurringConfig, dayOfMonth: parseInt(e.target.value) || 1 })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Ends</label>
                  <select
                    value={recurringConfig.endType}
                    onChange={(e) => setRecurringConfig({ ...recurringConfig, endType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="never">Never</option>
                    <option value="date">On specific date</option>
                    <option value="count">After X occurrences</option>
                  </select>
                </div>

                {recurringConfig.endType === 'date' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">End Date</label>
                    <input
                      type="date"
                      value={recurringConfig.endDate}
                      onChange={(e) => setRecurringConfig({ ...recurringConfig, endDate: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                )}

                {recurringConfig.endType === 'count' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Number of Occurrences</label>
                    <input
                      type="number"
                      min="1"
                      value={recurringConfig.endCount}
                      onChange={(e) => setRecurringConfig({ ...recurringConfig, endCount: parseInt(e.target.value) || 12 })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50/50">
              <button
                onClick={() => setShowRecurringModal(false)}
                className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveManualRecurring}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Save Recurring
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Detection Modal */}
      {showDuplicateModal && potentialDuplicates.length > 0 && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-gray-400" />
                Potential Duplicate Recurring Transactions
              </h3>
              <button
                onClick={() => setShowDuplicateModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-5">
              <p className="text-xs text-gray-500 mb-4">
                We found {potentialDuplicates.length} potential duplicate{potentialDuplicates.length !== 1 ? 's' : ''}. Select transactions to delete or keep both.
              </p>
              <div className="space-y-6">
                {potentialDuplicates.map((dup, groupIdx) => (
                  <div key={dup.id} className="border border-amber-200 rounded-lg p-3 bg-amber-50">
                    {/* Group Header */}
                    <div className="mb-4 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-amber-900 mb-1">
                          Similar Transaction Group #{groupIdx + 1}
                        </div>
                        <div className="text-xs text-amber-700">
                          {dup.transactions.length} similar transactions detected with matching names.
                          Review and select which ones to keep or delete.
                        </div>
                      </div>
                    </div>

                    {/* Transaction Cards */}
                    <div className="space-y-3">
                      {dup.transactions.map((txn, txnIdx) => {
                        const isSelected = selectedDuplicates[dup.id]?.[txnIdx] || false;

                        return (
                          <div
                            key={txnIdx}
                            className={`bg-white rounded-lg p-3 border transition-all ${
                              isSelected
                                ? 'bg-red-50 border-red-400'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleDuplicateSelection(dup.id, txnIdx)}
                                className="w-5 h-5 mt-1 text-red-600 rounded border-gray-300 focus:ring-red-500 cursor-pointer"
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                  <span className="text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200 px-2 py-0.5 rounded">
                                    Transaction {txnIdx + 1}
                                  </span>
                                  {txn.isAutoTagged && (
                                    <span className="text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200 px-2 py-0.5 rounded">
                                      DD
                                    </span>
                                  )}
                                  {isSelected && (
                                    <span className="text-xs font-medium bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded">
                                      WILL DELETE
                                    </span>
                                  )}
                                </div>

                                <div className="font-semibold text-gray-800 mb-2 text-sm">{txn.description}</div>

                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-gray-500">Amount:</span>
                                    <span className={`font-bold ${txn.amount > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                      {txn.amount > 0 ? '+' : '-'}£{Math.abs(txn.amount).toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-gray-500">Frequency:</span>
                                    <span>{txn.frequencyLabel}</span>
                                  </div>
                                  {txn.dayOfMonth && (
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-gray-500">Day:</span>
                                      <span>{txn.dayOfMonth}{txn.dayOfMonth === 1 ? 'st' : txn.dayOfMonth === 2 ? 'nd' : txn.dayOfMonth === 3 ? 'rd' : 'th'}</span>
                                    </div>
                                  )}
                                  {txn.type && (
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-gray-500">Type:</span>
                                      <span>{txn.type}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Quick Actions for Group */}
                    <div className="mt-4 flex justify-end">
                      <button
                        onClick={() => keepBothDuplicates(dup.id)}
                        className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium hover:bg-emerald-100 transition-colors"
                      >
                        Ignore This Group
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50/50">
              <div className="flex-1 text-xs text-gray-500 flex items-center">
                <span className="font-medium">Tip:</span>&nbsp;Check the transactions you want to delete, then click "Delete Selected"
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDuplicateModal(false)}
                  className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteSelectedDuplicates}
                  className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
                >
                  <XCircle className="w-4 h-4" />
                  Delete Selected
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Mode Modal */}
      {showUploadModal && pendingFile && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-lg w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Upload className="w-4 h-4 text-gray-400" />
                Upload New CSV
              </h3>
              <button
                onClick={() => {
                  setShowUploadModal(false);
                  setPendingFile(null);
                }}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4">
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs">
                <p className="text-amber-800 font-medium mb-1">
                  You already have {dataMode === 'ecommerce' ? 'orders' : 'transactions'} loaded
                </p>
                <p className="text-amber-700">
                  {dataMode === 'ecommerce' ? orders.length : transactions.length} {dataMode === 'ecommerce' ? 'orders' : 'transactions'} from {loadedFiles.join(', ')}
                </p>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                How would you like to handle the new file?
              </p>

              <div className="space-y-3">
                {/* Replace Option */}
                <button
                  onClick={() => processFileUpload(pendingFile, 'replace')}
                  className="w-full p-3 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors text-left text-sm"
                >
                  <div className="flex items-start gap-3">
                    <XCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium text-gray-800 mb-1">Replace Existing Data</div>
                      <div className="text-xs text-gray-500">
                        Clear all current {dataMode === 'ecommerce' ? 'orders' : 'transactions'} and load only the new file
                      </div>
                      <div className="text-xs text-red-600 mt-1 font-medium">
                        This will delete {dataMode === 'ecommerce' ? orders.length : transactions.length} {dataMode === 'ecommerce' ? 'orders' : 'transactions'}{dataMode === 'bank' && manualRecurring.length > 0 ? ` and ${manualRecurring.length} manual recurring rules` : ''}
                      </div>
                    </div>
                  </div>
                </button>

                {/* Merge Option */}
                <button
                  onClick={() => processFileUpload(pendingFile, 'merge')}
                  className="w-full p-3 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors text-left text-sm"
                >
                  <div className="flex items-start gap-3">
                    <RefreshCw className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium text-gray-800 mb-1">Merge with Existing Data</div>
                      <div className="text-xs text-gray-500">
                        Combine new {dataMode === 'ecommerce' ? 'orders' : 'transactions'} with current data
                      </div>
                      <div className="text-xs text-emerald-600 mt-1 font-medium">
                        Keeps existing {dataMode === 'ecommerce' ? 'orders' : 'transactions'}{dataMode === 'bank' ? ' and manual recurring rules' : ''}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        Duplicates are automatically removed
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50/50">
              <button
                onClick={() => {
                  setShowUploadModal(false);
                  setPendingFile(null);
                }}
                className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-lg w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Download className="w-4 h-4 text-gray-400" />
                Export {dataMode === 'ecommerce' ? 'Orders' : 'Transactions'}
              </h3>
              <button
                onClick={() => setShowExportModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4">
              {/* Format Selection */}
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Format</p>
                <div className="grid grid-cols-5 gap-2">
                  <button
                    onClick={() => setExportConfig({ ...exportConfig, format: 'csv' })}
                    className={`p-2.5 rounded-lg border text-center text-xs font-medium transition-colors ${
                      exportConfig.format === 'csv'
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                    }`}
                  >
                    .CSV
                  </button>
                  <button
                    onClick={() => setExportConfig({ ...exportConfig, format: 'ics' })}
                    className={`p-2.5 rounded-lg border text-center text-xs font-medium transition-colors ${
                      exportConfig.format === 'ics'
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                    }`}
                  >
                    .ICS
                  </button>
                  <button
                    onClick={() => setExportConfig({ ...exportConfig, format: 'json' })}
                    className={`p-2.5 rounded-lg border text-center text-xs font-medium transition-colors ${
                      exportConfig.format === 'json'
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                    }`}
                  >
                    .JSON
                  </button>
                  <button
                    onClick={() => setExportConfig({ ...exportConfig, format: 'xlsx' })}
                    className={`p-2.5 rounded-lg border text-center text-xs font-medium transition-colors ${
                      exportConfig.format === 'xlsx'
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                    }`}
                  >
                    .XLSX
                  </button>
                  <button
                    onClick={() => setExportConfig(prev => ({ ...prev, format: 'pdf' }))}
                    className={`p-2.5 rounded-lg border text-center text-xs font-medium transition-colors ${
                      exportConfig.format === 'pdf'
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                    }`}
                  >
                    Image
                  </button>
                </div>
              </div>

              {/* Image options — only visible when Image format is selected */}
              {exportConfig.format === 'pdf' && (
                <div className="mb-4 space-y-3">
                  {/* View picker */}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">View to Export</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: 'heatmap', label: 'Monthly Heatmap', desc: 'Current month heatmap' },
                        { value: 'year',    label: 'Current Year View', desc: 'Full year overview'   },
                      ].map(({ value, label, desc }) => (
                        <button
                          key={value}
                          onClick={() => setExportConfig(prev => ({ ...prev, htmlView: value }))}
                          className={`p-3 rounded-lg border text-left transition-colors ${
                            (exportConfig.htmlView || 'heatmap') === value
                              ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          <div className="text-xs font-semibold">{label}</div>
                          <div className="text-xs opacity-70 mt-0.5">{desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* File format picker */}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">File Format</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: 'jpg', label: '.JPG', desc: 'Smaller file size' },
                        { value: 'png', label: '.PNG', desc: 'Lossless quality'  },
                      ].map(({ value, label, desc }) => (
                        <button
                          key={value}
                          onClick={() => setExportConfig(prev => ({ ...prev, imageFormat: value }))}
                          className={`p-3 rounded-lg border text-left transition-colors ${
                            (exportConfig.imageFormat || 'jpg') === value
                              ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          <div className="text-xs font-semibold">{label}</div>
                          <div className="text-xs opacity-70 mt-0.5">{desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Include</p>

              <div className="space-y-3">
                {/* Historic Transactions */}
                <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:border-indigo-200 transition-colors">
                  <input
                    type="checkbox"
                    checked={exportConfig.includeHistoric}
                    onChange={(e) => setExportConfig({ ...exportConfig, includeHistoric: e.target.checked })}
                    className="w-4 h-4 mt-0.5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-800">{dataMode === 'ecommerce' ? 'Orders' : 'Historic Transactions'}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {dataMode === 'ecommerce' ? 'All orders from your selected files' : 'All past transactions from your uploaded CSV'}
                      {exportConfig.applyFilters && hasActiveFilters() && (
                        <span className="text-indigo-600 font-medium"> (filtered)</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {dataMode === 'ecommerce'
                        ? `${exportConfig.applyFilters && hasActiveFilters() ? getFilteredOrders().length : orders.filter(o => loadedFiles.includes(o.sourceFile) && !hiddenFiles.includes(o.sourceFile)).length} orders`
                        : `${exportConfig.applyFilters ? getFilteredTransactions().length : transactions.length} transactions`}
                    </div>
                  </div>
                </label>

                {/* Apply Filters Option */}
                {hasActiveFilters() && (
                  <label className="flex items-start gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:border-indigo-200 transition-colors">
                    <input
                      type="checkbox"
                      checked={exportConfig.applyFilters}
                      onChange={(e) => setExportConfig({ ...exportConfig, applyFilters: e.target.checked })}
                      className="w-4 h-4 mt-0.5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-800 flex items-center gap-2">
                        Apply Active Filters
                        <Filter className="w-3.5 h-3.5 text-gray-400" />
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Only export historic transactions matching your current filters
                      </div>
                      <div className="text-xs text-indigo-600 mt-0.5">
                        {Object.values(activeFilters).reduce((sum, arr) => sum + (arr?.length || 0), 0)} active filters
                      </div>
                    </div>
                  </label>
                )}
              </div>

              {/* Summary */}
              <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs">
                <div className="font-medium text-gray-700 mb-1">Export Summary</div>
                <div className="text-gray-600">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">Format:</span>
                    <span className="text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200 px-2 py-0.5 rounded">
                      .{exportConfig.format === 'pdf'
                          ? (exportConfig.imageFormat || 'jpg').toUpperCase()
                          : exportConfig.format.toUpperCase()}
                    </span>
                    {exportConfig.format === 'pdf' && (
                      <span className="text-gray-400">
                        {(exportConfig.htmlView || 'heatmap') === 'heatmap' ? 'Monthly heatmap' : 'Year view'}
                        {' · '}
                        {(exportConfig.imageFormat || 'jpg').toUpperCase()}
                      </span>
                    )}
                    {exportConfig.format === 'xlsx' && (
                      <span className="text-gray-400">{dataMode === 'ecommerce' ? 'Orders table + platform summary' : 'Calendar view, one sheet per month'}</span>
                    )}
                  </div>
                  {exportConfig.includeHistoric && (
                    <div className="text-gray-500">{dataMode === 'ecommerce'
                      ? `${exportConfig.applyFilters && hasActiveFilters() ? getFilteredOrders().length : orders.filter(o => loadedFiles.includes(o.sourceFile) && !hiddenFiles.includes(o.sourceFile)).length} orders`
                      : `${exportConfig.applyFilters && hasActiveFilters() ? getFilteredTransactions().length : transactions.filter(t => loadedFiles.includes(t.sourceFile)).length} historic transactions`}</div>
                  )}
                  {exportConfig.includePredicted && showPredictions && (
                    <div className="text-gray-500">{predictedTransactions.length} predicted transactions</div>
                  )}
                  {!exportConfig.includeHistoric && !exportConfig.includePredicted && (
                    <div className="text-amber-600">No transactions selected</div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50/50">
              <button
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={exportTransactions}
                disabled={exportConfig.format !== 'pdf' && !exportConfig.includeHistoric && !exportConfig.includePredicted}
                className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                {exportConfig.format === 'pdf'
                  ? `Export to Image (.${(exportConfig.imageFormat || 'jpg').toUpperCase()})`
                  : `Export .${exportConfig.format.toUpperCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Recurring Modal */}
      {showEditRecurringModal && editingRecurring && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-lg w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Edit className="w-4 h-4 text-gray-400" />
                Edit Recurring Transaction
              </h3>
              <button
                onClick={() => {
                  setShowEditRecurringModal(false);
                  setEditingRecurring(null);
                }}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4">
              <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs">
                <div className="font-semibold text-gray-800">{editingRecurring.description}</div>
                <div className={`font-bold mt-0.5 ${editingRecurring.amount > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {editingRecurring.amount > 0 ? '+' : '-'}£{Math.abs(editingRecurring.amount).toFixed(2)}
                </div>
                {editingRecurring.isAutoTagged && (
                  <div className="text-xs text-sky-600 mt-1 font-medium">
                    DD — Auto-tagged from Direct Debit
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Frequency</label>
                  <select
                    value={recurringConfig.frequency}
                    onChange={(e) => setRecurringConfig({ ...recurringConfig, frequency: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly (Every 2 weeks)</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                    <option value="custom">Custom (specify days)</option>
                  </select>
                </div>

                {recurringConfig.frequency === 'custom' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Every X days</label>
                    <input
                      type="number"
                      min="1"
                      value={recurringConfig.customDays}
                      onChange={(e) => setRecurringConfig({ ...recurringConfig, customDays: parseInt(e.target.value) || 30 })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                )}

                {(recurringConfig.frequency === 'monthly' || recurringConfig.frequency === 'quarterly' || recurringConfig.frequency === 'yearly') && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Day of Month</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={recurringConfig.dayOfMonth}
                      onChange={(e) => setRecurringConfig({ ...recurringConfig, dayOfMonth: parseInt(e.target.value) || 1 })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Ends</label>
                  <select
                    value={recurringConfig.endType}
                    onChange={(e) => setRecurringConfig({ ...recurringConfig, endType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="never">Never</option>
                    <option value="date">On specific date</option>
                    <option value="count">After X occurrences</option>
                  </select>
                </div>

                {recurringConfig.endType === 'date' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">End Date</label>
                    <input
                      type="date"
                      value={recurringConfig.endDate}
                      onChange={(e) => setRecurringConfig({ ...recurringConfig, endDate: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                )}

                {recurringConfig.endType === 'count' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Number of Occurrences</label>
                    <input
                      type="number"
                      min="1"
                      value={recurringConfig.endCount}
                      onChange={(e) => setRecurringConfig({ ...recurringConfig, endCount: parseInt(e.target.value) || 12 })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50/50">
              <button
                onClick={() => {
                  removeManualRecurring(editingRecurring);
                  setShowEditRecurringModal(false);
                  setEditingRecurring(null);
                }}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
              >
                <XCircle className="w-4 h-4" />
                Delete
              </button>
              <button
                onClick={updateManualRecurring}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Update
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Manager Modal */}
      {showFileManager && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-lg w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Folder className="w-4 h-4 text-gray-400" />
                File Manager
              </h3>
              <button
                onClick={() => setShowFileManager(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* File List */}
            <div className="flex-1 overflow-y-auto p-5">
              {uploadedFileName.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 mb-4 text-sm">No files uploaded yet</p>
                  <p className="text-xs text-gray-400">Upload CSV files to get started</p>
                </div>
              ) : (
                <div>
                  {/* Instructions */}
                  <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600">
                    <strong>Tip:</strong> All uploaded files are shown in the calendar. Use the <strong>Files</strong> filter in the sidebar to control which files are visible. Use the <Columns className="w-3 h-3 inline" /> button to remap columns if auto-detection failed.
                  </div>

                  {/* File List */}
                  <div className="space-y-2">
                    {uploadedFileName.map((fileName, index) => {
                      const fileTransactions = dataMode === 'ecommerce'
                        ? orders.filter(o => o.sourceFile === fileName)
                        : transactions.filter(t => t.sourceFile === fileName);
                      const detectionResult = fileDetectionResults[fileName];

                      // Determine detection status
                      const hasLowConfidence = detectionResult && (detectionResult.confidence || 0) < AUTO_DETECTION_CONFIDENCE_THRESHOLD;
                      const bankName = detectionResult?.format?.name || 'Unknown';

                      return (
                        <div
                          key={index}
                          className="border rounded-lg p-3 transition-colors bg-white border-gray-200"
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-gray-700">📄</span>
                                <span className="text-sm font-medium text-gray-900 truncate">
                                  {fileName}
                                </span>

                                {/* Bank Detection Badge */}
                                {detectionResult && (
                                  <span className={`inline-flex items-center gap-1 text-xs font-medium border px-2 py-0.5 rounded ${
                                    hasLowConfidence
                                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  }`}>
                                    {hasLowConfidence ? (
                                      <>
                                        <AlertTriangle className="w-3 h-3" />
                                        Low confidence
                                      </>
                                    ) : (
                                      <>
                                        <Check className="w-3 h-3" />
                                        {bankName}
                                      </>
                                    )}
                                  </span>
                                )}
                              </div>

                              <p className="text-xs text-gray-500">
                                {fileTransactions.length === 0 ? (
                                  <span className="italic">No {dataMode === 'ecommerce' ? 'orders' : 'transactions'} parsed — try remapping columns</span>
                                ) : (
                                  <>
                                    {fileTransactions.length} {dataMode === 'ecommerce' ? 'orders' : 'transactions'}
                                    {fileTransactions.length > 0 && (() => {
                                      const dateKey = dataMode === 'ecommerce' ? 'order_date' : 'date';
                                      const times = fileTransactions.map(t => t[dateKey]?.getTime()).filter(Boolean);
                                      if (times.length === 0) return null;
                                      return (
                                        <>
                                          <span className="text-gray-400 mx-1">•</span>
                                          {new Date(Math.min(...times)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                                          {' - '}
                                          {new Date(Math.max(...times)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                                        </>
                                      );
                                    })()}
                                  </>
                                )}
                              </p>
                            </div>

                            {/* Action buttons */}
                            <div className="flex items-center gap-1">
                              {/* Column Mapper button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const file = uploadedFiles[fileName];
                                  if (file) {
                                    setColumnMapperFile(file);
                                    setColumnMapperMode('replace');
                                    setShowColumnMapper(true);
                                  }
                                }}
                                className={`p-1.5 rounded transition-colors ${
                                  hasLowConfidence || fileTransactions.length === 0
                                    ? 'text-amber-600 hover:bg-amber-100'
                                    : 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50'
                                }`}
                                title={hasLowConfidence ? "Fix column mapping" : "Remap columns"}
                              >
                                <Columns className="w-4 h-4" />
                              </button>

                              {/* Delete button */}
                              <button
                                onClick={(e) => handleFileRemove(fileName, e)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                title="Delete file"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer with Close + Upload CSV */}
            <div className="flex gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50/50">
              <label className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer flex items-center gap-1.5">
                <Upload className="w-4 h-4" />
                <span>Upload CSV</span>
                <input
                  type="file"
                  accept=".csv"
                  multiple
                  onChange={handleMultiFileUpload}
                  className="hidden"
                />
              </label>
              <button
                onClick={() => setShowFileManager(false)}
                className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input for mode selector — kept in the DOM so browsers don't GC it */}
      <input
        ref={modeSelectorInputRef}
        type="file"
        accept=".csv"
        multiple
        className="hidden"
        onChange={handleMultiFileUpload}
      />

      {/* Mode Selector overlay — shown over the main app until data is loaded */}
      {showModeSelector && (
        <div className="fixed inset-0 z-50 bg-gradient-to-br from-blue-600 to-indigo-800 flex items-center justify-center p-4">
          <div className="max-w-4xl w-full">
            <div className="text-center mb-8">
              <Calendar className="w-16 h-16 text-white mx-auto mb-4" />
              <h1 className="text-4xl font-bold text-white mb-2">Order Calendar</h1>
              <p className="text-blue-100">Choose your data type to get started</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Bank Transactions Card */}
              <div
                onClick={() => handleModeChoice('bank')}
                className="bg-white rounded-xl shadow-lg p-8 cursor-pointer transition-all hover:shadow-2xl hover:scale-105 border-2 border-transparent hover:border-indigo-500"
              >
                <div className="flex flex-col items-center text-center">
                  <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mb-6">
                    <CreditCard className="w-10 h-10 text-blue-600" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-800 mb-3">Bank transactions</h2>
                  <p className="text-gray-600 mb-4">Visualise spending from bank or credit card CSV exports</p>
                  <p className="text-sm text-gray-400 mb-6">Monzo · Starling · Barclays · HSBC · Amex</p>
                  <button className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors">
                    Upload bank CSV
                  </button>
                </div>
              </div>

              {/* E-commerce Orders Card */}
              <div
                onClick={() => handleModeChoice('ecommerce')}
                className="bg-white rounded-xl shadow-lg p-8 cursor-pointer transition-all hover:shadow-2xl hover:scale-105 border-2 border-transparent hover:border-indigo-500"
              >
                <div className="flex flex-col items-center text-center">
                  <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mb-6">
                    <ShoppingBag className="w-10 h-10 text-emerald-600" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-800 mb-3">E-commerce orders</h2>
                  <p className="text-gray-600 mb-4">Track orders, revenue and fulfilment across platforms</p>
                  <p className="text-sm text-gray-400 mb-6">Shopify · TikTok Shop · Etsy · WooCommerce</p>
                  <button className="px-6 py-3 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition-colors">
                    Upload orders CSV
                  </button>
                </div>
              </div>
            </div>

            {isLoggedIn && (
              <div className="text-center mt-8">
                <button
                  onClick={handleLogout}
                  className="text-white hover:text-blue-100 text-sm flex items-center gap-2 mx-auto"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Column Mapper Modal */}
      {showColumnMapper && columnMapperFile && (
        <ColumnMapperErrorBoundary onCancel={handleColumnMapperCancel}>
          <ColumnMapper
            file={columnMapperFile}
            onComplete={handleColumnMapperComplete}
            onCancel={handleColumnMapperCancel}
            detectionResult={fileDetectionResults[columnMapperFile.name]}
            queueRemaining={uploadQueue.length}
            initialMode={pendingModeRef.current || dataMode || 'bank'}
          />
        </ColumnMapperErrorBoundary>
      )}

      {/* Delete Transactions Confirmation Modal */}
      {showDeleteConfirmModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-lg w-full max-w-md overflow-hidden">
            <div className="p-5">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900 text-center mb-2">
                Delete {selectedTransactionIds.size} transaction{selectedTransactionIds.size > 1 ? 's' : ''}?
              </h3>
              <p className="text-xs text-gray-500 text-center mb-4">
                This will remove the selected transactions from the calendar view for this session.
              </p>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs">
                <p className="text-amber-800">
                  <strong>To restore:</strong> Go to File Manager and reload the CSV file.
                </p>
              </div>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50/50">
              <button
                onClick={() => setShowDeleteConfirmModal(false)}
                className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={deleteSelectedTransactions}
                className="flex-1 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;