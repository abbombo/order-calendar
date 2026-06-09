import React, { useState, useEffect, useMemo } from 'react';
import { X, ChevronRight, ChevronLeft, Check, AlertTriangle, Columns, FileText, Search, RefreshCw } from 'lucide-react';
import Papa from 'papaparse';
import { BANK_FORMATS, parseDate, parseAmount, detectDelimiter } from './bankFormats';

// ── Profile helpers (localStorage) ─────────────────────────────────────────
// Change 1: all CSV mapping profile persistence uses localStorage only.
// Storage key : 'csv_mapping_profiles'
// Format      : JSON array of { name, mode, mapping }

const PROFILES_KEY = 'csv_mapping_profiles';

export function loadProfiles() {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); } catch { return []; }
}

export function saveProfile(profile) {
  // Replace any existing entry with the same name, then push the new one
  const list = loadProfiles().filter(p => p.name !== profile.name);
  list.push(profile);
  localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
}

export function deleteProfile(name) {
  const list = loadProfiles().filter(p => p.name !== name);
  localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
}

// ── E-commerce detection headers ───────────────────────────────────────────
// If any of these column names appear in an uploaded CSV, the mapper
// switches to E-commerce mode automatically and tries to match a saved profile.
const ECOM_INDICATORS = [
  'Fulfilled At', 'Order Total', 'Financial Status',
  'Order Creation Time', 'Order Amount', 'Sale Date',
  'Order Value', 'Date Completed', 'Order ID', 'Name',
];

/**
 * ColumnMapper Component
 *
 * A multi-step wizard for mapping CSV columns to transaction / order fields.
 * Now supports two modes:
 *   bank      — existing bank-transaction behaviour (unchanged)
 *   ecommerce — maps order exports from Shopify, TikTok Shop, Etsy, WooCommerce, etc.
 *
 * Props:
 *   file             : File object to process
 *   onComplete       : (transactions, metadata) => void
 *   onCancel         : () => void
 *   detectionResult  : optional bank detection result
 *   queueRemaining   : number of files still queued after this one
 */
const ColumnMapper = ({ file, onComplete, onCancel, detectionResult, queueRemaining = 0, initialMode = 'bank' }) => {
  // ── Step management ────────────────────────────────────────────────────
  const [step, setStep] = useState(1); // 1: Select, 2: Map, 3: Preview

  // ── CSV data ───────────────────────────────────────────────────────────
  const [csvData, setCsvData]       = useState([]);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [, setDelimiter]            = useState(',');

  // ── Bank-mode state ────────────────────────────────────────────────────
  const [selectedBank, setSelectedBank]       = useState(null);
  const [bankSearchQuery, setBankSearchQuery] = useState('');
  const [columnMappings, setColumnMappings]   = useState({
    date: '', time: '', description: '', amount: '',
    netAmount: '', moneyIn: '', moneyOut: '',
    type: '', category: '', reference: '', balance: ''
  });
  const [amountApproach, setAmountApproach] = useState(null);
  const [dateFormat, setDateFormat]         = useState('DD/MM/YYYY');

  // LocalStorage key for per-header auto-saved bank mappings
  const SAVED_MAPPINGS_KEY = 'transaction_calendar_column_mappings';

  // ── E-commerce mode state ──────────────────────────────────────────────
  const [mapperMode, setMapperMode]             = useState(initialMode === 'ecommerce' ? 'ecommerce' : 'bank');  // 'bank' | 'ecommerce'
  const [ecomMappings, setEcomMappings]         = useState({
    order_id: '', order_date: '', fulfil_date: '',
    customer: '', product: '',   amount: '',
    status: '',   channel: ''
  });
  const [selectedEcomProfile, setSelectedEcomProfile] = useState(null); // profile name string
  const [detectedPlatform, setDetectedPlatform]       = useState(null); // badge text
  const [profiles, setProfiles]                       = useState([]);   // live list from localStorage
  const [showSaveProfile, setShowSaveProfile]         = useState(false);
  const [saveProfileName, setSaveProfileName]         = useState('');
  const [customColumns, setCustomColumns]             = useState([]); // [{csv_col, label, as_filter, in_export}]

  // ── Shared ─────────────────────────────────────────────────────────────
  const [previewTransactions, setPreviewTransactions] = useState([]);
  const [parseErrors, setParseErrors]                 = useState([]);
  const [isLoading, setIsLoading]                     = useState(true);

  // ── Helpers ─────────────────────────────────────────────────────────────
  const refreshProfiles = () => setProfiles(loadProfiles());

  // ── Bank options ────────────────────────────────────────────────────────
  const bankOptions = useMemo(() => {
    return Object.entries(BANK_FORMATS).map(([key, format]) => ({
      key, name: format.name, delimiter: format.delimiter,
      dateFormat: format.dateFormat, color: getBankColor(key)
    }));
  }, []);

  function getBankColor(bankKey) {
    const colors = {
      monzo: 'bg-[#FF5A5F]',      starling: 'bg-[#6935D3]',   revolut: 'bg-[#0075EB]',
      barclays: 'bg-[#00AEEF]',   hsbc: 'bg-[#DB0011]',       lloyds: 'bg-[#006A4D]',
      natwest: 'bg-[#42145F]',    santander: 'bg-[#EC0000]',  nationwide: 'bg-[#003DA5]',
      n26: 'bg-[#36A18B]',        chase: 'bg-[#117ACA]',      bankOfAmerica: 'bg-[#012169]',
      wellsFargo: 'bg-[#D71E28]', europeanGeneric: 'bg-[#003399]',
      genericComma: 'bg-gray-400', genericSemicolon: 'bg-gray-400', genericTab: 'bg-gray-400'
    };
    return colors[bankKey] || 'bg-gray-400';
  }

  const filteredBanks = useMemo(() => {
    if (!bankSearchQuery.trim()) return bankOptions;
    const q = bankSearchQuery.toLowerCase();
    return bankOptions.filter(b =>
      b.name.toLowerCase().includes(q) || b.key.toLowerCase().includes(q)
    );
  }, [bankOptions, bankSearchQuery]);

  // ── Load and parse CSV; run auto-detection ─────────────────────────────
  useEffect(() => {
    if (!file) return;
    refreshProfiles();

    const reader = new FileReader();
    reader.onload = (e) => {
      const content       = e.target.result;
      const detectedDelim = detectDelimiter(content);
      setDelimiter(detectedDelim);

      const result  = Papa.parse(content, { header: true, delimiter: detectedDelim, skipEmptyLines: true });
      const headers = result.meta.fields || [];
      setCsvHeaders(headers);
      setCsvData(result.data);

      // ── Auto-detect ecommerce vs bank ────────────────────────────────
      const headerSet = new Set(headers.map(h => h.trim()));
      const isEcom    = initialMode === 'ecommerce' || ECOM_INDICATORS.some(h => headerSet.has(h));

      if (isEcom) {
        setMapperMode('ecommerce');
        setDateFormat('YYYY-MM-DD'); // most platforms use ISO dates

        // Find the best-matching saved ecommerce profile
        const ecomProfs   = loadProfiles().filter(p => p.mode === 'ecommerce');
        let best = null, bestScore = 0;
        for (const p of ecomProfs) {
          const score = Object.values(p.mapping).filter(v => v && headerSet.has(v)).length;
          if (score > bestScore) { bestScore = score; best = p; }
        }
        if (best && bestScore >= 2) {
          setDetectedPlatform(best.name);
          setSelectedEcomProfile(best.name);
          setEcomMappings(prev => ({ ...prev, ...best.mapping }));
        } else {
          setDetectedPlatform('e-commerce');
        }
      } else {
        // ── Bank mode ──────────────────────────────────────────────────
        setMapperMode('bank');
        setDetectedPlatform('bank format');

        if (detectionResult?.key) {
          setSelectedBank(detectionResult.key);
          autoMapColumns(detectionResult.key, headers);
        }
        const savedMappings = loadSavedMappings(headers);
        if (savedMappings) {
          setColumnMappings(savedMappings.mappings);
          setDateFormat(savedMappings.dateFormat || 'DD/MM/YYYY');
          if (savedMappings.bankKey) setSelectedBank(savedMappings.bankKey);
        }
      }

      setIsLoading(false);
    };
    reader.onerror = () => { console.error('Failed to read file'); setIsLoading(false); };
    reader.readAsText(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, detectionResult]);

  // ── Bank auto-mapping ───────────────────────────────────────────────────
  const autoMapColumns = (bankKey, headers = csvHeaders) => {
    const format = BANK_FORMATS[bankKey];
    if (!format) return;
    const newMappings = { ...columnMappings };
    Object.entries(format.headers).forEach(([field, possibleNames]) => {
      const matched = findMatchingHeader(headers, possibleNames);
      if (matched) newMappings[field] = matched;
    });
    setColumnMappings(newMappings);
    setDateFormat(format.dateFormat === 'auto' ? 'DD/MM/YYYY' : format.dateFormat);
    if (newMappings.moneyIn || newMappings.moneyOut) setAmountApproach('two_columns');
    else if (newMappings.netAmount || newMappings.amount) setAmountApproach('single_column');
  };

  const findMatchingHeader = (actualHeaders, possibleNames) => {
    if (!possibleNames) return '';
    const normalized = actualHeaders.map(h => h.toLowerCase().trim());
    for (const name of possibleNames) {
      const n   = name.toLowerCase().trim();
      const idx = normalized.indexOf(n);
      if (idx !== -1) return actualHeaders[idx];
      for (let i = 0; i < normalized.length; i++) {
        if (normalized[i].includes(n) || n.includes(normalized[i])) return actualHeaders[i];
      }
    }
    return '';
  };

  // Per-header localStorage save/load (bank mode only)
  const saveMappings = () => {
    try {
      const saved     = JSON.parse(localStorage.getItem(SAVED_MAPPINGS_KEY) || '{}');
      const headerKey = csvHeaders.slice().sort().join('|');
      saved[headerKey] = { mappings: columnMappings, dateFormat, bankKey: selectedBank, savedAt: new Date().toISOString() };
      localStorage.setItem(SAVED_MAPPINGS_KEY, JSON.stringify(saved));
    } catch (e) { console.error('Failed to save mappings:', e); }
  };

  const loadSavedMappings = (headers) => {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED_MAPPINGS_KEY) || '{}');
      return saved[headers.slice().sort().join('|')] || null;
    } catch { return null; }
  };

  // ── Mode switch ─────────────────────────────────────────────────────────
  const handleModeSwitch = (newMode) => {
    if (newMode === mapperMode) return;
    setMapperMode(newMode);
    if (newMode === 'bank') {
      setSelectedEcomProfile(null);
      setEcomMappings({ order_id:'', order_date:'', fulfil_date:'', customer:'', product:'', amount:'', status:'', channel:'' });
      setDateFormat('DD/MM/YYYY');
    } else {
      setSelectedBank(null);
      setColumnMappings({ date:'', time:'', description:'', amount:'', netAmount:'', moneyIn:'', moneyOut:'', type:'', category:'', reference:'', balance:'' });
      setDateFormat('YYYY-MM-DD');
    }
  };

  // ── Ecom profile actions ────────────────────────────────────────────────
  const handleEcomProfileSelect = (profile) => {
    setSelectedEcomProfile(profile.name);
    setEcomMappings({
      order_id:'', order_date:'', fulfil_date:'',
      customer:'', product:'', amount:'', status:'', channel:'',
      ...profile.mapping
    });
    setCustomColumns(profile.custom_columns || []);
  };

  const handleSaveProfileConfirm = () => {
    if (!saveProfileName.trim()) return;
    saveProfile({
      name: saveProfileName.trim(),
      mode: 'ecommerce',
      mapping: { ...ecomMappings },
      custom_columns: customColumns
    });
    setSelectedEcomProfile(saveProfileName.trim());
    setSaveProfileName('');
    setShowSaveProfile(false);
    refreshProfiles();
  };

  // ── Parse bank transactions ─────────────────────────────────────────────
  const parseTransactions = () => {
    const transactions = [], errors = [];
    csvData.forEach((row, index) => {
      try {
        const dateStr = row[columnMappings.date];
        if (!dateStr) { errors.push({ row: index + 1, error: 'Missing date' }); return; }
        const parsedDate = parseDate(dateStr, dateFormat);
        if (isNaN(parsedDate.getTime())) { errors.push({ row: index + 1, error: `Invalid date: ${dateStr}` }); return; }

        let amount = 0;
        if (columnMappings.netAmount) {
          amount = parseAmount(row[columnMappings.netAmount]);
        } else if (columnMappings.moneyIn || columnMappings.moneyOut) {
          const moneyIn  = row[columnMappings.moneyIn];
          const moneyOut = row[columnMappings.moneyOut];
          if (moneyOut && String(moneyOut).trim() !== '') amount = -Math.abs(parseAmount(moneyOut));
          if (moneyIn  && String(moneyIn).trim()  !== '') amount =  Math.abs(parseAmount(moneyIn));
        } else if (columnMappings.amount) {
          amount = parseAmount(row[columnMappings.amount]);
        }
        if (amount === 0) return;

        let description = row[columnMappings.description] || '';
        if (!description && columnMappings.type) description = row[columnMappings.type] || '';
        if (!description) description = 'Transaction';

        transactions.push({
          date:        parsedDate,
          time:        row[columnMappings.time]      || '',
          description: description.trim(),
          amount,
          type:        row[columnMappings.type]      || '',
          category:    row[columnMappings.category]  || '',
          reference:   row[columnMappings.reference] || '',
          balance:     columnMappings.balance ? parseAmount(row[columnMappings.balance]) : null,
          sourceFile:  file.name
        });
      } catch (e) { errors.push({ row: index + 1, error: e.message }); }
    });
    return { transactions, errors };
  };

  // ── Parse ecommerce orders ──────────────────────────────────────────────
  const parseEcomOrders = () => {
    const orders = [], errors = [];

    // Infer platform from selected profile name
    let platform = 'other';
    if (selectedEcomProfile) {
      const profileLower = selectedEcomProfile.toLowerCase();
      if (profileLower.includes('shopify')) platform = 'shopify';
      else if (profileLower.includes('tiktok')) platform = 'tiktok';
      else if (profileLower.includes('etsy')) platform = 'etsy';
      else if (profileLower.includes('woocommerce')) platform = 'woo';
    }

    csvData.forEach((row, index) => {
      try {
        const dateStr = row[ecomMappings.order_date];
        if (!dateStr) { errors.push({ row: index + 1, error: 'Missing order date' }); return; }
        const parsedDate = parseDate(dateStr, dateFormat);
        if (isNaN(parsedDate.getTime())) { errors.push({ row: index + 1, error: `Invalid date: ${dateStr}` }); return; }

        const amount = parseAmount(row[ecomMappings.amount]);
        if (amount === 0) return;

        const customer = ecomMappings.customer ? (row[ecomMappings.customer] || '') : '';
        const product  = ecomMappings.product  ? (row[ecomMappings.product]  || '') : '';

        // Parse fulfil_date if mapped
        let fulfilDate = null;
        if (ecomMappings.fulfil_date && row[ecomMappings.fulfil_date]) {
          const fulfilStr = row[ecomMappings.fulfil_date];
          fulfilDate = parseDate(fulfilStr, dateFormat);
          if (isNaN(fulfilDate.getTime())) fulfilDate = null;
        }

        // Populate custom fields
        const customData = {};
        customColumns.forEach(col => {
          if (col.label && row[col.csv_col] !== undefined) {
            customData[col.label] = row[col.csv_col];
          }
        });

        orders.push({
          order_id:    ecomMappings.order_id ? (row[ecomMappings.order_id] || '') : '',
          order_date:  parsedDate,
          fulfil_date: fulfilDate,
          customer:    customer,
          product:     product,
          amount:      amount,
          status:      ecomMappings.status  ? (row[ecomMappings.status]  || '') : '',
          platform:    platform,
          channel:     ecomMappings.channel ? (row[ecomMappings.channel] || '') : '',
          custom:      customData,
          sourceFile:  file.name
        });
      } catch (e) { errors.push({ row: index + 1, error: e.message }); }
    });
    return { orders, errors };
  };

  // Update preview when mappings or step change
  useEffect(() => {
    if (step === 3 && csvData.length > 0) {
      if (mapperMode === 'ecommerce') {
        const { orders, errors } = parseEcomOrders();
        setPreviewTransactions(orders.slice(0, 10));
        setParseErrors(errors.slice(0, 5));
      } else {
        const { transactions, errors } = parseTransactions();
        setPreviewTransactions(transactions.slice(0, 10));
        setParseErrors(errors.slice(0, 5));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, columnMappings, ecomMappings, dateFormat, csvData, mapperMode]);

  // ── Bank: handle bank select ───────────────────────────────────────────
  const handleBankSelect = (bankKey) => {
    setSelectedBank(bankKey);
    autoMapColumns(bankKey);
  };

  const handleMappingChange = (field, value) => {
    setColumnMappings(prev => ({ ...prev, [field]: value }));
  };

  // ── Validation ─────────────────────────────────────────────────────────
  const canProceed = () => {
    if (step === 1) {
      if (mapperMode === 'ecommerce') return true; // profile selection is optional
      return selectedBank !== null;
    }
    if (step === 2) {
      if (mapperMode === 'ecommerce') {
        return ecomMappings.order_date !== '' && ecomMappings.amount !== '';
      }
      const hasDate   = columnMappings.date !== '';
      const hasAmount = columnMappings.netAmount !== '' || columnMappings.amount !== '' ||
                        columnMappings.moneyIn !== ''   || columnMappings.moneyOut !== '';
      return hasDate && hasAmount;
    }
    return true;
  };

  // ── Complete ────────────────────────────────────────────────────────────
  const handleComplete = () => {
    if (mapperMode === 'ecommerce') {
      const { orders } = parseEcomOrders();
      onComplete(orders, {
        bankKey:        null,
        bankName:       selectedEcomProfile || 'E-commerce',
        columnMappings: ecomMappings,
        dateFormat,
        totalRows:      csvData.length,
        parsedCount:    orders.length,
        sourceFile:     file.name,
        mapperMode:     'ecommerce'
      });
      return;
    }

    // ── Bank mode (unchanged) ─────────────────────────────────────────
    console.log('[ColumnMapper handleComplete] file:', file?.name, 'csvData.length:', csvData.length, 'mappings:', JSON.stringify(columnMappings));
    const transactions = [];
    csvData.forEach((row) => {
      try {
        const dateStr = row[columnMappings.date];
        if (!dateStr) return;
        const parsedDate = parseDate(dateStr, dateFormat);
        if (isNaN(parsedDate.getTime())) return;

        let amount = 0;
        if (columnMappings.netAmount) {
          amount = parseAmount(row[columnMappings.netAmount]);
        } else if (columnMappings.moneyIn || columnMappings.moneyOut) {
          const moneyIn  = row[columnMappings.moneyIn];
          const moneyOut = row[columnMappings.moneyOut];
          if (moneyOut && String(moneyOut).trim() !== '') amount = -Math.abs(parseAmount(moneyOut));
          if (moneyIn  && String(moneyIn).trim()  !== '') amount =  Math.abs(parseAmount(moneyIn));
        } else if (columnMappings.amount) {
          amount = parseAmount(row[columnMappings.amount]);
        }
        if (amount === 0) return;

        let description = row[columnMappings.description] || '';
        if (!description && columnMappings.type) description = row[columnMappings.type] || '';
        if (!description) description = 'Transaction';

        transactions.push({
          date:        parsedDate,
          time:        row[columnMappings.time]      || '',
          description: description.trim(),
          amount,
          type:        row[columnMappings.type]      || '',
          category:    row[columnMappings.category]  || '',
          reference:   row[columnMappings.reference] || '',
          balance:     columnMappings.balance ? parseAmount(row[columnMappings.balance]) : null,
          sourceFile:  file.name
        });
      } catch { /* skip errored rows */ }
    });

    saveMappings(); // persist for future files with same headers
    onComplete(transactions, {
      bankKey:        selectedBank,
      bankName:       BANK_FORMATS[selectedBank]?.name || 'Custom',
      columnMappings, dateFormat,
      totalRows:      csvData.length,
      parsedCount:    transactions.length,
      sourceFile:     file.name
    });
  };

  // ══════════════════════════════════════════════════════════════════════
  //  Render helpers
  // ══════════════════════════════════════════════════════════════════════

  const StepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-6">
      {[1, 2, 3].map((s) => (
        <React.Fragment key={s}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
            s === step ? 'bg-indigo-600 text-white' : s < step ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
          }`}>
            {s < step ? <Check className="w-4 h-4" /> : s}
          </div>
          {s < 3 && <div className={`w-12 h-1 rounded ${s < step ? 'bg-green-500' : 'bg-gray-200'}`} />}
        </React.Fragment>
      ))}
    </div>
  );

  // ── Step 1 · Bank selection (unchanged) ────────────────────────────────
  const renderBankSelection = () => (
    <div>
      <h4 className="text-lg font-semibold text-gray-800 mb-2">Select Your Bank</h4>
      <p className="text-sm text-gray-500 mb-4">
        Choose your bank to auto-fill column mappings, or select "Generic CSV" for custom formats.
      </p>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search banks..."
          value={bankSearchQuery}
          onChange={(e) => setBankSearchQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
        {filteredBanks.map((bank) => (
          <button
            key={bank.key}
            onClick={() => handleBankSelect(bank.key)}
            className={`p-3 rounded-lg border-2 text-left transition-all flex items-center gap-2 ${
              selectedBank === bank.key
                ? 'border-indigo-500 bg-indigo-50'
                : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
            }`}
          >
            <span className={`w-3 h-3 rounded-full flex-shrink-0 ${bank.color}`}></span>
            <span className="text-sm font-medium text-gray-800 truncate">{bank.name}</span>
          </button>
        ))}
      </div>
      {filteredBanks.length === 0 && (
        <p className="text-center text-gray-500 py-4">No banks match your search</p>
      )}
    </div>
  );

  // ── Step 1 · E-commerce profile picker ────────────────────────────────
  const renderEcomProfileSelection = () => {
    const ecomProfs = profiles.filter(p => p.mode === 'ecommerce');
    return (
      <div>
        <h4 className="text-lg font-semibold text-gray-800 mb-2">Select a Platform Profile</h4>
        <p className="text-sm text-gray-500 mb-4">
          Choose a preset to auto-fill field mappings, or click Next to map columns manually.
        </p>
        {ecomProfs.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {ecomProfs.map((profile) => (
              <div key={profile.name} className="relative group">
                <button
                  onClick={() => handleEcomProfileSelect(profile)}
                  className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                    selectedEcomProfile === profile.name
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-sm font-medium text-gray-800">{profile.name}</span>
                </button>
                {/* Delete profile button — visible on hover */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteProfile(profile.name);
                    refreshProfiles();
                    if (selectedEcomProfile === profile.name) setSelectedEcomProfile(null);
                  }}
                  className="absolute top-1.5 right-1.5 p-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete profile"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 py-4 text-center">
            No profiles saved yet. Click Next to map columns manually.
          </p>
        )}
      </div>
    );
  };

  // ── Step 2 · Bank column mapping (unchanged) ───────────────────────────
  const renderColumnMapping = () => {
    const handleAmountApproachChange = (approach) => {
      setAmountApproach(approach);
      setColumnMappings(prev => ({ ...prev, amount: '', netAmount: '', moneyIn: '', moneyOut: '' }));
    };

    const requiredFields = [
      { key: 'date',        label: 'Transaction Date',              required: true  },
      { key: 'description', label: 'Description of the transaction', required: false },
    ];
    const optionalFields = [
      { key: 'time',      label: 'Time of the transaction', required: false },
      { key: 'type',      label: 'Transaction Type',        required: false },
      { key: 'category',  label: 'Category',                required: false },
      { key: 'reference', label: 'Reference / Notes',       required: false },
      { key: 'balance',   label: 'Balance',                 required: false },
    ];

    const renderFieldSelect = (field) => (
      <div key={field.key} className="flex items-start gap-2">
        <div className="w-44 flex-shrink-0">
          <label className="text-sm text-gray-700">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        </div>
        <select
          value={columnMappings[field.key]}
          onChange={(e) => handleMappingChange(field.key, e.target.value)}
          className={`flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 ${
            field.required && !columnMappings[field.key] ? 'border-red-300' : 'border-gray-300'
          }`}
        >
          <option value="">-- Select Column --</option>
          {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
      </div>
    );

    const AmountOption = ({ value, label, children }) => {
      const isSelected = amountApproach === value;
      const isDisabled = amountApproach !== null && !isSelected;
      return (
        <div className={`border rounded-lg p-3 transition-all ${
          isSelected  ? 'border-indigo-400 bg-indigo-50'
          : isDisabled? 'border-gray-200 bg-gray-50 opacity-40'
          :             'border-gray-200 hover:border-indigo-300'
        }`}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="amountApproach" value={value}
              checked={isSelected} onChange={() => handleAmountApproachChange(value)}
              className="text-indigo-600" />
            <span className="text-sm font-medium text-gray-800">{label}</span>
          </label>
          {isSelected && <div className="mt-2 pl-6 space-y-2">{children}</div>}
        </div>
      );
    };

    const InlineSelect = ({ fieldKey, placeholder = '-- Select Column --' }) => (
      <select
        value={columnMappings[fieldKey]}
        onChange={(e) => handleMappingChange(fieldKey, e.target.value)}
        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
      >
        <option value="">{placeholder}</option>
        {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    );

    return (
      <div>
        <h4 className="text-lg font-semibold text-gray-800 mb-2">Map Your Columns</h4>
        <p className="text-sm text-gray-500 mb-4">
          To ensure the app accurately reads your uploaded file, please match the required fields with the header columns in your spreadsheet
        </p>

        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <label className="block text-sm font-medium text-gray-700 mb-1">Date Format</label>
          <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
            <option value="DD/MM/YYYY">DD/MM/YYYY (UK)</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
            <option value="DD-MM-YYYY">DD-MM-YYYY</option>
            <option value="DD.MM.YYYY">DD.MM.YYYY (European)</option>
          </select>
        </div>

        <div className="space-y-3">
          <div className="border-b pb-3">{requiredFields.map(renderFieldSelect)}</div>

          <div className="border-b pb-3">
            <p className="text-xs font-medium text-gray-500 uppercase mb-2">
              Amount <span className="text-red-500">*</span>
            </p>
            <div className="space-y-2">
              <AmountOption value="single_column" label="Single column">
                <InlineSelect fieldKey="netAmount" placeholder="-- Select column --" />
              </AmountOption>
              <AmountOption value="two_columns" label="Two columns (Money In + Money Out)">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-16">Money In</span>
                  <InlineSelect fieldKey="moneyIn" placeholder="-- Select column --" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-16">Money Out</span>
                  <InlineSelect fieldKey="moneyOut" placeholder="-- Select column --" />
                </div>
              </AmountOption>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 uppercase mb-2">Optional Fields</p>
            {optionalFields.map(renderFieldSelect)}
          </div>
        </div>
      </div>
    );
  };

  // ── Step 2 · E-commerce column mapping ────────────────────────────────
  const renderEcomMapping = () => {
    const fields = [
      { key: 'order_id',    label: 'Order ID',         required: true  },
      { key: 'order_date',  label: 'Order date',        required: true  },
      { key: 'fulfil_date', label: 'Fulfilment date',   required: false },
      { key: 'customer',    label: 'Customer',          required: false },
      { key: 'product',     label: 'Product',           required: false },
      { key: 'amount',      label: 'Amount',            required: true  },
      { key: 'status',      label: 'Status',            required: false },
      { key: 'channel',     label: 'Sales channel',     required: false },
    ];

    return (
      <div>
        <h4 className="text-lg font-semibold text-gray-800 mb-2">Map Your Columns</h4>
        <p className="text-sm text-gray-500 mb-4">
          Match the required fields with the columns in your order export.
        </p>

        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <label className="block text-sm font-medium text-gray-700 mb-1">Date Format</label>
          <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
            <option value="YYYY-MM-DD">YYYY-MM-DD (ISO / Shopify)</option>
            <option value="DD/MM/YYYY">DD/MM/YYYY (UK)</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
            <option value="DD-MM-YYYY">DD-MM-YYYY</option>
          </select>
        </div>

        <div className="space-y-3">
          {fields.map((field) => (
            <div key={field.key} className="flex items-start gap-2">
              <div className="w-36 flex-shrink-0 pt-2">
                <label className="text-sm text-gray-700">
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </label>
              </div>
              <select
                value={ecomMappings[field.key]}
                onChange={(e) => setEcomMappings(prev => ({ ...prev, [field.key]: e.target.value }))}
                className={`flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 ${
                  field.required && !ecomMappings[field.key] ? 'border-red-300' : 'border-gray-300'
                }`}
              >
                <option value="">-- Select Column --</option>
                {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          ))}
        </div>

        {/* Additional columns */}
        <div className="mt-6 pt-4 border-t border-gray-200">
          <p className="text-sm font-medium text-gray-700 mb-3">Additional columns</p>
          <p className="text-xs text-gray-500 mb-3">
            Map extra columns from your CSV that aren't covered by the standard fields above.
          </p>

          {(() => {
            const assignedCols = new Set(Object.values(ecomMappings).filter(v => v));
            const unassignedCols = csvHeaders.filter(h => !assignedCols.has(h));

            return (
              <div className="space-y-2">
                {customColumns.map((col, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                    <div className="flex-1 grid grid-cols-3 gap-2">
                      <div className="text-sm text-gray-600 px-2 py-1 bg-white rounded border border-gray-200">
                        {col.csv_col}
                      </div>
                      <input
                        type="text"
                        placeholder="Custom label"
                        value={col.label}
                        onChange={(e) => {
                          const newCols = [...customColumns];
                          newCols[idx].label = e.target.value;
                          setCustomColumns(newCols);
                        }}
                        className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-indigo-500"
                      />
                      <div className="flex items-center gap-3 text-xs">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={col.as_filter}
                            onChange={(e) => {
                              const newCols = [...customColumns];
                              newCols[idx].as_filter = e.target.checked;
                              setCustomColumns(newCols);
                            }}
                            className="w-3.5 h-3.5 text-indigo-600 rounded"
                          />
                          <span className="text-gray-600">Filter</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={col.in_export}
                            onChange={(e) => {
                              const newCols = [...customColumns];
                              newCols[idx].in_export = e.target.checked;
                              setCustomColumns(newCols);
                            }}
                            className="w-3.5 h-3.5 text-indigo-600 rounded"
                          />
                          <span className="text-gray-600">Export</span>
                        </label>
                      </div>
                    </div>
                    <button
                      onClick={() => setCustomColumns(customColumns.filter((_, i) => i !== idx))}
                      className="p-1 text-gray-400 hover:text-red-500 rounded"
                      title="Remove"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                {unassignedCols.length > 0 && (
                  <button
                    onClick={() => {
                      const nextCol = unassignedCols.find(col =>
                        !customColumns.some(c => c.csv_col === col)
                      );
                      if (nextCol) {
                        setCustomColumns([...customColumns, {
                          csv_col: nextCol,
                          label: '',
                          as_filter: false,
                          in_export: true
                        }]);
                      }
                    }}
                    className="text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
                  >
                    + Map additional column
                  </button>
                )}
              </div>
            );
          })()}
        </div>

        {/* Save as profile */}
        {!showSaveProfile ? (
          <button
            onClick={() => { setShowSaveProfile(true); setSaveProfileName(selectedEcomProfile || ''); }}
            className="mt-4 text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            + Save as profile
          </button>
        ) : (
          <div className="mt-4 flex items-center gap-2 p-3 bg-indigo-50 rounded-lg border border-indigo-200">
            <input
              value={saveProfileName}
              onChange={(e) => setSaveProfileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveProfileConfirm()}
              placeholder="Profile name (e.g. My Shopify Store)"
              className="flex-1 px-3 py-1.5 border border-indigo-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
            <button
              onClick={handleSaveProfileConfirm}
              disabled={!saveProfileName.trim()}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={() => setShowSaveProfile(false)}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── Step 3 · Preview (mode-aware) ──────────────────────────────────────
  const renderPreview = () => {
    const isEcom     = mapperMode === 'ecommerce';
    const totalCount = isEcom
      ? parseEcomOrders().orders.length
      : parseTransactions().transactions.length;

    return (
      <div>
        <h4 className="text-lg font-semibold text-gray-800 mb-2">
          Preview {isEcom ? 'Orders' : 'Transactions'}
        </h4>
        <p className="text-sm text-gray-500 mb-4">
          Review the parsed {isEcom ? 'orders' : 'transactions'} before importing.
        </p>

        {parseErrors.length > 0 && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2 text-amber-800 mb-1">
              <AlertTriangle className="w-4 h-4" />
              <span className="font-medium">Some rows couldn't be parsed</span>
            </div>
            <ul className="text-sm text-amber-700 ml-6">
              {parseErrors.map((err, idx) => <li key={idx}>Row {err.row}: {err.error}</li>)}
            </ul>
          </div>
        )}

        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Date</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">
                    {isEcom ? 'Customer / Product' : 'Description'}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-gray-700">Amount</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">
                    {isEcom ? 'Status' : 'Type'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {previewTransactions.map((t, idx) => {
                  const dateVal = isEcom ? t.order_date : t.date;
                  const dateStr = dateVal instanceof Date && !isNaN(dateVal)
                    ? dateVal.toLocaleDateString('en-GB')
                    : '—';
                  const descStr = isEcom
                    ? [t.customer, t.product].filter(Boolean).join(' · ') || '—'
                    : (t.description || '—');
                  const typeStr = isEcom ? (t.status || '—') : (t.type || '—');
                  return (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-600">{dateStr}</td>
                      <td className="px-3 py-2 text-gray-900 max-w-xs truncate">{descStr}</td>
                      <td className={`px-3 py-2 text-right font-medium ${t.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {t.amount >= 0 ? '+' : ''}£{Math.abs(t.amount).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{typeStr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {previewTransactions.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-amber-500" />
            <p>No {isEcom ? 'orders' : 'transactions'} could be parsed with current settings.</p>
            <p className="text-sm">Please go back and adjust your column mappings.</p>
          </div>
        )}

        {previewTransactions.length > 0 && (
          <p className="text-sm text-gray-500 mt-2 text-center">
            Showing {previewTransactions.length} of {totalCount} {isEcom ? 'orders' : 'transactions'}
          </p>
        )}
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════════════
  //  Main render
  // ══════════════════════════════════════════════════════════════════════

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8 flex flex-col items-center">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
          <p className="text-gray-700">Reading file...</p>
        </div>
      </div>
    );
  }

  const importCount = mapperMode === 'ecommerce'
    ? parseEcomOrders().orders.length
    : parseTransactions().transactions.length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">

        {/* ── Header ── */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Columns className="w-6 h-6 text-indigo-600" />
              Column Mapper
              {queueRemaining > 0 && (
                <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">
                  +{queueRemaining} more file{queueRemaining !== 1 ? 's' : ''} queued
                </span>
              )}
            </h3>
            <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* File info + detection badge */}
          <div className="flex items-center gap-2 text-sm text-gray-500 flex-wrap">
            <FileText className="w-4 h-4" />
            <span>{file.name}</span>
            <span className="text-gray-300">•</span>
            <span>{csvData.length} rows</span>
            <span className="text-gray-300">•</span>
            <span>{csvHeaders.length} columns</span>
            {detectedPlatform && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                detectedPlatform === 'bank format'
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                Detected: {detectedPlatform}
              </span>
            )}
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => handleModeSwitch('bank')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-medium border transition-colors ${
                mapperMode === 'bank'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400 hover:text-indigo-600'
              }`}
            >
              Bank transactions
            </button>
            <button
              onClick={() => handleModeSwitch('ecommerce')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-medium border transition-colors ${
                mapperMode === 'ecommerce'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400 hover:text-indigo-600'
              }`}
            >
              E-commerce orders
            </button>
          </div>

          <StepIndicator />
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && mapperMode === 'bank'      && renderBankSelection()}
          {step === 1 && mapperMode === 'ecommerce' && renderEcomProfileSelection()}
          {step === 2 && mapperMode === 'bank'      && renderColumnMapping()}
          {step === 2 && mapperMode === 'ecommerce' && renderEcomMapping()}
          {step === 3 && renderPreview()}
        </div>

        {/* ── Footer ── */}
        <div className="p-6 border-t border-gray-200 flex justify-between">
          <button
            onClick={() => step > 1 ? setStep(step - 1) : onCancel()}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            <ChevronLeft className="w-4 h-4" />
            {step === 1 ? 'Cancel' : 'Back'}
          </button>

          <button
            onClick={() => step < 3 ? setStep(step + 1) : handleComplete()}
            disabled={!canProceed()}
            className={`px-6 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors ${
              canProceed()
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {step === 3 ? (
              <>
                Import {importCount} {mapperMode === 'ecommerce' ? 'Orders' : 'Transactions'}
                <Check className="w-4 h-4" />
              </>
            ) : (
              <>
                Next
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ColumnMapper;
