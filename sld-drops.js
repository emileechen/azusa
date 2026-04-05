/**
 * sld-drops.js — Azusa
 * Secret Lair drop name registry.
 * Maps collector number ranges to drop names for SLD basic lands.
 *
 * ── How to add new drops ──
 *
 * Existing entries are stable — only new drops need to be added.
 *
 * 1. Fetch all SLD basic land collector numbers from the Scryfall API:
 *    https://api.scryfall.com/cards/search?q=set:sld+(type:land+type:basic)&unique=prints&order=collector_number
 *    Paginate all pages. Strip ★ suffixes from collector numbers to get unique ints.
 *
 * 2. Filter out any numbers already covered by existing SLD_DROPS ranges.
 *    The remaining numbers are from new drops.
 *
 * 3. Look up each uncovered number on Scryfall (https://scryfall.com/card/sld/{num})
 *    to find which drop it belongs to. Group contiguous numbers into ranges.
 *
 * 4. Append new { name, start, end } entries sorted by start number.
 *    Use \u00AE for ® and \u00E2 for â to keep the file ASCII-safe.
 */

const SLD_DROPS = [
  { name: 'Eldraine Wonderland',                                       start:    1, end:    5  },
  { name: 'The Tokyo Lands',                                           start:   46, end:   50  },
  { name: 'The Godzilla Lands',                                        start:   63, end:   67  },
  { name: 'Happy Little Gathering',                                    start:  100, end:  109  },
  { name: 'Artist Series: Seb McKinnon',                               start:  119, end:  119  },
  { name: 'Brutal Basic Lands',                                        start:  239, end:  243  },
  { name: 'Voracious Reader',                                          start:  254, end:  258  },
  { name: 'PIXELSNOWLANDS.JPG',                                        start:  325, end:  329  },
  { name: 'The Dracula Lands',                                         start:  359, end:  363  },
  { name: 'Zodiac Lands',                                              start:  384, end:  395  },
  { name: 'Shades Not Included',                                       start:  415, end:  419  },
  { name: 'Fortnite: Locations',                                       start:  448, end:  452  },
  { name: 'Artist Series: Sidharth Chaturvedi',                        start:  466, end:  466  },
  { name: 'Artist Series: Magali Villeneuve',                          start:  476, end:  476  },
  { name: 'Arcane: Lands',                                             start:  484, end:  488  },
  { name: 'Artist Series: Seb McKinnon',                               start:  539, end:  539  },
  { name: 'Foil Jumpstart Lands',                                      start:  540, end:  579  },
  { name: 'MSCHF',                                                     start:  670, end:  670  },
  { name: 'Heads I Win, Tails You Lose',                               start:  673, end:  674  },
  { name: 'Artist Series: Magali Villeneuve',                          start:  690, end:  690  },
  { name: 'Warhammer 40,000: Orks',                                    start:  704, end:  704  },
  { name: 'Warhammer Age of Sigmar',                                   start:  705, end:  705  },
  { name: 'Blood Bowl',                                                start:  706, end:  706  },
  { name: 'Fallout: Points of Interest',                               start:  795, end:  795  },
  { name: 'Deceptive Districts',                                       start:  888, end:  892  },
  { name: 'Transformers: One Shall Fall',                              start: 1088, end: 1092  },
  { name: 'Special Guest: Kozyndan: The Lands',                        start: 1130, end: 1134  },
  { name: 'Post Malone: The Lands',                                    start: 1190, end: 1194  },
  { name: 'Angels: They\'re Just Like Us but Cooler and With Wings',   start: 1348, end: 1351  },
  { name: 'Featuring: The Mountain Goats',                             start: 1358, end: 1367  },
  { name: 'Featuring: Gary Baseman',                                   start: 1382, end: 1386  },
  { name: 'Meditations on Nature',                                     start: 1399, end: 1403  },
  { name: 'Pixel Lands 02.jpg',                                        start: 1468, end: 1472  },
  { name: 'Paradise Frost',                                            start: 1473, end: 1477  },
  { name: 'Chaos Vault',                                               start: 1478, end: 1482  },
  { name: 'Raining Cats and Dogs',                                     start: 1513, end: 1515  },
  { name: 'Brain Dead: Lands',                                         start: 1647, end: 1656  },
  { name: 'SpongeBob SquarePants: Lands Under the Sea',                start: 1939, end: 1943  },
  { name: 'Flower Power',                                              start: 1945, end: 1949  },
  { name: 'Marvel\'s Spider-Man: Mana Symbiote',                       start: 1950, end: 1954  },
  { name: 'KEXP: Where the Music Matters',                             start: 2076, end: 2080  },
  { name: 'Chaos Vault: Dand\u00E2n',                                  start: 2144, end: 2147  },
  { name: 'Dungeons & Dragons\u00AE: Lands of the Forgotten Realms',   start: 2509, end: 2513  },
];

/**
 * Look up the drop name for an SLD card by its collector number.
 * Returns the drop name string, or null if not in the registry.
 */
function sldDropName(collectorNumber) {
  const num = parseInt(collectorNumber, 10);
  if (isNaN(num)) return null;
  const drop = SLD_DROPS.find(d => num >= d.start && num <= d.end);
  return drop?.name ?? null;
}

/**
 * Group an array of SLD cards by their drop name.
 * Cards not matching any known drop go under "Secret Lair Drop (Unknown)".
 * Returns array of { name, cards } sorted by collector number descending (newest first).
 */
function groupSldByDrop(cards) {
  const groups = {};
  for (const card of cards) {
    const name = sldDropName(card.collector_number) ?? 'Secret Lair Drop (Unknown)';
    if (!groups[name]) groups[name] = [];
    groups[name].push(card);
  }

  return Object.entries(groups)
    .map(([name, cards]) => ({ name, cards }))
    .sort((a, b) => {
      const aNum = parseInt(a.cards[0].collector_number, 10) || 0;
      const bNum = parseInt(b.cards[0].collector_number, 10) || 0;
      return bNum - aNum;
    });
}
