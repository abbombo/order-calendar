/**
 * Bank Format Definitions
 * 
 * This file contains format definitions for various UK and international banks.
 * Each format defines the expected column headers and how to map them to our
 * standardized transaction format.
 * 
 * To add a new bank format:
 * 1. Export a CSV from the bank
 * 2. Identify the column headers
 * 3. Add a new entry to BANK_FORMATS with the appropriate mappings
 */

import Papa from 'papaparse';

// Standardized field names we use internally
// date, time, description, amount, type, category, reference, balance

export const BANK_FORMATS = {
  // ===== UK BANKS =====
  
  monzo: {
    name: 'Monzo',
    delimiter: ',',
    dateFormat: 'DD/MM/YYYY',
    headers: {
      date: ['date', 'transaction date'],
      time: ['time'],
      description: ['name', 'description', 'merchant'],
      type: ['type', 'transaction type'],
      category: ['category', 'spending category'],
      reference: ['notes', 'reference', 'notes and #tags'],
      // Monzo uses split columns for money in/out
      moneyIn: ['money in', 'money in (gbp)'],
      moneyOut: ['money out', 'money out (gbp)'],
      balance: ['balance', 'balance (gbp)']
    }
  },

  starling: {
    name: 'Starling Bank',
    delimiter: ',',
    dateFormat: 'DD/MM/YYYY',
    headers: {
      date: ['date'],
      time: ['time'],
      description: ['counter party', 'counterparty', 'description'],
      type: ['type', 'transaction type'],
      category: ['spending category', 'category'],
      reference: ['reference', 'notes'],
      amount: ['amount', 'amount (gbp)'],
      balance: ['balance', 'balance (gbp)']
    }
  },

  revolut: {
    name: 'Revolut',
    delimiter: ',',
    dateFormat: 'YYYY-MM-DD',
    // Revolut uses a single signed 'Amount' column (negative = out, positive = in)
    // It also has multi-currency accounts; we filter to Payment currency amount
    // EXCHANGE rows appear twice (once per account) — deduplicated by ID + account
    deduplicateByField: 'ID', // Skip rows where we've seen this ID + Account combo
    accountFilterField: 'Account', // Optional: user can filter to one account
    headers: {
      date: ['date started (utc)', 'started date', 'date completed (utc)', 'completed date', 'date'],
      time: ['time started (utc)', 'started time'],
      description: ['description', 'merchant'],
      type: ['type'],
      category: ['category'],
      reference: ['reference', 'notes'],
      netAmount: ['amount', 'total amount'], // signed: negative = debit, positive = credit
      balance: ['balance'],
      currency: ['payment currency', 'currency']
    }
  },

  barclays: {
    name: 'Barclays',
    delimiter: ',',
    dateFormat: 'DD/MM/YYYY',
    headers: {
      date: ['date', 'transaction date'],
      description: ['description', 'memo', 'narrative'],
      type: ['type', 'transaction type'],
      reference: ['reference'],
      amount: ['amount', 'money'],
      balance: ['balance']
    }
  },

  hsbc: {
    name: 'HSBC',
    delimiter: ',',
    dateFormat: 'DD/MM/YYYY',
    headers: {
      date: ['date', 'transaction date'],
      description: ['description', 'payee', 'narrative'],
      type: ['type', 'transaction type'],
      reference: ['reference'],
      amount: ['amount'],
      balance: ['balance']
    }
  },

  lloyds: {
    name: 'Lloyds / Halifax / Bank of Scotland',
    delimiter: ',',
    dateFormat: 'DD/MM/YYYY',
    headers: {
      date: ['date', 'transaction date'],
      description: ['description', 'narrative'],
      type: ['type', 'transaction type'],
      reference: ['reference'],
      // Lloyds often uses debit/credit columns
      debit: ['debit', 'debit amount', 'money out'],
      credit: ['credit', 'credit amount', 'money in'],
      balance: ['balance']
    }
  },

  natwest: {
    name: 'NatWest / RBS',
    delimiter: ',',
    dateFormat: 'DD/MM/YYYY',
    headers: {
      date: ['date', 'transaction date'],
      description: ['description', 'narrative'],
      type: ['type', 'transaction type'],
      reference: ['reference'],
      amount: ['value', 'amount'],
      balance: ['balance', 'account balance']
    }
  },

  santander: {
    name: 'Santander UK',
    delimiter: ',',
    dateFormat: 'DD/MM/YYYY',
    headers: {
      date: ['date', 'transaction date'],
      description: ['description', 'narrative'],
      type: ['type'],
      reference: ['reference'],
      moneyIn: ['money in', 'credit'],
      moneyOut: ['money out', 'debit'],
      balance: ['balance']
    }
  },

  nationwide: {
    name: 'Nationwide',
    delimiter: ',',
    dateFormat: 'DD/MM/YYYY',
    headers: {
      date: ['date'],
      description: ['description', 'transactions'],
      type: ['type', 'transaction type'],
      reference: ['reference'],
      // Nationwide often uses paid in/paid out
      moneyIn: ['paid in', 'money in', 'credit'],
      moneyOut: ['paid out', 'money out', 'debit'],
      balance: ['balance']
    }
  },

  // ===== EUROPEAN BANKS =====
  
  europeanGeneric: {
    name: 'European Bank (Semicolon)',
    delimiter: ';',
    dateFormat: 'DD/MM/YYYY',
    headers: {
      date: ['date', 'datum', 'fecha', 'data'],
      description: ['description', 'beschreibung', 'descripcion', 'descrizione', 'bezeichnung', 'verwendungszweck'],
      type: ['type', 'typ', 'tipo', 'art'],
      reference: ['reference', 'referenz', 'referencia'],
      amount: ['amount', 'betrag', 'importe', 'importo', 'summe'],
      balance: ['balance', 'saldo', 'kontostand']
    }
  },

  n26: {
    name: 'N26',
    delimiter: ',',
    dateFormat: 'YYYY-MM-DD',
    headers: {
      date: ['date', 'booking date'],
      description: ['payee', 'partner name', 'description'],
      type: ['type', 'transaction type'],
      category: ['category'],
      reference: ['reference', 'payment reference'],
      amount: ['amount (eur)', 'amount', 'money'],
      balance: ['balance']
    }
  },

  // ===== US BANKS =====
  
  chase: {
    name: 'Chase (US)',
    delimiter: ',',
    dateFormat: 'MM/DD/YYYY',
    headers: {
      date: ['transaction date', 'posting date', 'date'],
      description: ['description', 'merchant'],
      type: ['type', 'transaction type'],
      category: ['category'],
      reference: ['reference number'],
      amount: ['amount'],
      balance: ['balance']
    }
  },

  bankOfAmerica: {
    name: 'Bank of America',
    delimiter: ',',
    dateFormat: 'MM/DD/YYYY',
    headers: {
      date: ['date', 'posted date'],
      description: ['description', 'payee'],
      type: ['type'],
      reference: ['reference number', 'check number'],
      amount: ['amount'],
      balance: ['running bal.', 'balance']
    }
  },

  wellsFargo: {
    name: 'Wells Fargo',
    delimiter: ',',
    dateFormat: 'MM/DD/YYYY',
    headers: {
      date: ['date'],
      description: ['description'],
      amount: ['amount'],
      balance: ['balance']
    }
  },

  // ===== GENERIC FORMATS =====
  
  genericComma: {
    name: 'Generic CSV (Comma)',
    delimiter: ',',
    dateFormat: 'auto',
    headers: {
      date: ['date', 'transaction date', 'trans date', 'posted date', 'booking date', 'value date', 'datum'],
      time: ['time', 'transaction time'],
      description: ['description', 'name', 'merchant', 'payee', 'narrative', 'details', 'memo', 'particulars', 'beneficiary', 'counter party', 'counterparty', 'to/from', 'recipient', 'vendor'],
      type: ['type', 'transaction type', 'trans type', 'payment type', 'method'],
      category: ['category', 'spending category', 'merchant category', 'expense category'],
      reference: ['reference', 'notes', 'memo', 'comment', 'remarks', 'details', 'cheque number', 'check number'],
      amount: ['amount', 'value', 'sum', 'total', 'transaction amount', 'trans amount'],
      moneyIn: ['money in', 'credit', 'credits', 'deposits', 'paid in', 'received', 'cr'],
      moneyOut: ['money out', 'debit', 'debits', 'withdrawals', 'paid out', 'payment', 'dr'],
      balance: ['balance', 'running balance', 'account balance', 'available balance']
    }
  },

  genericSemicolon: {
    name: 'Generic CSV (Semicolon)',
    delimiter: ';',
    dateFormat: 'auto',
    headers: {
      date: ['date', 'transaction date', 'datum', 'fecha', 'data'],
      time: ['time'],
      description: ['description', 'name', 'merchant', 'payee', 'narrative', 'beschreibung', 'bezeichnung'],
      type: ['type', 'typ', 'art'],
      category: ['category', 'kategorie'],
      reference: ['reference', 'referenz', 'notes'],
      amount: ['amount', 'betrag', 'summe', 'value'],
      moneyIn: ['money in', 'credit', 'haben', 'eingang'],
      moneyOut: ['money out', 'debit', 'soll', 'ausgang'],
      balance: ['balance', 'saldo', 'kontostand']
    }
  }
};

/**
 * Detect the delimiter used in a CSV file
 * @param {string} content - The CSV file content
 * @returns {string} - The detected delimiter (',' or ';')
 */
export const detectDelimiter = (content) => {
  const firstLines = content.split('\n').slice(0, 5).join('\n');
  const semicolons = (firstLines.match(/;/g) || []).length;
  const commas = (firstLines.match(/,/g) || []).length;
  const tabs = (firstLines.match(/\t/g) || []).length;
  
  if (tabs > semicolons && tabs > commas) return '\t';
  if (semicolons > commas) return ';';
  return ',';
};

/**
 * Detect the date format used in a CSV file
 * @param {string} dateStr - A sample date string
 * @returns {string} - The detected format ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', etc.)
 */
export const detectDateFormat = (dateStr) => {
  if (!dateStr) return 'DD/MM/YYYY';
  
  // ISO format: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return 'YYYY-MM-DD';
  }
  
  // Check for slashes
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [first, second] = parts.map(p => parseInt(p, 10));
      
      // If first part > 12, it's DD/MM/YYYY
      if (first > 12) return 'DD/MM/YYYY';
      
      // If second part > 12, it's MM/DD/YYYY
      if (second > 12) return 'MM/DD/YYYY';
      
      // If third part is 4 digits and > 1900, check position
      if (parts[2].length === 4) {
        // Default to DD/MM/YYYY for UK
        return 'DD/MM/YYYY';
      }
      
      // If first part is 4 digits
      if (parts[0].length === 4) {
        return 'YYYY/MM/DD';
      }
    }
  }
  
  // Check for dashes (non-ISO)
  if (dateStr.includes('-') && !/^\d{4}-/.test(dateStr)) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const [first] = parts.map(p => parseInt(p, 10));
      if (first > 12) return 'DD-MM-YYYY';
      return 'MM-DD-YYYY';
    }
  }
  
  return 'DD/MM/YYYY'; // Default
};

/**
 * Parse a date string according to the detected format
 * @param {string} dateStr - The date string to parse
 * @param {string} format - The date format
 * @returns {Date} - The parsed date
 */
export const parseDate = (dateStr, format = 'auto') => {
  if (!dateStr) return new Date(NaN);
  
  // Clean the date string
  dateStr = dateStr.trim();
  
  // Auto-detect format if needed
  if (format === 'auto') {
    format = detectDateFormat(dateStr);
  }
  
  let day, month, year;
  
  if (format === 'YYYY-MM-DD' || /^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    // ISO format
    const parts = dateStr.split(/[-T]/);
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10) - 1;
    day = parseInt(parts[2], 10);
  } else if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (format === 'MM/DD/YYYY') {
      month = parseInt(parts[0], 10) - 1;
      day = parseInt(parts[1], 10);
      year = parseInt(parts[2], 10);
    } else if (format === 'YYYY/MM/DD') {
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10) - 1;
      day = parseInt(parts[2], 10);
    } else {
      // DD/MM/YYYY (default for UK)
      day = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10) - 1;
      year = parseInt(parts[2], 10);
    }
  } else if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (format === 'MM-DD-YYYY') {
      month = parseInt(parts[0], 10) - 1;
      day = parseInt(parts[1], 10);
      year = parseInt(parts[2], 10);
    } else {
      // DD-MM-YYYY
      day = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10) - 1;
      year = parseInt(parts[2], 10);
    }
  } else {
    // Try native parsing as fallback
    return new Date(dateStr);
  }
  
  // Handle 2-digit years
  if (year < 100) {
    year += year > 50 ? 1900 : 2000;
  }
  
  return new Date(year, month, day);
};

/**
 * Parse an amount string, handling various formats
 * @param {string} amountStr - The amount string
 * @returns {number} - The parsed amount
 */
export const parseAmount = (amountStr) => {
  if (amountStr === null || amountStr === undefined || amountStr === '') return 0;
  
  let str = String(amountStr).trim();
  
  // Handle parentheses notation for negative amounts: (1234.56) -> -1234.56
  const isParenthesesNegative = str.includes('(') && str.includes(')');
  if (isParenthesesNegative) {
    str = str.replace(/[()]/g, '');
  }
  
  // Remove currency symbols and spaces
  str = str.replace(/[£$€¥₹₽¥₩฿₫₺₴₦₨₱\s]/g, '');
  
  // Detect European format (1.234,56) vs US/UK format (1,234.56)
  // European: last separator is comma, or has dot as thousands separator
  const lastComma = str.lastIndexOf(',');
  const lastDot = str.lastIndexOf('.');
  
  if (lastComma > lastDot && lastComma > 0) {
    // European format: 1.234,56 -> 1234.56
    str = str.replace(/\./g, '').replace(',', '.');
  } else {
    // US/UK format: 1,234.56 -> 1234.56
    str = str.replace(/,/g, '');
  }
  
  const amount = parseFloat(str);
  
  if (isNaN(amount)) return 0;
  
  return isParenthesesNegative ? -Math.abs(amount) : amount;
};

/**
 * Find a matching header from a list of possible names
 * @param {string[]} actualHeaders - The actual headers from the CSV
 * @param {string[]} possibleNames - List of possible names for this field
 * @returns {string|null} - The matching header or null
 */
export const findMatchingHeader = (actualHeaders, possibleNames) => {
  if (!possibleNames) return null;
  
  const normalizedActual = actualHeaders.map(h => h.toLowerCase().trim());
  
  for (const name of possibleNames) {
    const normalizedName = name.toLowerCase().trim();
    
    // Exact match
    const exactIndex = normalizedActual.indexOf(normalizedName);
    if (exactIndex !== -1) {
      return actualHeaders[exactIndex];
    }
    
    // Partial match (header contains the name or vice versa)
    for (let i = 0; i < normalizedActual.length; i++) {
      if (normalizedActual[i].includes(normalizedName) || normalizedName.includes(normalizedActual[i])) {
        return actualHeaders[i];
      }
    }
  }
  
  return null;
};

/**
 * Detect which bank format best matches the CSV headers
 * @param {string[]} headers - The CSV headers
 * @param {string} delimiter - The detected delimiter
 * @returns {object} - The best matching bank format
 */
export const detectBankFormat = (headers, delimiter) => {
  let bestMatch = null;
  let bestScore = 0;
  
  // First, filter formats by delimiter
  const formatsByDelimiter = Object.entries(BANK_FORMATS).filter(([, format]) => 
    format.delimiter === delimiter
  );
  
  for (const [formatKey, format] of formatsByDelimiter) {
    let score = 0;
    let matchedFields = 0;
    
    // Score each format based on how many headers match
    for (const [field, possibleNames] of Object.entries(format.headers)) {
      if (findMatchingHeader(headers, possibleNames)) {
        matchedFields++;
        // Give extra weight to critical fields
        if (['date', 'amount', 'description', 'moneyIn', 'moneyOut'].includes(field)) {
          score += 2;
        } else {
          score += 1;
        }
      }
    }
    
    // Prefer formats with more matched fields
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { key: formatKey, format, score, matchedFields };
    }
  }
  
  // Fall back to generic format if no good match
  if (!bestMatch || bestScore < 3) {
    bestMatch = {
      key: delimiter === ';' ? 'genericSemicolon' : 'genericComma',
      format: delimiter === ';' ? BANK_FORMATS.genericSemicolon : BANK_FORMATS.genericComma,
      score: 0,
      matchedFields: 0
    };
  }
  
  return bestMatch;
};

/**
 * Parse a CSV row into a standardized transaction object
 * @param {object} row - The CSV row object
 * @param {string[]} headers - The original headers
 * @param {object} format - The bank format definition
 * @param {string} sourceFile - The source file name
 * @returns {object|null} - The parsed transaction or null if invalid
 */
export const parseTransaction = (row, headers, format, sourceFile) => {
  const formatHeaders = format.headers;
  
  // Find the actual header names that match our format
  const dateHeader = findMatchingHeader(headers, formatHeaders.date);
  const timeHeader = findMatchingHeader(headers, formatHeaders.time);
  const descHeader = findMatchingHeader(headers, formatHeaders.description);
  const typeHeader = findMatchingHeader(headers, formatHeaders.type);
  const categoryHeader = findMatchingHeader(headers, formatHeaders.category);
  const refHeader = findMatchingHeader(headers, formatHeaders.reference);
  const amountHeader = findMatchingHeader(headers, formatHeaders.amount);
  const netAmountHeader = findMatchingHeader(headers, formatHeaders.netAmount);
  const moneyInHeader = findMatchingHeader(headers, formatHeaders.moneyIn);
  const moneyOutHeader = findMatchingHeader(headers, formatHeaders.moneyOut);
  const balanceHeader = findMatchingHeader(headers, formatHeaders.balance);
  
  // Parse date
  const dateStr = row[dateHeader];
  const parsedDate = parseDate(dateStr, format.dateFormat);
  
  if (isNaN(parsedDate.getTime())) {
    return null; // Invalid date
  }
  
  // Parse amount — three strategies:
  // 1. netAmount: single signed column (negative = out, positive = in) — e.g. Revolut, Starling
  // 2. moneyIn / moneyOut: two separate columns — e.g. Monzo, Lloyds
  // 3. amount: single column that may already be signed or always positive
  let amount = 0;
  
  if (netAmountHeader) {
    // Signed single column — preserve sign as-is
    amount = parseAmount(row[netAmountHeader]);
  } else if (moneyInHeader || moneyOutHeader) {
    const moneyIn = row[moneyInHeader];
    const moneyOut = row[moneyOutHeader];
    
    if (moneyOut && String(moneyOut).trim() !== '') {
      amount = -Math.abs(parseAmount(moneyOut));
    }
    if (moneyIn && String(moneyIn).trim() !== '') {
      amount = Math.abs(parseAmount(moneyIn));
    }
  } else if (amountHeader) {
    amount = parseAmount(row[amountHeader]);
  }
  
  // Get description - try multiple fallbacks
  let description = row[descHeader] || '';
  if (!description && typeHeader) {
    description = row[typeHeader] || '';
  }
  if (!description) {
    description = 'Transaction';
  }
  
  return {
    date: parsedDate,
    time: row[timeHeader] || '',
    description: description.trim(),
    amount: amount,
    type: row[typeHeader] || '',
    category: row[categoryHeader] || '',
    reference: row[refHeader] || '',
    balance: balanceHeader ? parseAmount(row[balanceHeader]) : null,
    sourceFile: sourceFile
  };
};

/**
 * Main function to parse a bank CSV file
 * @param {string} content - The CSV file content
 * @param {string} fileName - The file name
 * @returns {object} - { transactions, format, stats }
 */
export const parseBankCSV = (content, fileName) => {
  // Detect delimiter
  const delimiter = detectDelimiter(content);
  
  // Parse with PapaParse
  const parseResult = Papa.parse(content, {
    header: true,
    delimiter: delimiter,
    dynamicTyping: false,
    skipEmptyLines: true
  });
  
  if (parseResult.errors.length > 0) {
    console.warn('[parseBankCSV] Parse warnings:', parseResult.errors);
  }
  
  const headers = parseResult.meta.fields || [];
  
  // Detect bank format
  const formatMatch = detectBankFormat(headers, delimiter);
  
  console.log('[parseBankCSV] Detected format:', formatMatch.format.name, '(score:', formatMatch.score, ')');
  console.log('[parseBankCSV] Headers:', headers);
  console.log('[parseBankCSV] Delimiter:', delimiter === '\t' ? 'TAB' : delimiter);
  
  // Parse transactions
  const transactions = [];
  let skipped = 0;
  
  // Deduplication for formats like Revolut that emit duplicate rows for EXCHANGE transactions
  // Key: ID + Account to allow the same transaction ID in different accounts (e.g. GBP Main vs EUR Main)
  const seenExchangeIds = new Set();
  const dedupeField = formatMatch.format.deduplicateByField;
  const accountField = formatMatch.format.accountFilterField;
  
  for (const row of parseResult.data) {
    // Deduplicate EXCHANGE rows: Revolut emits two rows per exchange (one per currency account).
    // We keep the first occurrence of each ID+Account pair and skip subsequent ones.
    if (dedupeField && row[dedupeField]) {
      const dedupeKey = `${row[dedupeField]}::${accountField ? (row[accountField] || '') : ''}`;
      if (seenExchangeIds.has(dedupeKey)) {
        skipped++;
        continue;
      }
      seenExchangeIds.add(dedupeKey);
    }

    const transaction = parseTransaction(row, headers, formatMatch.format, fileName);
    if (transaction) {
      transactions.push(transaction);
    } else {
      skipped++;
    }
  }
  
  console.log('[parseBankCSV] Parsed', transactions.length, 'transactions, skipped', skipped);
  
  return {
    transactions,
    format: formatMatch,
    stats: {
      total: parseResult.data.length,
      parsed: transactions.length,
      skipped: skipped,
      headers: headers,
      delimiter: delimiter
    }
  };
};

export default {
  BANK_FORMATS,
  detectDelimiter,
  detectDateFormat,
  parseDate,
  parseAmount,
  findMatchingHeader,
  detectBankFormat,
  parseTransaction,
  parseBankCSV
};
