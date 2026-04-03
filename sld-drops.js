/**
 * sld-drops.js — Azusa
 * Secret Lair drop name registry.
 * Maps collector number ranges to drop names for SLD basic lands.
 * Add new entries as new Secret Lair drops are released.
 */

const SLD_DROPS = [
  { name: 'The Tokyo Lands',                                          start:   46, end:   50  },
  { name: 'The Godzilla Lands',                                       start:   63, end:   67  },
  { name: 'Brutal Basic Lands',                                       start:  239, end:  243  },
  { name: 'PIXELSNOWLANDS.JPG',                                       start:  325, end:  329  },
  { name: 'Special Guest: Kozyndan: The Lands',                       start: 1130, end: 1134  },
  { name: 'Pixel Lands 02.jpg',                                       start: 1468, end: 1472  },
  { name: 'SpongeBob SquarePants: Lands Under the Sea',               start: 1939, end: 1943  },
  { name: 'Dungeons & Dragons\u00AE: Lands of the Forgotten Realms',  start: 2509, end: 2513  },
  { name: 'Fallout: Points of Interest',                              start:  795, end:  795  },

  // { name: 'Seb McKinnon: Swamp',            start:  119, end:  119  },
  // { name: 'Ultimate Edition',               start:  359, end:  363  },
  // { name: "Jeanne d'Angelo Lands",          start:  384, end:  395  },
  // { name: 'The Lands',                      start:  415, end:  419  },
  // { name: 'Showcase: Zendikar Revisited',   start:  448, end:  452  },
  // { name: 'Sidharth Chaturvedi: Island',    start:  466, end:  466  },
  // { name: 'Magali Villeneuve: Forest',      start:  476, end:  476  },
  // { name: 'Seb McKinnon: Swamp II',         start:  539, end:  539  },
  // { name: 'MSCHF x Daniel Warren Johnson',  start:  670, end:  674  },
  // { name: 'Magali Villeneuve: Forest II',   start:  690, end:  690  },
  // { name: 'Wastes',                         start:  704, end:  706  },
  // { name: 'AKQA: Wastes',                   start:  795, end:  795  },
  // { name: 'Arcane Lands',                   start:  888, end:  892  },
  // { name: 'Post Malone Lands',              start: 1088, end: 1092  },
  // { name: 'Gary Baseman Lands',             start: 1382, end: 1386  },
  // { name: 'JungShan Lands',                 start: 1399, end: 1403  },
  // { name: 'Winter + Snow Lands',            start: 1468, end: 1482  },
  // { name: 'Alayna Danner Lands',            start: 1513, end: 1515  },
  // { name: 'Concert Lands',                  start: 1647, end: 1656  },
  // { name: 'Psychedelic Lands',              start: 1939, end: 1954  },
  // { name: 'National Park Lands',            start: 2076, end: 2080  },
  // { name: 'Kelogsloops Islands',            start: 2144, end: 2147  },
  // { name: 'Arthur Yuan Lands',              start: 2509, end: 2513  },
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
 * Returns array of { name, cards } sorted by first collector number.
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
      return aNum - bNum;
    });
}
