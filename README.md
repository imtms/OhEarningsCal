# OhEarningsCal

<a href="https://trendshift.io/repositories/8148" target="_blank"><img src="https://trendshift.io/api/badge/repositories/8148" alt="jason5ng32%2FOhEarningsCal | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

Subscribe to stock earnings dates from your calendar app, including a watchlist across US, German and French exchanges. This started as a tool I built for myself — I'd rather glance at my calendar than open a brokerage app — and turned out useful enough to open-source.

## Just use it

Visit [this deployment](https://imtms.github.io/OhEarningsCal/), pick a calendar, copy the link, then add it as a calendar subscription in your app of choice.

Index and market-cap calendars use a rolling window of ±30 days around today. The custom watchlist also includes each stock's next available reporting date beyond that window; `selected.ics` includes these custom dates too. Dates from both providers may be estimates, so events are marked tentative and include a source link. Check the company's investor relations calendar before relying on a date.

## Calendars

| File | Contents |
| --- | --- |
| `all.ics` | Every company that reports earnings in the window |
| `nasdaq100.ics` | Nasdaq-100 constituents |
| `sp500.ics` | S&P 500 constituents |
| `dow30.ics` | Dow Jones Industrial Average constituents |
| `customstock.ics` | Next available dates for the `CUSTOM_STOCKS` watchlist, including dates beyond 30 days |
| `selected.ics` | Union of the four above, deduplicated |

## Self-hosting

1. Fork this repo
2. **Settings → Pages → Source** → switch to **GitHub Actions**
3. **Settings → Secrets and variables → Actions → Variables** → add:
   - `SHOULD_GEN_SELECTED` = `true` / `false`
   - `SHOULD_GEN_ALL` = `true` / `false`
   - `CUSTOM_STOCKS` = comma-separated tickers, e.g. `NVDA,BRK.B,TSM,ENR.DE,LR.PA` (leave empty to skip `customstock.ics`)
4. Wait for the next scheduled run, or kick off **Actions → Update earnings calendar → Run workflow** manually.

`CUSTOM_STOCKS` under repository **Variables** is the only watchlist to maintain; no list is hardcoded in the program. Both the fetch and generation steps read it. No API key or additional secrets are required.

### Supported ticker formats and coverage

- US listings: `NVDA`, `JPM`, `TSM`, etc. Nasdaq, NYSE and AMEX are checked automatically, including ADRs. The Nasdaq calendar API covers multiple US exchanges, not only Nasdaq-listed stocks.
- US share classes: `BRK.B`, `BRK-B` and `BRK/B` resolve to `BRK.B`.
- Germany (Xetra): `ENR.DE`.
- France (Euronext Paris): `LR.PA`.
- An explicit TradingView venue can also be used, such as `XETR:ENR`. Unknown suffixes or ambiguous symbols are reported instead of guessed.

Nasdaq provides the near-term US calendar. A single TradingView scanner request resolves the watchlist and supplements missing upcoming dates. If Nasdaq has an upcoming date in its normal window, that date takes priority. TradingView timestamps are converted to the listing's reporting timezone; dates remain all-day events. Supplemental local-currency market caps are not mixed into the USD market-cap calendars.

After every build, the Actions run summary lists each requested ticker, date, source and status. The same coverage is published at [`watchlist-status.json`](https://imtms.github.io/OhEarningsCal/watchlist-status.json). A recognized stock without an upcoming date is reported as `no-upcoming-date`; unknown symbols and provider failures have separate statuses. The calendar does not invent dates for them.

If the supplementary provider is temporarily unavailable, upcoming dates cached in the last seven days are retained and labeled cached in the report. Nasdaq keeps its per-day cache on failure. A run with no usable data from either source fails rather than deploying empty calendars. Existing calendar subscription URLs stay the same; future changes to a stock's date reuse its event UID.

## Automation

| Workflow | Schedule | What it does |
| --- | --- | --- |
| `earnings.yml` | Daily 04:34 / 16:34 UTC | Test → fetch both sources → build ics + coverage report → deploy to GitHub Pages |
| `indices.yml` | Mondays 06:17 UTC | Refresh index constituents from Wikipedia, commit `data/indices/` |

Earnings data is cached in GitHub Actions cache, never in git — `main` only carries source code and the index constituents.

## Local development

```sh
pnpm install
cp .env.example .env   # edit env vars

pnpm fetch:indices     # first run / when refreshing constituents
pnpm test              # source resolution, cache fallback, merging and ICS regression checks
pnpm run fetch         # pull yesterday + next 30 days, plus the watchlist's next available dates
pnpm run gen           # write docs/ics/*.ics and docs/watchlist-status.json
pnpm dev               # http://localhost:18302
```

Convenience endpoints on the dev server:

- `GET /dev/fetch` — trigger one `fetch`
- `GET /dev/fetch-indices` — trigger one `fetch:indices`
- `GET /dev/gen` — trigger one `gen`

## Layout

```
src/
├── lib/        # shared helpers (date, paths, http, fs)
├── config/     # env parsing, index metadata
├── fetch/      # Nasdaq calendar, TradingView watchlist, Wikipedia constituents
├── process/    # filter + dedupe earnings rows
├── generate/   # build .ics files
├── cli/        # entrypoints (fetch / fetch-indices / gen)
└── server.js   # local dev server
data/
├── earnings/   # daily JSON cache (gitignored, GH Actions cache between runs)
└── indices/    # index constituents, refreshed weekly (in git)
docs/
├── index.html  # static landing page
├── CNAME
├── ics/        # generated .ics files (gitignored, written by build)
└── watchlist-status.json # generated per-ticker coverage report (gitignored)
```
