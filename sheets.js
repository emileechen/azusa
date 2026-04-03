/**
 * sheets.js — Azusa
 * Google Sheets API v4 wrapper.
 * Handles all CRUD operations against the `lands` tab.
 */

const Sheets = (() => {

  const SHEET_NAME = 'lands';
  const COLS = ['id','set_code','set_name','parent_set_code','collector_num',
                 'land_type','scryfall_id','finish','status','favourite','drop_name','price'];

  // Set by init()
  let sheetId   = null;
  let getToken  = null; // function that returns a valid OAuth access token

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
  // Ensure header row exists. Called on first load.
  // If Row 1 is empty, writes the header.
  // ---------------------------------------------------------------------------
  async function ensureHeaders() {
    const data = await apiFetch(rangeUrl(`${SHEET_NAME}!A1:L1`));
    const existing = data.values?.[0] ?? [];
    if (existing.length === 0) {
      // Brand new sheet — write full header
      await apiFetch(
        rangeUrl(`${SHEET_NAME}!A1:L1`, '?valueInputOption=RAW'),
        {
          method: 'PUT',
          body: JSON.stringify({ values: [COLS] }),
        }
      );
    } else if (existing.length === 10 && !existing.includes('drop_name')) {
      // Existing sheet missing drop_name and price columns
      await apiFetch(
        rangeUrl(`${SHEET_NAME}!K1:L1`, '?valueInputOption=RAW'),
        {
          method: 'PUT',
          body: JSON.stringify({ values: [['drop_name', 'price']] }),
        }
      );
    } else if (existing.length === 11 && !existing.includes('price')) {
      // Existing sheet missing the price column
      await apiFetch(
        rangeUrl(`${SHEET_NAME}!L1`, '?valueInputOption=RAW'),
        {
          method: 'PUT',
          body: JSON.stringify({ values: [['price']] }),
        }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Read all rows from the sheet. Returns array of plain objects.
  // ---------------------------------------------------------------------------
  async function readAll() {
    await ensureHeaders();
    const data = await apiFetch(rangeUrl(`${SHEET_NAME}!A:L`));
    const rows = data.values ?? [];
    if (rows.length <= 1) return []; // header only

    const [header, ...body] = rows;
    return body.map((row, i) => {
      const obj = {};
      COLS.forEach((col, ci) => {
        obj[col] = row[ci] ?? '';
      });
      // Coerce types
      obj.favourite = obj.favourite === 'TRUE';
      obj._rowIndex = i + 2; // 1-based, skip header
      return obj;
    });
  }

  // ---------------------------------------------------------------------------
  // Append a new card row. `card` is a plain object with keys matching COLS.
  // Generates a UUID for the id field.
  // ---------------------------------------------------------------------------
  async function appendCard(card) {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const row = COLS.map(col => {
      if (col === 'id') return id;
      const val = card[col];
      if (col === 'favourite') return val ? 'TRUE' : 'FALSE';
      return val ?? '';
    });

    await apiFetch(
      `${sheetsBase()}/values/${encodeURIComponent(`${SHEET_NAME}!A:L`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
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
      return COLS.map(col => {
        if (col === 'id') return id;
        const val = card[col];
        if (col === 'favourite') return val ? 'TRUE' : 'FALSE';
        return val ?? '';
      });
    });

    await apiFetch(
      `${sheetsBase()}/values/${encodeURIComponent(`${SHEET_NAME}!A:L`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
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
    const data = await apiFetch(rangeUrl(`${SHEET_NAME}!A${rowIndex}:L${rowIndex}`));
    const current = data.values?.[0] ?? [];

    const row = COLS.map((col, ci) => {
      if (col in updates) {
        const val = updates[col];
        if (col === 'favourite') return val ? 'TRUE' : 'FALSE';
        return val ?? '';
      }
      return current[ci] ?? '';
    });

    await apiFetch(
      rangeUrl(`${SHEET_NAME}!A${rowIndex}:L${rowIndex}`, '?valueInputOption=RAW'),
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
    const data = { valueInputOption: 'RAW', data: [] };
    for (const rowIndex of rowIndices) {
      data.data.push({
        range:  `${SHEET_NAME}!J${rowIndex}`,
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
    await apiFetch(
      rangeUrl(`${SHEET_NAME}!I${rowIndex}`, '?valueInputOption=RAW'),
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
    const data = { valueInputOption: 'RAW', data: [] };
    for (const { rowIndex, price } of entries) {
      data.data.push({
        range:  `${SHEET_NAME}!L${rowIndex}`,
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
  // Public API
  // ---------------------------------------------------------------------------
  return {
    init,
    readAll,
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
