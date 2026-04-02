# ◆ Azusa — MTG Full Art Land Tracker

A personal web app for tracking your Magic: The Gathering full art land collection. Browse cards via Scryfall, track have/want status and foil finishes, and organise into cycles — all backed by your own Google Sheet.

---

## Features

- **Browse by set** — fetch full art basics from any set via Scryfall
- **Finish auto-detection** — surge foil, galaxy foil, etched foil, and more are identified automatically
- **Cycle grouping** — cards from the same set and finish are grouped as cycles
- **Favourite** — star individual cards or entire cycles
- **Two views** — card grid with art thumbnails, or sortable table
- **Google Sheets backend** — your data lives in a sheet you own and control

---

## Setup

### 1. Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown → **New Project** → name it `azusa` → **Create**

### 2. Enable the Google Sheets API

1. Go to **APIs & Services → Library**
2. Search **Google Sheets API** → click it → **Enable**

### 3. OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Choose **External** → **Create**
3. Fill in App name (`Azusa`), your email for support + developer contact
4. Click through Scopes (no changes needed)
5. Under **Test Users**, add your Gmail address
6. Save — the app stays in Testing mode, which is fine for personal use

### 4. Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `Azusa Web`
5. Under **Authorized JavaScript origins**, add:
   - `http://localhost` (for local use)
   - Your deployed URL if applicable (e.g. `https://yourname.github.io`)
6. Click **Create** → copy your **Client ID**

### 5. Set Up Your Google Sheet

1. Create a new blank sheet at [sheets.google.com](https://sheets.google.com)
2. Rename the first tab to `lands`
3. Paste this header row into Row 1 (Tab-separated):

```
id	set_code	set_name	parent_set_code	collector_num	land_type	scryfall_id	finish	status	favourite
```

4. Copy your **Sheet ID** from the URL:
   `https://docs.google.com/spreadsheets/d/`**`COPY_THIS_PART`**`/edit`

### 6. Configure the App

Open `app.js` and fill in your Client ID at the top:

```js
const CONFIG = {
  CLIENT_ID: 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com',
  SHEET_ID:  '',  // You can also paste this in the app UI
  ...
};
```

### 7. Run

Open `index.html` directly in your browser, or deploy to GitHub Pages:

1. Push the `azusa/` folder to a GitHub repo
2. Go to **Settings → Pages → Source → Deploy from branch → main**
3. Add your GitHub Pages URL to **Authorized JavaScript origins** in your OAuth credential

---

## Usage

### Adding cards
1. Click **+ Add Card**
2. Optionally type a set code (e.g. `znr`, `tmt`) and click **Fetch**
3. Leave blank to browse all full art basics ever printed
4. Click a card to select it
5. Set **Have** or **Want**, optionally star it, click **Save**

### Favouriting
- Click ☆ on an individual card to favourite it
- Click ☆ on a cycle header to favourite the whole cycle
- Filter to favourites only using the **★ Favourites** button

### Filters
- Filter by land type, release, finish, and have/want status
- All filters work together and are applied instantly

---

## File Structure

```
azusa/
├── index.html     — App shell and all UI markup
├── style.css      — All styles and animations
├── app.js         — UI logic, state, grouping, cycle detection
├── sheets.js      — Google Sheets API v4 wrapper
├── scryfall.js    — Scryfall search, finish derivation, set lookup
└── README.md      — This file
```

---

## Data

Your sheet stores 10 columns per card:

| Column | Field | Description |
|--------|-------|-------------|
| A | id | Unique ID (auto-generated) |
| B | set_code | Scryfall set code (e.g. `tmt`) |
| C | set_name | Set display name |
| D | parent_set_code | Parent set code for grouping |
| E | collector_num | Collector number (string) |
| F | land_type | Plains / Island / Swamp / Mountain / Forest / Wastes |
| G | scryfall_id | Scryfall UUID (used for image URLs) |
| H | finish | Auto-derived finish label (e.g. Surge foil) |
| I | status | `have` or `want` |
| J | favourite | `TRUE` or `FALSE` |

Card art is fetched live from Scryfall — nothing is stored locally.

---

## Roadmap

- v1.1 — Showcase cards tab
- v1.2 — Condition tracking (NM / LP / MP / HP / DMG)
- v1.3 — Price fetch + collection value
- v1.4 — CSV export
- v2.0 — Trade tracking

---

*Built with Scryfall API + Google Sheets API. Card images © Wizards of the Coast.*
