/**
 * sheets.js — Azusa
 * Google Sheets API v4 wrapper.
 * Handles all CRUD operations against the `lands` tab.
 *
 * Header-aware: column positions are derived from the sheet's header row,
 * so columns can be in any order or have extra columns without breaking.
 */

const Sheets = (() => {

  const SHEET_NAME = 'lands';
  const COLS = ['id','set_code','set_name','parent_set_code','collector_num',
                 'land_type','scryfall_id','finish','status','favourite','price'];

  // Set by init()
  let sheetId   = null;
  let getToken  = null; // function that returns a valid OAuth access token

  // Header mapping: populated by ensureHeaders()
  // colIndex[colName] = 0-based column index
  // colLetter[colName] = spreadsheet column letter (A, B, …, Z, AA, …)
  let headerRow = [];
  let colIndex  = {};
  let colLetter = {};
  let lastCol   = 'A'; // letter of the rightmost known column

  // ---------------------------------------------------------------------------
  // Init — call once after OAuth sign-in
  // ---------------------------------------------------------------------------
  function init(spreadsheetId, tokenFn) {
    sheetId  = spreadsheetId;
    getToken = tokenFn;
  }

  // ---------------------------------------------------------------------------
  // Internal fetch wrapper with auth header
  // ---------------------------------------------------------------------------
  async function apiFetch(url, options = {}) {
    const token = getToken();
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message ?? `Sheets API error ${res.status}`);
    }
    // 204 No Content (DELETE) has no body
    if (res.status === 204) return null;
    return res.json();
  }

  // ---------------------------------------------------------------------------
  // Base URL helpers
  // ---------------------------------------------------------------------------
  function sheetsBase() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  }

  function rangeUrl(range, params = '') {
    return `${sheetsBase()}/values/${encodeURIComponent(range)}${params}`;
  }

  // ---------------------------------------------------------------------------
  // Convert a 0-based column index to a spreadsheet letter (0→A, 25→Z, 26→AA)
  // ---------------------------------------------------------------------------
  function indexToLetter(i) {
    let s = '';
    let n = i;
    while (n >= 0) {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  }

  // ---------------------------------------------------------------------------
  // Build the colIndex / colLetter maps from a header row array.
  // ---------------------------------------------------------------------------
  function buildHeaderMap(header) {
    headerRow = header;
    colIndex  = {};
    colLetter = {};
    for (let i = 0; i < header.length; i++) {
      colIndex[header[i]]  = i;
      colLetter[header[i]] = indexToLetter(i);
    }
    lastCol = indexToLetter(header.length - 1);
  }

  // ---------------------------------------------------------------------------
  // Ensure header row exists and contains all expected columns.
  // Appends any missing columns to the right.
  // ---------------------------------------------------------------------------
  async function ensureHeaders() {
    // Read a wide range so we don't miss columns
    const data = await apiFetch(rangeUrl(`${SHEET_NAME}!1:1`));
    const existing = data.values?.[0] ?? [];

    if (existing.length === 0) {
      // Brand new sheet — write full header
      await apiFetch(
        rangeUrl(`${SHEET_NAME}!A1`, '?valueInputOption=RAW'),
        {
          method: 'PUT',
          body: JSON.stringify({ values: [COLS] }),
        }
      );
      buildHeaderMap(COLS);
      return;
    }

    // Check for missing columns
    const missing = COLS.filter(c => !existing.includes(c));
    if (missing.length > 0) {
      const startLetter = indexToLetter(existing.length);
      const endLetter   = indexToLetter(existing.length + missing.length - 1);
      await apiFetch(
        rangeUrl(`${SHEET_NAME}!${startLetter}1:${endLetter}1`, '?valueInputOption=RAW'),
        {
          method: 'PUT',
          body: JSON.stringify({ values: [missing] }),
        }
      );
      buildHeaderMap([...existing, ...missing]);
    } else {
      buildHeaderMap(existing);
    }
  }

  // ---------------------------------------------------------------------------
  // Read all rows from the sheet. Returns array of plain objects.
  // ---------------------------------------------------------------------------
  async function readAll() {
    await ensureHeaders();
    const data = await apiFetch(rangeUrl(`${SHEET_NAME}!A:${lastCol}`));
    const rows = data.values ?? [];
    if (rows.length <= 1) return []; // header only

    const [, ...body] = rows;
    return body.map((row, i) => {
      const obj = {};
      for (const col of COLS) {
        const ci = colIndex[col];
        obj[col] = ci !== undefined ? (row[ci] ?? '') : '';
      }
      // Coerce types
      obj.favourite = obj.favourite === 'TRUE';
      obj._rowIndex = i + 2; // 1-based, skip header
      return obj;
    });
  }

  // ---------------------------------------------------------------------------
  // Build a row array ordered by the sheet's header, from a card object.
  // ---------------------------------------------------------------------------
  function cardToRow(card, idOverride) {
    const row = new Array(headerRow.length).fill('');
    for (const col of COLS) {
      const ci = colIndex[col];
      if (ci === undefined) continue;
      if (col === 'id' && idOverride) { row[ci] = idOverride; continue; }
      const val = card[col];
      if (col === 'favourite') { row[ci] = val ? 'TRUE' : 'FALSE'; continue; }
      row[ci] = val ?? '';
    }
    return row;
  }

  // ---------------------------------------------------------------------------
  // Append a new card row. `card` is a plain object with keys matching COLS.
  // Generates a UUID for the id field.
  // ---------------------------------------------------------------------------
  async function appendCard(card) {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const row = cardToRow(card, id);

    await apiFetch(
      `${sheetsBase()}/values/${encodeURIComponent(`${SHEET_NAME}!A:${lastCol}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        body: JSON.stringify({ values: [row] }),
      }
    );

    return { ...card, id };
  }

  // ---------------------------------------------------------------------------
  // Append multiple card rows in a single API call.
  // ---------------------------------------------------------------------------
  async function appendCards(cards) {
    const results = [];
    const rows = cards.map(card => {
      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
      results.push({ ...card, id });
      return cardToRow(card, id);
    });

    await apiFetch(
      `${sheetsBase()}/values/${encodeURIComponent(`${SHEET_NAME}!A:${lastCol}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        body: JSON.stringify({ values: rows }),
      }
    );

    return results;
  }

  // ---------------------------------------------------------------------------
  // Update a single card by its sheet row index.
  // `updates` is a partial object — only provided keys are changed.
  // ---------------------------------------------------------------------------
  async function updateCard(rowIndex, updates) {
    // First read the current row
    const data = await apiFetch(rangeUrl(`${SHEET_NAME}!A${rowIndex}:${lastCol}${rowIndex}`));
    const current = data.values?.[0] ?? [];

    const row = [...current];
    // Extend if needed
    while (row.length < headerRow.length) row.push('');

    for (const col of COLS) {
      if (!(col in updates)) continue;
      const ci = colIndex[col];
      if (ci === undefined) continue;
      const val = updates[col];
      row[ci] = col === 'favourite' ? (val ? 'TRUE' : 'FALSE') : (val ?? '');
    }

    await apiFetch(
      rangeUrl(`${SHEET_NAME}!A${rowIndex}:${lastCol}${rowIndex}`, '?valueInputOption=RAW'),
      {
        method: 'PUT',
        body: JSON.stringify({ values: [row] }),
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Delete a card by its sheet row index.
  // Uses batchUpdate to delete the entire row (not just clear it).
  // ---------------------------------------------------------------------------
  async function deleteCard(rowIndex) {
    // Need the sheet's internal sheetId (numeric), not the spreadsheet ID
    const meta = await apiFetch(
      `${sheetsBase()}?fields=sheets.properties`
    );
    const sheetMeta = meta.sheets?.find(
      s => s.properties.title === SHEET_NAME
    );
    const numericSheetId = sheetMeta?.properties?.sheetId ?? 0;

    await apiFetch(
      `${sheetsBase()}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [{
            deleteDimension: {
              range: {
                sheetId:    numericSheetId,
                dimension:  'ROWS',
                startIndex: rowIndex - 1, // 0-based
                endIndex:   rowIndex,
              },
            },
          }],
        }),
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Toggle favourite on one or more row indices.
  // Batch updates all in a single Sheets API call for efficiency.
  // ---------------------------------------------------------------------------
  async function setFavourite(rowIndices, value) {
    const letter = colLetter['favourite'];
    const data = { valueInputOption: 'RAW', data: [] };
    for (const rowIndex of rowIndices) {
      data.data.push({
        range:  `${SHEET_NAME}!${letter}${rowIndex}`,
        values: [[value ? 'TRUE' : 'FALSE']],
      });
    }
    await apiFetch(
      `${sheetsBase()}/values:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Set status (have/want) on one row.
  // ---------------------------------------------------------------------------
  async function setStatus(rowIndex, status) {
    const letter = colLetter['status'];
    await apiFetch(
      rangeUrl(`${SHEET_NAME}!${letter}${rowIndex}`, '?valueInputOption=RAW'),
      {
        method: 'PUT',
        body: JSON.stringify({ values: [[status]] }),
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Check for a duplicate before appending.
  // Returns the existing card object if found, null otherwise.
  // ---------------------------------------------------------------------------
  function findDuplicate(allCards, setCode, collectorNum, finish) {
    return allCards.find(c =>
      c.set_code      === setCode &&
      c.collector_num === collectorNum &&
      c.finish        === finish
    ) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Batch-update prices for multiple cards in a single API call.
  // `entries` is an array of { rowIndex, price }.
  // ---------------------------------------------------------------------------
  async function updatePrices(entries) {
    if (entries.length === 0) return;
    const letter = colLetter['price'];
    const data = { valueInputOption: 'RAW', data: [] };
    for (const { rowIndex, price } of entries) {
      data.data.push({
        range:  `${SHEET_NAME}!${letter}${rowIndex}`,
        values: [[price ?? '']],
      });
    }
    await apiFetch(
      `${sheetsBase()}/values:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  }

  // ---------------------------------------------------------------------------
  // CSV parsing for public (unauthenticated) sheet access
  // ---------------------------------------------------------------------------
  function parseCSV(csvText) {
    const lines = [];
    let current = '';
    let inQuotes = false;
    // Split into rows handling quoted newlines
    for (let i = 0; i < csvText.length; i++) {
      const ch = csvText[i];
      if (ch === '"') {
        if (inQuotes && csvText[i + 1] === '"') {
          current += '"'; i++; // escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === '\n' && !inQuotes) {
        lines.push(current);
        current = '';
      } else if (ch === '\r' && !inQuotes) {
        // skip CR
      } else {
        current += ch;
      }
    }
    if (current) lines.push(current);

    if (lines.length <= 1) return [];

    // Parse each line into fields
    function splitRow(line) {
      const fields = [];
      let field = '';
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (q && line[i + 1] === '"') { field += '"'; i++; }
          else q = !q;
        } else if (ch === ',' && !q) {
          fields.push(field); field = '';
        } else {
          field += ch;
        }
      }
      fields.push(field);
      return fields;
    }

    const header = splitRow(lines[0]);
    return lines.slice(1).filter(l => l.trim()).map((line, i) => {
      const vals = splitRow(line);
      const obj = {};
      COLS.forEach((col, ci) => {
        const hi = header.indexOf(col);
        obj[col] = hi >= 0 ? (vals[hi] ?? '') : '';
      });
      obj.favourite = obj.favourite === 'TRUE';
      obj._rowIndex = i + 2;
      return obj;
    });
  }

  async function readPublicCSV(sheetId) {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAME}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error('This sheet is not publicly shared or does not exist.');
    }
    const text = await res.text();
    return parseCSV(text);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  return {
    init,
    readAll,
    readPublicCSV,
    appendCard,
    appendCards,
    updateCard,
    deleteCard,
    setFavourite,
    setStatus,
    updatePrices,
    findDuplicate,
    ensureHeaders,
  };

})();
