# Workflow templates

Importable n8n workflows built on the AnyAPI gateway. Import via **Workflows -> Import from File** (or paste the JSON into a new workflow).

## Daily Viral Content Radar Pro

`daily-viral-content-radar-pro.json`

Each morning it finds the short-form videos actually going viral in your niche (TikTok, Reels, YouTube, X), reads their real transcripts, and emails you why each blew up plus a 3-step copy-it plan and a ready-to-shoot script. One AnyAPI key powers every source.

### Setup

1. **AnyAPI key** - create an `HTTP Header Auth` credential with header `Authorization` = `Bearer <your-anyapi-key>`, and select it on every HTTP Request node (the source searches, the website scrape, and the Deep Scrape tool). Get a key at https://getanyapi.com.
2. **Model** - the AI Agent nodes use OpenRouter; add your OpenRouter credential (or swap in any chat model node).
3. **Gmail** - connect a Gmail credential on `Email the Brief` and set `sendTo` to your address (placeholder: `you@example.com`).
4. **Data Table** - create an n8n Data Table named `niche_store` with columns `key`, `niche`, `keywords`, then point the `Save Niche` and `Read Niche` nodes at it (placeholder id: `REPLACE_WITH_YOUR_DATA_TABLE_ID`).
5. **Google Sheet (optional archive)** - point `Log Viral Finds` at a sheet whose first row is `Date | Platform | Author | URL | WhyViral` (placeholder id: `REPLACE_WITH_YOUR_SHEET_ID`). This branch is non-fatal, so you can leave it unconfigured.

### Run

- Open the `Onboard Your Website` form once and submit your URL. AnyAPI scrapes it, the model reads back your niche plus the keywords your audience searches, and they are saved to the Data Table.
- `Every Morning 8AM` then runs the daily radar on schedule (enable the workflow to activate it).
