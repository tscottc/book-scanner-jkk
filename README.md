# Book Scanner JKK

A web-based library inventory management system for the Midwest Attic library. Staff can scan a book's barcode, photograph its cover, or search by title to instantly look up metadata and automatically classify the book to its correct shelf location using AI.

**Live URL:** https://book-scanner-jkk.web.app

---

## What It Does

1. **Identify a book** — via ISBN barcode scan, cover photo, or manual title search
2. **Fetch metadata** — title, author, description pulled from Google Books, Open Library, or web search (cascading fallback)
3. **Classify the book** — Google Gemini AI reads the description and picks the correct library subject, returning a one-sentence explanation of why it chose that category
4. **Show the shelf location** — floor, aisle, and room displayed prominently at the top of the result card so staff can act on it immediately
5. **Save to inventory** — adds the book (with optional notes) to a shared Firestore database

The interface is mobile-first: three large scan-mode tiles on the main screen, AI shelf location in large text as the first result, and secondary actions (save, details, notes) in slide-up bottom sheets.

Access is restricted to authorized staff via Google OAuth + a Firestore allowlist.

---

## Architecture

```
Browser (SPA)
    │
    ├─── Google Books API ──────────────────────► book metadata
    ├─── Open Library API (fallback)  ──────────► book metadata
    │
    └─── Firebase Cloud Functions (backend)
             │
             ├─── Google Gemini 2.5-flash ──────► AI classification
             └─── Serper API ─────────────────── ► web search fallback

Firebase Hosting  ─── serves index.html (SPA)
Firebase Auth     ─── Google OAuth login
Firestore         ─── savedBooks + allowedUsers collections
Firebase Secrets  ─── API keys for Gemini & Serper
```

All sensitive API keys live in Firebase Secrets Manager — the frontend only holds public Firebase config.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS (single `index.html`) |
| Barcode scanning | `html5-qrcode` + `quagga2` |
| CSV parsing | `papaparse` (library directory) |
| Authentication | Firebase Auth (Google OAuth) |
| Database | Firestore (NoSQL) |
| Backend | Firebase Cloud Functions v2 (Node.js 22) |
| AI | Google Gemini 2.5-flash |
| Web search | Serper API |
| Book data | Google Books API + Open Library (both free/public) |
| Hosting | Firebase Hosting |

---

## Repository Structure

```
book-scanner-jkk/
├── firebase.json                     # Hosting, security headers, function config
├── firestore.rules                   # Database access rules
├── .firebaserc                       # Firebase project ID
├── functions/
│   ├── index.js                      # All three Cloud Functions
│   └── package.json                  # Node.js dependencies
└── public/
    ├── index.html                    # Entire frontend (SPA)
    └── Directory VSN. 1.A - Master (All Floors).csv   # Library shelf directory
```

---

## Cloud Functions

### `getBookTopic` — AI classification

**POST** `https://getbooktopic-pom3tqjr6a-uc.a.run.app`

Accepts a book title, description, and the full list of valid subjects. Sends a structured prompt to Gemini and returns a single matching subject. Retries up to 3 times with exponential backoff; times out after 15 seconds; falls back gracefully to the frontend's keyword-matching system.

```json
Request:  { "title": "...", "description": "...", "subjects": ["Fiction", "Business", ...] }
Response: { "subject": "Fiction", "reasoning": "Book is a novel, not a how-to guide.", "timestamp": "..." }
```

The `reasoning` field is a concise sentence Gemini generates explaining why it chose that subject over alternatives. It is displayed directly in the UI below the shelf location.

### `identifyBookCover` — vision-based title extraction

**POST** `https://identifybookcover-pom3tqjr6a-uc.a.run.app`

Accepts a base64-encoded image (JPEG/PNG/WebP, max 5 MB). Passes it to Gemini with a vision prompt and returns the title and author parsed from the cover.

```json
Request:  { "imageBase64": "...", "mimeType": "image/jpeg" }
Response: { "title": "...", "author": "..." }
```

### `webSearch` — Serper fallback

**POST** `https://us-central1-book-scanner-jkk.cloudfunctions.net/webSearch`

Proxies a query to Serper and returns the top 5 organic results. Used when neither Google Books nor Open Library can find a book.

```json
Request:  { "query": "The Great Gatsby book" }
Response: { "results": [{ "title": "...", "snippet": "...", "link": "..." }] }
```

All three functions require a Firebase ID token in the `Authorization: Bearer <token>` header.

---

## Library Directory (CSV)

`public/Directory VSN. 1.A - Master (All Floors).csv` is the master shelf map. It is loaded client-side at startup and drives both the subject dropdown and the keyword-matching fallback.

| Column | Description |
|--------|------------|
| `SUBJECT` | Library shelf label (e.g., "Fiction", "Business") |
| `FLOOR` | Building floor number |
| `AISLE` | Aisle number(s) on that floor |
| `ROOM/DESCRIPTION` | Physical location descriptor |
| `KEYWORDS` | Comma-separated words used for text matching |

When the CSV is updated (new subjects, reorganized shelves), just replace the file and redeploy hosting — no code changes needed.

---

## Firestore Schema

**`savedBooks/{docId}`**
```
title, author, isbn, description, subject, floor, aisle, room,
notes, source, savedBy, savedAt (server timestamp), updatedAt (server timestamp)
```

`source` is one of: `isbn_scan`, `cover_scan`, `book_search`, `web_search`, `manual`

**`allowedUsers/{email}`**
Presence of the document grants access. The frontend reads the user's own document after login; no document = access denied.

---

## Book Lookup Fallback Chain

The system tries three external sources before giving up, in this order:

| Step | Source | Notes |
|------|--------|-------|
| 1 | Google Books API | Primary; handles ISBN, title, cover author+title |
| 2 | Open Library API | Handles Google Books 429 quota errors |
| 3 | Serper Web Search | Last resort; returns snippets for AI or manual review |

For **barcode scans**, it also tries ISBN-10/ISBN-13 variants automatically.

---

## Classification: AI vs. Keyword Matching

### AI (primary)
The frontend calls `getBookTopic` with the book's title, description, and the full subject list. Gemini selects the best match and returns a one-sentence reasoning string. The shelf location and reasoning are displayed together in the result card with an **AI** badge.

### Keyword matching (fallback)
Each directory row has keywords. The frontend scores every subject by counting keyword hits in the description (multi-word phrases score 10×, single words score 1×). The top scorer wins. Shown with a **Keyword** badge.

`USE_AI_CLASSIFICATION = true` in `index.html` can be flipped to `false` to disable AI and always use keywords.

---

## Barcode Scanning Details

- Requires **3 consecutive confirmations** of the same code to avoid misreads
- Supported formats: EAN-13, EAN-8, UPC-A, UPC-E
- ISBN-10 codes are auto-converted to ISBN-13 for lookup
- Camera access is requested in the browser; user must grant permission

---

## Setup & Deployment

### Prerequisites

- Node.js 22+
- Firebase CLI: `npm install -g firebase-tools`
- A Google Cloud project with:
  - Firebase enabled
  - Gemini API enabled (for `getBookTopic` and `identifyBookCover`)
  - Serper API key (optional, for web search fallback)

### First-time setup

```bash
# Clone and install backend dependencies
git clone <repo-url>
cd book-scanner-jkk/functions
npm install
cd ..

# Authenticate and select the Firebase project
firebase login
firebase use --add

# Store secret API keys
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set SERPER_API_KEY

# Add yourself to the allowlist in Firestore:
# Collection: allowedUsers / Document ID: your@email.com
```

### Deploy

```bash
# Full deploy (hosting + functions)
firebase deploy

# Hosting only (after CSV or index.html changes)
firebase deploy --only hosting

# Functions only
firebase deploy --only functions
```

### Local development

```bash
cd functions
npm run serve     # Start Firebase emulator
npm run lint      # Lint Cloud Functions (also runs on deploy)
npm run shell     # Interactive Cloud Function testing shell
```

---

## Security

- **Authentication**: Firebase Auth with Google OAuth; only addresses in `allowedUsers` can proceed
- **Authorization header**: All Cloud Functions verify Firebase ID tokens before executing
- **CORS**: Cloud Functions only accept requests from `book-scanner-jkk.web.app` and `book-scanner-jkk.firebaseapp.com`
- **Firestore rules**: Authenticated users can read/write `savedBooks`; `allowedUsers` is read-only for the matching email
- **Security headers** (via `firebase.json`):
  - `Strict-Transport-Security` (HSTS, 1 year)
  - `Content-Security-Policy` (restricts scripts, styles, connect sources to known domains)
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- **Input validation**: All Cloud Function inputs are length-capped; images are type- and size-checked before being sent to Gemini

---

## Adding Authorized Users

Open the Firebase console → Firestore → `allowedUsers` collection → add a document whose **ID is the user's Google email address**. No fields are required; presence of the document is sufficient.

---

## Troubleshooting

An on-screen **debug panel** (bottom of the page, collapsible) shows a timestamped log of every API call, fallback attempt, and error in real time. Check it first when a lookup fails.

| Symptom | Likely cause |
|---------|-------------|
| "Your account is not authorized" | Email not in `allowedUsers` |
| "Unable to start camera" | Browser camera permission denied |
| Google Books returns nothing | Rate limit hit; Open Library fallback should trigger automatically |
| AI classification slow or failing | Gemini quota; keyword matching takes over automatically |
| Cover scan returns wrong book | Image quality too low; try a clearer, straight-on photo |
| "Image exceeds 5 MB" | Compress the photo before uploading |

For persistent Cloud Function errors:

```bash
firebase functions:log
```

---

## Environment / Constants Reference

These values are set directly in `public/index.html` and `functions/index.js`:

| Constant | Location | Default | Purpose |
|----------|----------|---------|---------|
| `USE_AI_CLASSIFICATION` | index.html | `true` | Enable/disable Gemini classification |
| `REQUIRED_CONFIRMATIONS` | index.html | `3` | Barcode scans needed to confirm a read |
| `MODEL_NAME` | functions/index.js | `gemini-2.5-flash` | Gemini model version |
| `MAX_RETRIES` | functions/index.js | `2` | Gemini retry attempts |
| `TIMEOUT_MS` | functions/index.js | `15000` | Gemini timeout (ms) |
| `MAX_IMAGE_BYTES` | functions/index.js | `5242880` | Cover image size limit (5 MB) |
