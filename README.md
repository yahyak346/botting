# Drop Monitor

A restock and new-drop monitor with Discord alerts and a local dashboard. It watches
Shopify stores and ordinary product pages, and pings you when something you care
about shows up, restocks, changes price or sells out.

It only **monitors and notifies**. It never checks out. It uses an honest user agent,
polls no more often than every 30 seconds, backs off on errors and respects
`Retry-After`, so it stays well clear of what stores treat as abuse.

## Quick start

Requires Node.js 22.18+ (TypeScript runs natively, no build step).

```bash
cd botting
npm install        # dev tools only (typescript, @types/node); no runtime deps
cp .env.example .env   # optional: set DISCORD_WEBHOOK_URL
npm start
```

Open http://localhost:3001, paste your Discord webhook, add a monitor, and hit **Send test**.

## Monitor types

| Type | What it watches | Alerts |
| --- | --- | --- |
| **Shopify store** | `https://store.com` or `https://store.com/collections/<name>` (reads the public `products.json` feed) | new product, restock (lists which sizes), price change, sold out |
| **Any page** | Any URL. Scripts, styles and markup are stripped before comparing | keyword **appears** (e.g. "Add to cart"), keyword **disappears** (e.g. "Sold out"), or text **changes** |

- **Include / exclude keywords** (Shopify) filter by product title, case-insensitive:
  include `dunk, jordan`, exclude `kids, toddler`.
- The first check of each monitor just records a baseline. Alerts start from the second check.
- Each monitor can override the default webhook, e.g. one Discord channel per store.

## How it works

```
src/
  index.ts             entrypoint: loads .env + data, starts engine and dashboard
  engine.ts            per-monitor scheduler (interval, jitter, exponential backoff)
  monitors/shopify.ts  products.json fetch + diff (new / restock / price / sold out)
  monitors/page.ts     HTML -> text, keyword / change detection
  notify/discord.ts    webhook embeds, honours Discord rate limits
  server.ts            dashboard + REST API + live feed (Server-Sent Events)
  store.ts             JSON persistence in data/db.json (atomic writes)
  validate.ts          input validation for the API
public/index.html      the dashboard (vanilla JS)
```

State (monitors, last snapshots, last 500 events, settings) lives in `data/db.json`,
so restarts don't re-alert on everything.

### API

All write requests need `Content-Type: application/json`.

| Method | Path | |
| --- | --- | --- |
| GET | `/api/monitors` | list monitors with live status |
| POST | `/api/monitors` | create (`kind`, `url`, `name?`, `intervalSec?`, `include?`, `exclude?`, `keyword?`, `pageMode?`, `webhookUrl?`) |
| PATCH | `/api/monitors/:id` | update any of the above, or `enabled` |
| DELETE | `/api/monitors/:id` | remove |
| POST | `/api/monitors/:id/run` | check now |
| GET | `/api/events` | recent events |
| GET | `/api/stream` | live events + status (SSE) |
| GET/PUT | `/api/settings` | default webhook |
| POST | `/api/test-webhook` | send a test alert |

### Security

The dashboard has no login, so it binds to `127.0.0.1` only. It also rejects
requests whose `Host` isn't localhost (DNS rebinding) and non-JSON writes
(cross-site form posts). Webhook URLs are masked in API responses. Don't expose
the port publicly without adding auth.

## Development

```bash
npm test           # node:test unit tests
npm run typecheck  # tsc --noEmit
npm run dev        # restart on file changes
```

## Ideas for next steps

- More notifiers (Telegram, Slack, ntfy/Pushover for phone push)
- Per-size filters (only alert when size 10 restocks)
- Price-drop thresholds ("alert below $90")
- Release calendar view built from new-product events
