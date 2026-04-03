/**
 * app.js — Azusa
 * UI logic, state management, grouping, cycle detection, event handling.
 */

// ---------------------------------------------------------------------------
// CONFIG — fill in your credentials
// ---------------------------------------------------------------------------
const CONFIG = {
  CLIENT_ID: '951154980013-3eg1bkbhr2u1ph3c7qtafc5b6q5rmuhr.apps.googleusercontent.com',
  SHEET_ID:  '1Gmw4Uvz41P8CpIsYIYLUCdxJqO2UgLmZ2R5QzVi98MY',
  SCOPES:    'https://www.googleapis.com/auth/spreadsheets',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const State = {
  cards:        [],   // all rows from sheet
  browseCards:  [],   // results from current Scryfall browse
  view:         'grid', // 'grid' | 'table'
  filters: {
    type:    'all',
    release: 'all',
    finish:  'all',
    status:  'all',
    favOnly: false,
  },
  tokenClient:  null,
  accessToken:  null,
  parentNames:  {},  // parent_set_code → display name
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

// ---------------------------------------------------------------------------
// LAND TYPE CONFIG
// ---------------------------------------------------------------------------
const LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'];
const LAND_COLORS = {
  Plains:   '#c9a84c',
  Island:   '#388bfd',
  Mountain: '#da3633',
  Forest:   '#2ea043',
  Swamp:    '#8957e5',
  Wastes:   '#8b949e',
  Other:    '#8b949e',
};

const FOIL_FINISHES = [
  'Regular foil','Surge foil','Galaxy foil','Oil slick foil',
  'Textured foil','Step-and-compleat foil','Gilded foil',
  'Halo foil','Double rainbow foil','Fracture foil',
  'Etched foil','Glossy',
];

// Scryfall mana symbol images
const LAND_MANA = {
  Plains:   'W',
  Island:   'U',
  Swamp:    'B',
  Mountain: 'R',
  Forest:   'G',
  Wastes:   'C',
};

function landIcon(landType) {
  const code = LAND_MANA[landType];
  if (code) {
    return `<img class="land-icon" src="https://svgs.scryfall.io/card-symbols/${code}.svg" alt="${landType}" title="${landType}"/>`;
  }
  return `<span class="land-icon-text" style="color:${LAND_COLORS[landType]}">${landType[0]}</span>`;
}

const FINISH_ABBREV = {
  'Non-foil':                '',
  'Regular foil':            '◆',
  'Surge foil':              '⚡',
  'Galaxy foil':             '✦',
  'Oil slick foil':          '◈',
  'Textured foil':           '▧',
  'Step-and-compleat foil':  'Φ',
  'Gilded foil':             '♛',
  'Halo foil':               '◯',
  'Double rainbow foil':     '⟐',
  'Fracture foil':           '⬡',
  'Etched foil':             '▣',
  'Glossy':                  '●',
  'Chocobo track foil':      '🐤',
};

// ---------------------------------------------------------------------------
// AUTH — Google Identity Services
// ---------------------------------------------------------------------------
function initAuth() {
  State.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope:     CONFIG.SCOPES,
    callback:  handleTokenResponse,
  });
}

function handleTokenResponse(resp) {
  if (resp.error) { showError('Sign-in failed: ' + resp.error); return; }
  State.accessToken = resp.access_token;

  // Persist token with expiry (expires_in is seconds)
  const expiresAt = Date.now() + (resp.expires_in ?? 3600) * 1000;
  localStorage.setItem('azusa_token', resp.access_token);
  localStorage.setItem('azusa_token_expires', String(expiresAt));

  // Init Sheets with token getter
  const sheetId = localStorage.getItem('azusa_sheet_id') || CONFIG.SHEET_ID;
  if (!sheetId) { showSheetIdPrompt(); return; }

  Sheets.init(sheetId, () => State.accessToken);
  showApp();
  loadCollection();
}

function signIn() {
  const sheetId = $('sheet-id-input')?.value.trim();
  if (sheetId) localStorage.setItem('azusa_sheet_id', sheetId);
  State.tokenClient.requestAccessToken({ prompt: '' });
}

function signOut() {
  if (State.accessToken) {
    google.accounts.oauth2.revoke(State.accessToken);
    State.accessToken = null;
  }
  localStorage.removeItem('azusa_token');
  localStorage.removeItem('azusa_token_expires');
  showAuth();
}

// ---------------------------------------------------------------------------
// SCREENS
// ---------------------------------------------------------------------------
function showAuth() {
  $('auth-screen').classList.remove('hidden');
  $('app-screen').classList.add('hidden');
  const saved = localStorage.getItem('azusa_sheet_id');
  if (saved && $('sheet-id-input')) $('sheet-id-input').value = saved;
}

function showApp() {
  $('auth-screen').classList.add('hidden');
  $('app-screen').classList.remove('hidden');
}

function showSheetIdPrompt() {
  // Already on auth screen — just focus the input
  showAuth();
  $('sheet-id-input')?.focus();
  showError('Please enter your Google Sheet ID first.');
}

// ---------------------------------------------------------------------------
// LOAD COLLECTION
// ---------------------------------------------------------------------------
async function loadCollection() {
  showLoading(true);
  try {
    State.cards = await Sheets.readAll();
    await resolveParentNames();
    renderFilters();
    renderCollection();
    renderStats();
  } catch (e) {
    showError('Failed to load collection: ' + e.message);
  } finally {
    showLoading(false);
  }
}

// Fetch parent set display names for all unique parent_set_codes
async function resolveParentNames() {
  const codes = [...new Set(
    State.cards
      .map(c => c.parent_set_code || c.set_code)
      .filter(Boolean)
  )];
  await Promise.all(codes.map(async code => {
    if (State.parentNames[code]) return;
    const s = await Scryfall.fetchSet(code);
    if (s) State.parentNames[code] = s.name;
  }));
}

// ---------------------------------------------------------------------------
// GROUPING & CYCLE DETECTION
// ---------------------------------------------------------------------------

// Returns group key for a card (drop name for SLD, else parent set or own set)
function groupKey(card) {
  if (card.set_code === 'sld' && card.drop_name) {
    return `sld__${card.drop_name}`;
  }
  return card.parent_set_code || card.set_code;
}

// Group cards into releases, then detect cycles within each release
function groupCards(cards) {
  // Group by release
  const releaseMap = {};
  for (const card of cards) {
    const key = groupKey(card);
    if (!releaseMap[key]) releaseMap[key] = [];
    releaseMap[key].push(card);
  }

  // For each release, detect cycles (same finish, all 5 basic types)
  const releases = [];
  for (const [key, releaseCards] of Object.entries(releaseMap)) {
    const cycles = detectCycles(releaseCards);
    let name;
    if (key.startsWith('sld__')) {
      name = key.slice(5); // drop_name portion
    } else {
      name = State.parentNames[key] || key.toUpperCase();
    }
    releases.push({
      key,
      name,
      cards:  releaseCards,
      cycles,
    });
  }

  // Sort releases: those with cards first, by name
  releases.sort((a, b) => a.name.localeCompare(b.name));
  return releases;
}

// Within a release, find groups of cards that form a cycle
// A cycle = same finish, contains at least 2 of the 5 basic land types
// (full 5-type cycle is ideal but partials are grouped too)
function detectCycles(cards) {
  // Group by finish + set_code (same finish within same actual set = cycle candidate)
  const finishGroups = {};
  for (const card of cards) {
    const key = `${card.set_code}__${card.finish}`;
    if (!finishGroups[key]) finishGroups[key] = [];
    finishGroups[key].push(card);
  }

  const cycles = [];
  const inCycle = new Set();

  for (const [key, group] of Object.entries(finishGroups)) {
    // Only treat as a cycle if 2+ basic land types present
    const types = new Set(group.map(c => c.land_type).filter(t => LAND_TYPES.includes(t)));
    if (types.size >= 2) {
      cycles.push({
        key,
        finish: group[0].finish,
        setCode: group[0].set_code,
        cards: group.sort((a, b) =>
          LAND_TYPES.indexOf(a.land_type) - LAND_TYPES.indexOf(b.land_type)
        ),
      });
      group.forEach(c => inCycle.add(c.id));
    }
  }

  // Solo cards not part of any cycle
  const solos = cards.filter(c => !inCycle.has(c.id));

  return { cycles, solos };
}

// ---------------------------------------------------------------------------
// FAVOURITE STATE FOR A CYCLE
// Returns 'all' | 'some' | 'none'
// ---------------------------------------------------------------------------
function cycFavState(cycle) {
  const favCount = cycle.cards.filter(c => c.favourite).length;
  if (favCount === 0) return 'none';
  if (favCount === cycle.cards.length) return 'all';
  return 'some';
}

// ---------------------------------------------------------------------------
// FILTER
// ---------------------------------------------------------------------------
function applyFilters(cards) {
  const { type, release, finish, status, favOnly } = State.filters;
  return cards.filter(c => {
    if (type    !== 'all' && c.land_type !== type) return false;
    if (release !== 'all' && groupKey(c) !== release) return false;
    if (finish  !== 'all' && c.finish !== finish)   return false;
    if (status  !== 'all' && c.status !== status)   return false;
    if (favOnly && !c.favourite)                     return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// RENDER FILTERS
// ---------------------------------------------------------------------------
function renderFilters() {
  // Release dropdown
  const releaseSelect = $('filter-release');
  const releases = [...new Set(State.cards.map(c => groupKey(c)))];
  releaseSelect.innerHTML = '<option value="all">All releases</option>' +
    releases.sort().map(r => {
      const label = r.startsWith('sld__') ? r.slice(5) : (State.parentNames[r] || r.toUpperCase());
      return `<option value="${r}">${label}</option>`;
    }).join('');
  releaseSelect.value = State.filters.release;

  // Finish dropdown
  const finishSelect = $('filter-finish');
  const finishes = [...new Set(State.cards.map(c => c.finish).filter(Boolean))].sort();
  finishSelect.innerHTML = '<option value="all">All finishes</option>' +
    finishes.map(f => `<option value="${f}">${f}</option>`).join('');
  finishSelect.value = State.filters.finish;
}

// ---------------------------------------------------------------------------
// RENDER STATS
// ---------------------------------------------------------------------------
function renderStats() {
  const total   = State.cards.length;
  const have    = State.cards.filter(c => c.status === 'have').length;
  const want    = State.cards.filter(c => c.status === 'want').length;
  const fav     = State.cards.filter(c => c.favourite).length;
  const typeCounts = {};
  for (const t of LAND_TYPES) {
    typeCounts[t] = State.cards.filter(c => c.land_type === t).length;
  }

  $('stats-strip').innerHTML =
    `<span>${total} cards</span>` +
    `<span class="stat-have">${have} have</span>` +
    `<span class="stat-want">${want} want</span>` +
    `<span class="stat-fav">★ ${fav} favourited</span>` +
    `<span class="stat-divider">|</span>` +
    LAND_TYPES.filter(t => typeCounts[t] > 0).map(t =>
      `<span class="stat-type" style="color:${LAND_COLORS[t]}">${t} ${typeCounts[t]}</span>`
    ).join('');
}

// ---------------------------------------------------------------------------
// RENDER COLLECTION
// ---------------------------------------------------------------------------
function renderCollection() {
  const filtered = applyFilters(State.cards);
  if (State.view === 'grid') renderGrid(filtered);
  else renderTable(filtered);
}

// ---------------------------------------------------------------------------
// GRID VIEW
// ---------------------------------------------------------------------------
function renderGrid(cards) {
  const container = $('grid-view');
  container.innerHTML = '';

  if (cards.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">◈</div>
        <p>No cards found.</p>
        <p class="empty-sub">Try adjusting your filters or add some cards.</p>
      </div>`;
    return;
  }

  const releases = groupCards(cards);

  for (const release of releases) {
    const releaseEl = el('div', 'release-group');
    releaseEl.innerHTML = `<h2 class="release-name">${release.name}</h2>`;

    const { cycles, solos } = release.cycles;

    // Render cycles
    for (const cycle of cycles) {
      const state = cycFavState(cycle);
      const cycleEl = el('div', 'cycle-group');
      cycleEl.innerHTML = `
        <div class="cycle-header">
          <span class="cycle-label">
            <span class="finish-badge" data-finish="${cycle.finish}">${cycle.finish}</span>
            <span class="cycle-tag">cycle · ${cycle.cards.length} cards</span>
          </span>
          <button class="fav-btn cycle-fav-btn ${state}" 
                  title="Favourite cycle"
                  data-cycle-key="${cycle.key}">
            ${state === 'all' ? '★' : state === 'some' ? '⯨' : '☆'}
          </button>
        </div>
        <div class="card-grid"></div>`;
      const grid = cycleEl.querySelector('.card-grid');
      cycle.cards.forEach(card => grid.appendChild(makeCardTile(card)));
      releaseEl.appendChild(cycleEl);
    }

    // Render solo cards
    if (solos.length > 0) {
      const soloGrid = el('div', 'card-grid solo-grid');
      solos.forEach(card => soloGrid.appendChild(makeCardTile(card)));
      releaseEl.appendChild(soloGrid);
    }

    container.appendChild(releaseEl);
  }

  // Attach cycle fav button listeners
  container.querySelectorAll('.cycle-fav-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleCycleFav(btn.dataset.cycleKey));
  });
}

// ---------------------------------------------------------------------------
// CARD TILE
// ---------------------------------------------------------------------------
function makeCardTile(card) {
  const tile = el('div', 'card-tile');
  const isFoil = card.finish !== 'Non-foil';
  if (isFoil) tile.setAttribute('data-foil', 'true');
  tile.setAttribute('data-finish', card.finish);
  tile.setAttribute('data-land-type', card.land_type);
  if (card.status === 'want') tile.classList.add('want');

  const imgUrl = Scryfall.imageUrl(card.scryfall_id);
  const finishIcon = FINISH_ABBREV[card.finish] ?? '';

  tile.innerHTML = `
    <div class="card-art-wrap">
      <img class="card-art" src="${imgUrl}" alt="${card.land_type}" loading="lazy"
           onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 488 680%22><rect width=%22488%22 height=%22680%22 fill=%22%23182420%22/><text x=%22244%22 y=%22340%22 text-anchor=%22middle%22 fill=%22%238a9b8e%22 font-size=%2248%22>${card.land_type[0]}</text></svg>'"/>
      <div class="card-overlay">
        <a class="card-action-btn scryfall-btn" href="https://scryfall.com/card/${card.set_code}/${card.collector_num}" target="_blank" rel="noopener" title="View on Scryfall">↗</a>
        <a class="card-action-btn tcg-btn" href="https://www.tcgplayer.com/search/magic/product?q=${encodeURIComponent(card.land_type + ' ' + card.set_name)}&view=grid" target="_blank" rel="noopener" title="Search on TCGplayer">$</a>
        <button class="card-action-btn status-btn" title="Switch to ${card.status === 'have' ? 'want' : 'have'}" data-id="${card.id}">⇄</button>
        <button class="card-action-btn delete-btn" title="Delete" data-id="${card.id}">✕</button>
      </div>
      ${isFoil ? '<div class="foil-shimmer"></div>' : ''}
    </div>
    <div class="card-info">
      <div class="card-meta">
        <span class="card-set-code" title="${card.set_name}">${card.set_code.toUpperCase()}</span>
        <span class="card-num">#${card.collector_num}</span>
        <span class="card-icons">
          ${finishIcon ? `<span class="finish-icon" data-finish="${card.finish}" title="${card.finish}">${finishIcon}</span>` : ''}
          ${landIcon(card.land_type)}
        </span>
      </div>
    </div>
    <button class="fav-btn card-fav-btn ${card.favourite ? 'all' : 'none'}" 
            title="Favourite" data-id="${card.id}">
      ${card.favourite ? '★' : '☆'}
    </button>`;

  // Events
  tile.querySelector('.scryfall-btn').addEventListener('click', e => e.stopPropagation());
  tile.querySelector('.tcg-btn').addEventListener('click', e => e.stopPropagation());
  tile.querySelector('.status-btn').addEventListener('click', e => {
    e.stopPropagation(); toggleCardStatus(card.id);
  });
  tile.querySelector('.delete-btn').addEventListener('click', e => {
    e.stopPropagation(); confirmDelete(card.id);
  });
  tile.querySelector('.card-fav-btn').addEventListener('click', e => {
    e.stopPropagation(); toggleCardFav(card.id);
  });

  return tile;
}

// ---------------------------------------------------------------------------
// TABLE VIEW
// ---------------------------------------------------------------------------
function renderTable(cards) {
  const container = $('table-view');
  container.innerHTML = '';

  if (cards.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">◈</div><p>No cards found.</p></div>`;
    return;
  }

  const table = el('table', 'collection-table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Art</th>
        <th data-sort="set_code">Set</th>
        <th data-sort="collector_num">#</th>
        <th data-sort="land_type">Type</th>
        <th data-sort="finish">Finish</th>
        <th data-sort="status">Status</th>
        <th data-sort="favourite">★</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody></tbody>`;

  const tbody = table.querySelector('tbody');

  // Group by release for table rows
  const releases = groupCards(cards);
  for (const release of releases) {
    // Release header row
    const releaseRow = el('tr', 'table-release-row');
    releaseRow.innerHTML = `<td colspan="8">${release.name}</td>`;
    tbody.appendChild(releaseRow);

    // Card rows
    for (const card of release.cards) {
      const row = el('tr', 'table-card-row');
      const finishIcon = FINISH_ABBREV[card.finish] ?? '';
      row.innerHTML = `
        <td class="table-art-cell">
          <img src="${Scryfall.imageUrl(card.scryfall_id, 'small')}"
               class="table-art" alt="${card.land_type}" loading="lazy"/>
        </td>
        <td><span class="mono">${card.set_code.toUpperCase()}</span><br>
            <span class="text-muted small">${card.set_name}</span></td>
        <td class="mono">${card.collector_num}</td>
        <td>${landIcon(card.land_type)} <span class="type-pill" style="--type-color:${LAND_COLORS[card.land_type] || '#8a9b8e'}">${card.land_type}</span></td>
        <td>${finishIcon ? `<span class="finish-icon" data-finish="${card.finish}" title="${card.finish}">${finishIcon}</span> ` : ''}<span class="finish-badge" data-finish="${card.finish}">${card.finish}</span></td>
        <td><span class="status-badge ${card.status}">${card.status}</span></td>
        <td>
          <button class="fav-btn card-fav-btn ${card.favourite ? 'all' : 'none'}" data-id="${card.id}">
            ${card.favourite ? '★' : '☆'}
          </button>
        </td>
        <td class="table-actions">
          <a class="table-action-btn scryfall-btn" href="https://scryfall.com/card/${card.set_code}/${card.collector_num}" target="_blank" rel="noopener" title="View on Scryfall">↗</a>
          <a class="table-action-btn tcg-btn" href="https://www.tcgplayer.com/search/magic/product?q=${encodeURIComponent(card.land_type + ' ' + card.set_name)}&view=grid" target="_blank" rel="noopener" title="Search on TCGplayer">$</a>
          <button class="table-action-btn status-btn" data-id="${card.id}" title="Switch to ${card.status === 'have' ? 'want' : 'have'}">⇄</button>
          <button class="table-action-btn delete-btn" data-id="${card.id}">✕</button>
        </td>`;

      row.querySelector('.card-fav-btn').addEventListener('click', () => toggleCardFav(card.id));
      row.querySelector('.status-btn').addEventListener('click', () => toggleCardStatus(card.id));
      row.querySelector('.delete-btn').addEventListener('click', () => confirmDelete(card.id));
      tbody.appendChild(row);
    }
  }

  container.appendChild(table);
}

// ---------------------------------------------------------------------------
// TOGGLE FAVOURITE — individual card
// ---------------------------------------------------------------------------
async function toggleCardFav(cardId) {
  const card = State.cards.find(c => c.id === cardId);
  if (!card) return;
  const newVal = !card.favourite;
  card.favourite = newVal;
  try {
    await Sheets.setFavourite([card._rowIndex], newVal);
    renderCollection();
    renderStats();
  } catch (e) {
    card.favourite = !newVal; // revert
    showError('Failed to update favourite: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// TOGGLE STATUS — individual card (have ↔ want)
// ---------------------------------------------------------------------------
async function toggleCardStatus(cardId) {
  const card = State.cards.find(c => c.id === cardId);
  if (!card) return;
  const newStatus = card.status === 'have' ? 'want' : 'have';
  const oldStatus = card.status;
  card.status = newStatus;
  try {
    await Sheets.setStatus(card._rowIndex, newStatus);
    renderCollection();
    renderStats();
  } catch (e) {
    card.status = oldStatus; // revert
    showError('Failed to update status: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// TOGGLE FAVOURITE — cycle
// ---------------------------------------------------------------------------
async function toggleCycleFav(cycleKey) {
  // Find all cards in this cycle across State.cards
  const [setCode, finish] = cycleKey.split('__');
  const cycleCards = State.cards.filter(
    c => c.set_code === setCode && c.finish === finish
  );
  if (!cycleCards.length) return;

  const state = cycFavState({ cards: cycleCards });
  // If all are favourited, unfav all. Otherwise fav all.
  const newVal = state !== 'all';

  const rowIndices = cycleCards.map(c => c._rowIndex);
  cycleCards.forEach(c => c.favourite = newVal);

  try {
    await Sheets.setFavourite(rowIndices, newVal);
    renderCollection();
    renderStats();
  } catch (e) {
    cycleCards.forEach(c => c.favourite = !newVal);
    showError('Failed to update cycle favourite: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// ADD CARD MODAL
// ---------------------------------------------------------------------------
function openAddModal() {
  $('modal-title').textContent = 'Add Card';
  $('browse-results').innerHTML = '';
  $('browse-set-input').value = '';
  $('sld-drop-filter').classList.add('hidden');
  $('sld-drop-filter-input').value = '';
  $('confirm-panel').classList.add('hidden');
  $('confirm-drop-field').classList.add('hidden');
  $('save-card-btn').textContent = 'Save';
  selectedBrowseCards.clear();
  // Reset toggles to defaults
  $('status-toggle-have').classList.add('active');
  $('status-toggle-want').classList.remove('active');
  $('fav-toggle').classList.remove('active');
  $('fav-toggle').textContent = '☆ Favourite';
  $('modal-overlay').classList.remove('hidden');
  $('browse-set-input').focus();
}

async function browseSet() {
  const setCode = $('browse-set-input').value.trim();
  const resultsEl = $('browse-results');
  resultsEl.innerHTML = '<div class="browse-loading">Fetching from Scryfall…</div>';
  $('confirm-panel').classList.add('hidden');

  // Show/hide drop filter
  const isSld = setCode.toLowerCase() === 'sld';
  $('sld-drop-filter').classList.toggle('hidden', !isSld);
  $('sld-drop-filter-input').value = '';

  try {
    State.browseCards = await Scryfall.searchFullArtLands(setCode, (loaded, total) => {
      const loadingEl = resultsEl.querySelector('.browse-loading');
      if (loadingEl) loadingEl.textContent =
        total ? `Loading… ${loaded} / ${total}` : `Loading… ${loaded}`;
    });

    if (State.browseCards.length === 0) {
      resultsEl.innerHTML = '<div class="browse-empty">No full art basics found.</div>';
      return;
    }

    if (isSld) {
      renderSldBrowseGrid(State.browseCards);
    } else {
      renderBrowseGrid(State.browseCards);
    }
  } catch (e) {
    resultsEl.innerHTML = `<div class="browse-error">Error: ${e.message}</div>`;
  }
}

function filterSldBrowse() {
  const query = $('sld-drop-filter-input').value.trim().toLowerCase();
  if (!query) {
    renderSldBrowseGrid(State.browseCards);
    return;
  }

  // Filter by drop name first, then fall back to card-level fields
  const dropMatches = SLD_DROPS
    .filter(d => d.name.toLowerCase().includes(query))
    .map(d => [d.start, d.end]);

  const filtered = State.browseCards.filter(card => {
    const num = parseInt(card.collector_number, 10);
    // Match if the card's drop name matches
    if (dropMatches.some(([s, e]) => num >= s && num <= e)) return true;
    // Or match card-level fields
    const fields = [
      card.name, card.printed_name, card.flavor_text,
      card.artist, card.collector_number,
    ].map(f => (f ?? '').toLowerCase());
    return fields.some(f => f.includes(query));
  });

  renderSldBrowseGrid(filtered);
}

function renderSldBrowseGrid(cards) {
  const resultsEl = $('browse-results');
  resultsEl.innerHTML = '';
  browseCycles = [];

  if (cards.length === 0) {
    resultsEl.innerHTML = '<div class="browse-empty">No matching cards.</div>';
    return;
  }

  const drops = groupSldByDrop(cards);

  // Treat each drop as a cycle if it has 2+ land types
  for (const drop of drops) {
    const types = new Set(drop.cards.map(c => Scryfall.deriveLandType(c)).filter(t => LAND_TYPES.includes(t)));
    if (types.size >= 2) {
      // Group by finish within the drop
      const byFinish = {};
      for (const card of drop.cards) {
        const f = Scryfall.deriveFinish(card);
        if (!byFinish[f]) byFinish[f] = [];
        byFinish[f].push(card);
      }
      for (const [f, group] of Object.entries(byFinish)) {
        const gt = new Set(group.map(c => Scryfall.deriveLandType(c)).filter(t => LAND_TYPES.includes(t)));
        if (gt.size >= 2) browseCycles.push({ finish: f, cards: group });
      }
    }
  }

  for (const drop of drops) {
    const section = el('div', 'browse-section');
    const header = el('div', 'browse-set-header');
    header.innerHTML = `<div class="browse-set-label">${drop.name} <span class="text-muted small">(${drop.cards.length})</span></div>`;
    header.appendChild(makeSelectAllBtn(drop.cards, section, drop.name));
    section.appendChild(header);
    const grid = el('div', 'browse-grid');

    for (const card of drop.cards) {
      const finish = Scryfall.deriveFinish(card);
      const landType = Scryfall.deriveLandType(card);
      const imgUrl = Scryfall.imageUrl(card.id);
      const isFoil = finish !== 'Non-foil';

      const tile = el('div', 'browse-tile');
      if (isFoil) tile.setAttribute('data-foil', 'true');
      tile.setAttribute('data-finish', finish);

      const dupe = Sheets.findDuplicate(State.cards, card.set, card.collector_number, finish);

      const finishIcon = FINISH_ABBREV[finish] ?? '';

      tile.innerHTML = `
        <div class="browse-art-wrap">
          <img src="${imgUrl}" alt="${landType}" loading="lazy"
               onerror="this.style.background='#182420'"/>
          ${dupe ? '<div class="dupe-badge">In collection</div>' : ''}
          ${isFoil ? '<div class="foil-shimmer"></div>' : ''}
        </div>
        <div class="browse-info-compact">
          <span class="mono">#${card.collector_number}</span>
          <span class="browse-icons">
            ${finishIcon ? `<span class="finish-icon" data-finish="${finish}" title="${finish}">${finishIcon}</span>` : ''}
            ${landIcon(landType)}
          </span>
        </div>`;

      tile.addEventListener('click', () => selectBrowseCard(card, tile, drop.name));
      grid.appendChild(tile);
    }

    section.appendChild(grid);
    resultsEl.appendChild(section);
  }
}

function renderBrowseGrid(cards) {
  const resultsEl = $('browse-results');
  resultsEl.innerHTML = '';
  browseCycles = [];

  // Group by set for browse display
  const bySet = {};
  for (const card of cards) {
    const key = `${card.set}__${card.set_name}`;
    if (!bySet[key]) bySet[key] = [];
    bySet[key].push(card);
  }

  for (const [key, setCards] of Object.entries(bySet)) {
    const setName = setCards[0].set_name;
    const setCode = setCards[0].set;

    const section = el('div', 'browse-section');
    const header = el('div', 'browse-set-header');
    header.innerHTML = `<div class="browse-set-label">${setName} <span class="mono">${setCode.toUpperCase()}</span></div>`;
    header.appendChild(makeSelectAllBtn(setCards, section));
    section.appendChild(header);

    // Detect cycles within this set (group by finish, 2+ land types)
    const finishGroups = {};
    for (const card of setCards) {
      const finish = Scryfall.deriveFinish(card);
      if (!finishGroups[finish]) finishGroups[finish] = [];
      finishGroups[finish].push(card);
    }

    const cycles = [];
    const soloCards = [];

    for (const [finish, group] of Object.entries(finishGroups)) {
      const types = new Set(group.map(c => Scryfall.deriveLandType(c)).filter(t => LAND_TYPES.includes(t)));
      if (types.size >= 2) {
        const sorted = group.sort((a, b) =>
          LAND_TYPES.indexOf(Scryfall.deriveLandType(a)) - LAND_TYPES.indexOf(Scryfall.deriveLandType(b))
          || parseInt(a.collector_number) - parseInt(b.collector_number)
        );
        cycles.push({ finish, cards: sorted });
        browseCycles.push({ finish, cards: sorted });
      } else {
        soloCards.push(...group);
      }
    }

    for (const cycle of cycles) {
      const cycleWrap = el('div', 'browse-cycle-wrap');
      const cycleHeader = el('div', 'browse-cycle-header');
      cycleHeader.innerHTML = `<span class="browse-cycle-label">${cycle.finish}</span>`;
      cycleHeader.appendChild(makeSelectAllBtn(cycle.cards, cycleWrap));
      cycleWrap.appendChild(cycleHeader);
      const grid = el('div', 'browse-grid');
      for (const card of cycle.cards) {
        grid.appendChild(makeBrowseTile(card));
      }
      cycleWrap.appendChild(grid);
      section.appendChild(cycleWrap);
    }

    if (soloCards.length) {
      if (cycles.length) {
        const soloHeader = el('div', 'browse-cycle-label', 'Other');
        section.appendChild(soloHeader);
      }
      const grid = el('div', 'browse-grid');
      for (const card of soloCards) {
        grid.appendChild(makeBrowseTile(card));
      }
      section.appendChild(grid);
    }

    resultsEl.appendChild(section);
  }
}

function makeBrowseTile(card) {
  const finish = Scryfall.deriveFinish(card);
  const landType = Scryfall.deriveLandType(card);
  const imgUrl = Scryfall.imageUrl(card.id);
  const isFoil = finish !== 'Non-foil';

  const tile = el('div', 'browse-tile');
  if (isFoil) tile.setAttribute('data-foil', 'true');
  tile.setAttribute('data-finish', finish);

  // Check if already in collection
  const dupe = Sheets.findDuplicate(State.cards, card.set, card.collector_number, finish);

  const finishIcon = FINISH_ABBREV[finish] ?? '';

  tile.innerHTML = `
    <div class="browse-art-wrap">
      <img src="${imgUrl}" alt="${landType}" loading="lazy"
           onerror="this.style.background='#161b22'"/>
      ${dupe ? '<div class="dupe-badge">In collection</div>' : ''}
      ${isFoil ? '<div class="foil-shimmer"></div>' : ''}
    </div>
    <div class="browse-info-compact">
      <span class="mono">#${card.collector_number}</span>
      <span class="browse-icons">
        ${finishIcon ? `<span class="finish-icon" data-finish="${finish}" title="${finish}">${finishIcon}</span>` : ''}
        ${landIcon(landType)}
      </span>
    </div>`;

  tile.addEventListener('click', () => selectBrowseCard(card, tile));
  return tile;
}

const selectedBrowseCards = new Map(); // browseKey → { card, clusterLabel }

// Unique key for a browse card — distinguishes non-foil vs foil copies of the same card
function browseKey(card) {
  return `${card.id}__${Scryfall.deriveFinish(card)}`;
}
let browseCycles = []; // array of { finish, cards[] } — detected cycles from current browse

function selectBrowseCard(card, tileEl, clusterLabel) {
  // Toggle selection
  const key = browseKey(card);
  if (selectedBrowseCards.has(key)) {
    selectedBrowseCards.delete(key);
    tileEl.classList.remove('selected');
  } else {
    selectedBrowseCards.set(key, { card, clusterLabel });
    tileEl.classList.add('selected');
  }

  updateSelectionPanel();
}

function updateSelectionPanel() {
  const count = selectedBrowseCards.size;
  const panel = $('confirm-panel');
  const $btn = $('save-card-btn');

  if (count === 0) {
    panel.classList.add('hidden');
    $btn.textContent = 'Save';
    return;
  }

  panel.classList.remove('hidden');
  $btn.textContent = count === 1 ? 'Save' : `Save (${count})`;

  // Show last selected card's preview
  const last = [...selectedBrowseCards.values()].at(-1);
  const card = last.card;
  const finish = Scryfall.deriveFinish(card);
  const landType = Scryfall.deriveLandType(card);
  const imgUrl = Scryfall.imageUrl(card.id);

  $('confirm-art').src = imgUrl;
  $('confirm-set').textContent = `${card.set_name} (${card.set.toUpperCase()})`;
  $('confirm-num').textContent = count === 1
    ? `#${card.collector_number}`
    : `${count} cards selected`;
  $('confirm-type').textContent = count === 1 ? landType : '—';
  $('confirm-finish').textContent = count === 1 ? finish : '—';

  // Show/populate drop name field for SLD cards
  const isSld = card.set === 'sld';
  $('confirm-drop-field').classList.toggle('hidden', !isSld);
  if (isSld) {
    $('confirm-drop-name').value = last.clusterLabel ?? sldDropName(card.collector_number) ?? '';
  }
}

function selectAllCards(cards, container, clusterLabel) {
  // Check if all are already selected
  const allSelected = cards.every(c => selectedBrowseCards.has(browseKey(c)));

  for (const card of cards) {
    const key = browseKey(card);
    if (allSelected) {
      selectedBrowseCards.delete(key);
    } else {
      selectedBrowseCards.set(key, { card, clusterLabel });
    }
  }

  // Update tile visual state within this container
  container.querySelectorAll('.browse-tile').forEach(tile => {
    const num = tile.querySelector('.mono')?.textContent.replace('#', '');
    const finish = tile.getAttribute('data-finish');
    const match = cards.find(c =>
      c.collector_number === num && Scryfall.deriveFinish(c) === finish
    );
    if (match) {
      tile.classList.toggle('selected', selectedBrowseCards.has(browseKey(match)));
    }
  });

  updateSelectionPanel();
}

function makeSelectAllBtn(cards, container, clusterLabel) {
  const btn = el('button', 'browse-select-all', 'Select All');
  btn.addEventListener('click', () => {
    selectAllCards(cards, container, clusterLabel);
    const nowAll = cards.every(c => selectedBrowseCards.has(browseKey(c)));
    btn.textContent = nowAll ? 'Deselect All' : 'Select All';
  });
  return btn;
}

async function saveCard() {
  if (selectedBrowseCards.size === 0) return;

  const status   = $('status-toggle-have').classList.contains('active') ? 'have' : 'want';
  const favourite = $('fav-toggle').classList.contains('active');
  const drop_name_input = $('confirm-drop-name')?.value.trim() || '';

  // Duplicate check
  const entries = [...selectedBrowseCards.values()];
  const dupes = entries.filter(({ card }) => {
    const finish = Scryfall.deriveFinish(card);
    return Sheets.findDuplicate(State.cards, card.set, card.collector_number, finish);
  });
  if (dupes.length > 0) {
    const msg = dupes.length === 1
      ? 'One selected card is already in your collection. Add anyway?'
      : `${dupes.length} selected cards are already in your collection. Add anyway?`;
    if (!confirm(msg)) return;
  }

  const $btn = $('save-card-btn');
  $btn.disabled = true;
  $btn.textContent = 'Saving…';

  try {
    // Enrich all cards (fetchSet is cached, so only one Scryfall call per set)
    $btn.textContent = 'Enriching…';
    const enriched = [];
    for (const { card, clusterLabel } of entries) {
      const drop_name = card.set === 'sld'
        ? (drop_name_input || clusterLabel || sldDropName(card.collector_number) || '')
        : '';
      const e = await Scryfall.enrichCard(card);
      enriched.push({ ...e, status, favourite, drop_name });
    }

    // Auto-fill missing cycle cards as "want"
    if (status === 'have' && browseCycles.length > 0) {
      const selectedKeys = new Set(entries.map(e => browseKey(e.card)));
      for (const cycle of browseCycles) {
        const selectedInCycle = cycle.cards.filter(c => selectedKeys.has(browseKey(c)));
        // Only trigger if some (not all) cards in the cycle were selected
        if (selectedInCycle.length > 0 && selectedInCycle.length < cycle.cards.length) {
          const missing = cycle.cards.filter(c => !selectedKeys.has(browseKey(c)));
          // Skip cards already in collection
          const newMissing = missing.filter(c => {
            const f = Scryfall.deriveFinish(c);
            return !Sheets.findDuplicate(State.cards, c.set, c.collector_number, f);
          });
          if (newMissing.length > 0) {
            for (const card of newMissing) {
              const drop_name = card.set === 'sld'
                ? (drop_name_input || sldDropName(card.collector_number) || '')
                : '';
              const e = await Scryfall.enrichCard(card);
              enriched.push({ ...e, status: 'want', favourite, drop_name });
            }
          }
        }
      }
    }

    // Batch write all rows in a single Sheets API call
    $btn.textContent = `Saving ${enriched.length} card(s)…`;
    if (enriched.length === 1) {
      await Sheets.appendCard(enriched[0]);
    } else {
      await Sheets.appendCards(enriched);
    }

    closeModal();
    await loadCollection();
  } catch (e) {
    console.error('Save failed:', e);
    showError('Failed to save: ' + (e.message || 'Network error — check your connection'));
  } finally {
    $btn.disabled = false;
    $btn.textContent = 'Save';
  }
}

// ---------------------------------------------------------------------------
// EDIT MODAL
// ---------------------------------------------------------------------------
function openEditModal(cardId) {
  const card = State.cards.find(c => c.id === cardId);
  if (!card) return;

  $('edit-modal-title').textContent = 'Edit Card';
  $('edit-card-id').value = cardId;
  $('edit-art').src = Scryfall.imageUrl(card.scryfall_id);
  $('edit-set').textContent = `${card.set_name} (${card.set_code.toUpperCase()})`;
  $('edit-num').textContent = `#${card.collector_num}`;
  $('edit-type').textContent = card.land_type;
  $('edit-finish').textContent = card.finish;

  // Drop name (SLD only)
  const isSld = card.set_code === 'sld';
  $('edit-drop-field').classList.toggle('hidden', !isSld);
  if (isSld) {
    $('edit-drop-name').value = card.drop_name || '';
  }

  // Status
  $('edit-status-have').classList.toggle('active', card.status === 'have');
  $('edit-status-want').classList.toggle('active', card.status === 'want');

  // Favourite
  $('edit-fav-toggle').classList.toggle('active', card.favourite);
  $('edit-fav-toggle').textContent = card.favourite ? '★ Favourited' : '☆ Favourite';

  $('edit-modal-overlay').classList.remove('hidden');
}

async function saveEdit() {
  const cardId = $('edit-card-id').value;
  const card = State.cards.find(c => c.id === cardId);
  if (!card) return;

  const status    = $('edit-status-have').classList.contains('active') ? 'have' : 'want';
  const favourite = $('edit-fav-toggle').classList.contains('active');
  const updates = { status, favourite };

  // Include drop_name if SLD
  if (card.set_code === 'sld') {
    updates.drop_name = $('edit-drop-name')?.value.trim() || '';
  }

  const $btn = $('save-edit-btn');
  $btn.disabled = true;
  $btn.textContent = 'Saving…';

  try {
    await Sheets.updateCard(card._rowIndex, updates);
    closeEditModal();
    await loadCollection();
  } catch (e) {
    showError('Failed to save: ' + e.message);
  } finally {
    $btn.disabled = false;
    $btn.textContent = 'Save';
  }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
async function confirmDelete(cardId) {
  const card = State.cards.find(c => c.id === cardId);
  if (!card) return;
  if (!confirm(`Delete ${card.land_type} #${card.collector_num} (${card.set_code.toUpperCase()}) — ${card.finish}?`)) return;

  try {
    await Sheets.deleteCard(card._rowIndex);
    State.cards = State.cards.filter(c => c.id !== cardId);
    renderCollection();
    renderStats();
  } catch (e) {
    showError('Failed to delete: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// MODAL HELPERS
// ---------------------------------------------------------------------------
function closeModal() {
  $('modal-overlay').classList.add('hidden');
  selectedBrowseCards.clear();
  browseCycles = [];
}

function closeEditModal() {
  $('edit-modal-overlay').classList.add('hidden');
}

// ---------------------------------------------------------------------------
// LOADING / ERROR
// ---------------------------------------------------------------------------
function showLoading(show) {
  $('loading-overlay').classList.toggle('hidden', !show);
}

function showError(msg) {
  const el = $('error-toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

// ---------------------------------------------------------------------------
// VIEW TOGGLE
// ---------------------------------------------------------------------------
function setView(view) {
  State.view = view;
  $('grid-view').classList.toggle('hidden', view !== 'grid');
  $('table-view').classList.toggle('hidden', view !== 'table');
  $('btn-grid-view').classList.toggle('active', view === 'grid');
  $('btn-table-view').classList.toggle('active', view === 'table');
  renderCollection();
}

// ---------------------------------------------------------------------------
// EVENT LISTENERS — wired up after DOM ready
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {

  // Auth
  $('sign-in-btn')?.addEventListener('click', signIn);
  $('sign-out-btn')?.addEventListener('click', signOut);

  // View toggle
  $('btn-grid-view')?.addEventListener('click', () => setView('grid'));
  $('btn-table-view')?.addEventListener('click', () => setView('table'));

  // Add card
  $('add-card-btn')?.addEventListener('click', openAddModal);
  $('browse-btn')?.addEventListener('click', browseSet);
  $('browse-set-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') browseSet();
  });
  $('sld-drop-filter-input')?.addEventListener('input', filterSldBrowse);
  $('save-card-btn')?.addEventListener('click', saveCard);
  $('cancel-modal-btn')?.addEventListener('click', closeModal);
  $('modal-overlay')?.addEventListener('click', e => {
    if (e.target === $('modal-overlay')) closeModal();
  });

  // Status toggles (add modal)
  $('status-toggle-have')?.addEventListener('click', () => {
    $('status-toggle-have').classList.add('active');
    $('status-toggle-want').classList.remove('active');
  });
  $('status-toggle-want')?.addEventListener('click', () => {
    $('status-toggle-want').classList.add('active');
    $('status-toggle-have').classList.remove('active');
  });
  $('fav-toggle')?.addEventListener('click', () => {
    const active = $('fav-toggle').classList.toggle('active');
    $('fav-toggle').textContent = active ? '★ Favourited' : '☆ Favourite';
  });

  // Edit modal
  $('save-edit-btn')?.addEventListener('click', saveEdit);
  $('cancel-edit-btn')?.addEventListener('click', closeEditModal);
  $('edit-modal-overlay')?.addEventListener('click', e => {
    if (e.target === $('edit-modal-overlay')) closeEditModal();
  });
  $('edit-status-have')?.addEventListener('click', () => {
    $('edit-status-have').classList.add('active');
    $('edit-status-want').classList.remove('active');
  });
  $('edit-status-want')?.addEventListener('click', () => {
    $('edit-status-want').classList.add('active');
    $('edit-status-have').classList.remove('active');
  });
  $('edit-fav-toggle')?.addEventListener('click', () => {
    const active = $('edit-fav-toggle').classList.toggle('active');
    $('edit-fav-toggle').textContent = active ? '★ Favourited' : '☆ Favourite';
  });

  // Filters
  $('filter-type-btns')?.querySelectorAll('[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      State.filters.type = btn.dataset.type;
      $('filter-type-btns').querySelectorAll('[data-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCollection();
    });
  });
  $('filter-status-btns')?.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      State.filters.status = btn.dataset.status;
      $('filter-status-btns').querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCollection();
    });
  });
  $('filter-release')?.addEventListener('change', e => {
    State.filters.release = e.target.value;
    renderCollection();
  });
  $('filter-finish')?.addEventListener('change', e => {
    State.filters.finish = e.target.value;
    renderCollection();
  });
  $('filter-fav-btn')?.addEventListener('click', () => {
    State.filters.favOnly = !State.filters.favOnly;
    $('filter-fav-btn').classList.toggle('active', State.filters.favOnly);
    renderCollection();
  });

  // Sheet ID save
  $('sheet-id-input')?.addEventListener('change', e => {
    localStorage.setItem('azusa_sheet_id', e.target.value.trim());
  });

  // Init GIS
  // google.accounts is loaded async via script tag — handled by onload callback
});

// Called by Google Identity Services script onload
function initGoogleAuth() {
  initAuth();
  // Prefer localStorage override, fall back to hardcoded CONFIG.SHEET_ID
  const saved = localStorage.getItem('azusa_sheet_id') || CONFIG.SHEET_ID;
  if (saved) {
    $('sheet-id-input').value = saved;
    localStorage.setItem('azusa_sheet_id', saved);
  }

  // Restore cached token if still valid (with 60s buffer)
  const cachedToken = localStorage.getItem('azusa_token');
  const cachedExpiry = Number(localStorage.getItem('azusa_token_expires') || 0);
  if (cachedToken && Date.now() < cachedExpiry - 60_000) {
    State.accessToken = cachedToken;
    const sheetId = saved || CONFIG.SHEET_ID;
    Sheets.init(sheetId, () => State.accessToken);
    showApp();
    loadCollection();
    return;
  }

  // No valid cached token — try silent request
  if (saved) {
    State.tokenClient.requestAccessToken({ prompt: '' });
  }
}
