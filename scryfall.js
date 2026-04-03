/**
 * scryfall.js — Azusa
 * Scryfall API wrapper: search, pagination, finish derivation, set lookup.
 */

const Scryfall = (() => {

  const BASE = 'https://api.scryfall.com';
  const HEADERS = {
    'User-Agent': 'Azusa/1.0',
    'Accept': 'application/json',
  };

  // In-memory cache for set lookups (code → set object)
  const setCache = {};

  // ---------------------------------------------------------------------------
  // Internal: throttled fetch — Scryfall asks for 50–100ms between requests
  // ---------------------------------------------------------------------------
  let lastRequestTime = 0;

  async function throttledFetch(url) {
    const now = Date.now();
    const wait = Math.max(0, 75 - (now - lastRequestTime));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestTime = Date.now();

    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.details ?? `Scryfall error ${res.status}`);
    }
    return res.json();
  }

  // ---------------------------------------------------------------------------
  // Derive a finish key from a Scryfall card object.
  // Returns a raw Scryfall key: 'nonfoil', 'foil', 'etched', 'glossy',
  // or a promo_type like 'surgefoil', 'galaxyfoil', etc.
  // ---------------------------------------------------------------------------
  function deriveFinish(card) {
    if (card._forcedFinish) return card._forcedFinish;

    const promo  = card.promo_types   ?? [];
    const frame  = card.frame_effects ?? [];
    const finish = card.finishes      ?? [];

    if (frame.includes('etched'))  return 'etched';
    if (finish.includes('etched')) return 'etched';
    if (finish.includes('glossy')) return 'glossy';
    if (promo.length > 0)         return promo[0];
    if (finish.includes('foil'))   return 'foil';
    return 'nonfoil';
  }

  // ---------------------------------------------------------------------------
  // Derive whether a card has any foil treatment (for CSS shimmer)
  // ---------------------------------------------------------------------------
  function isFoil(card) {
    return deriveFinish(card) !== 'nonfoil';
  }

  // ---------------------------------------------------------------------------
  // Expand a card into separate entries per finish.
  // A card with finishes: ["nonfoil","foil"] becomes two entries — one forced
  // to nonfoil, one to its derived foil type. Cards with a single finish or
  // a special promo foil type are returned as-is.
  // ---------------------------------------------------------------------------
  function expandFinishes(card) {
    const finishes = card.finishes ?? [];
    const hasNonFoil = finishes.includes('nonfoil');
    const hasFoil    = finishes.includes('foil') || finishes.includes('etched');
    const hasSpecial = (card.promo_types ?? []).length > 0;

    if (hasNonFoil && (hasFoil || hasSpecial)) {
      const nonFoilCopy = { ...card, finishes: ['nonfoil'], _forcedFinish: 'nonfoil' };
      const foilCopy    = { ...card, finishes: finishes.filter(f => f !== 'nonfoil') };
      return [nonFoilCopy, foilCopy];
    }

    return [card];
  }

  // ---------------------------------------------------------------------------
  // Extract the land type from a Scryfall card object.
  // Basic land type_line looks like "Basic Land — Forest"
  // ---------------------------------------------------------------------------
  function deriveLandType(card) {
    const line = card.type_line ?? '';
    const name = card.name ?? '';
    for (const t of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']) {
      if (line.includes(t) || name === t) return t;
    }
    return 'Other';
  }

  // ---------------------------------------------------------------------------
  // Build the Scryfall image URL from a card's scryfall id
  // ---------------------------------------------------------------------------
  function imageUrl(scryfallId, size = 'normal') {
    const a = scryfallId[0];
    const b = scryfallId[1];
    return `https://cards.scryfall.io/${size}/front/${a}/${b}/${scryfallId}.jpg`;
  }

  // ---------------------------------------------------------------------------
  // Fetch all pages of a Scryfall search and return flat array of card objects.
  // Accepts a fully-formed URL (first page) or a query string.
  // ---------------------------------------------------------------------------
  async function fetchAllPages(firstUrl, onProgress) {
    const results = [];
    let url = firstUrl;
    let page = 1;

    while (url) {
      const data = await throttledFetch(url);
      results.push(...(data.data ?? []));
      if (onProgress) onProgress(results.length, data.total_cards ?? null);
      url = data.has_more ? data.next_page : null;
      page++;
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Search for full-art basic lands.
  // setCode is optional — omit to search all sets.
  // onProgress(loaded, total) is called after each page.
  // ---------------------------------------------------------------------------
  async function searchFullArtLands(setCode, onProgress) {
    let q = '(type:land type:basic) is:fullart';
    if (setCode && setCode.trim()) {
      q += ` set:${setCode.trim().toLowerCase()}`;
    }
    const order = setCode ? 'collector_number' : 'released';
    const url = `${BASE}/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=${order}`;
    const cards = await fetchAllPages(url, onProgress);
    // Expand cards with multiple finishes into separate entries
    return cards.flatMap(expandFinishes);
  }

  // ---------------------------------------------------------------------------
  // Look up a set by code. Returns the set object (cached).
  // ---------------------------------------------------------------------------
  async function fetchSet(code) {
    if (!code) return null;
    const key = code.toLowerCase();
    if (setCache[key]) return setCache[key];

    try {
      const data = await throttledFetch(`${BASE}/sets/${key}`);
      setCache[key] = data;
      return data;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Given a card object returned from search, build the full enriched record
  // ready to be stored in Google Sheets.
  // ---------------------------------------------------------------------------
  async function enrichCard(card) {
    const setObj = await fetchSet(card.set);
    const parentSetCode = setObj?.parent_set_code ?? null;

    return {
      set_code:        card.set,
      set_name:        card.set_name,
      parent_set_code: parentSetCode ?? '',
      collector_num:   card.collector_number,
      land_type:       deriveLandType(card),
      scryfall_id:     card.id,
      finish:          deriveFinish(card),
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  return {
    searchFullArtLands,
    fetchSet,
    enrichCard,
    deriveFinish,
    deriveLandType,
    expandFinishes,
    imageUrl,
    isFoil,
  };

})();
