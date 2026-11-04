import { fetchWithRetry, sleep } from '../lib/http.js';
import { writeJSON, readJSONIfExists } from '../lib/fs.js';
import { earningsCacheFile } from '../lib/paths.js';
import { dateRange, parseNasdaqAsOf, shiftDays, todayISO } from '../lib/date.js';
import { fetchWatchlistEarnings } from './watchlist.js';
import { env } from '../config/env.js';

const NASDAQ_URL = 'https://api.nasdaq.com/api/calendar/earnings';

// Window we keep on disk: yesterday + next 30 days.
const BEFORE_DAYS = 1;
const AHEAD_DAYS = 30;

async function fetchOneDay(isoDate) {
  const res = await fetchWithRetry(`${NASDAQ_URL}?date=${isoDate}`, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      origin: 'https://www.nasdaq.com',
      referer: 'https://www.nasdaq.com/',
    },
  });
  const payload = await res.json();
  if (!payload?.data || !Object.hasOwn(payload.data, 'rows') ||
      (payload.data.rows !== null && !Array.isArray(payload.data.rows))) {
    throw new Error('Invalid Nasdaq earnings response');
  }
  const asOf = parseNasdaqAsOf(payload?.data?.asOf) ?? isoDate;
  const rows = payload?.data?.rows ?? null; // null on weekends/holidays
  return { date: asOf, data: rows };
}

/**
 * Fetch the rolling earnings window starting `BEFORE_DAYS` before `anchor`.
 * Writes one JSON file per date into `data/earnings/`.
 * On per-day failure, keeps any existing cached file (best-effort, never throws).
 */
export async function fetchEarningsWindow(anchor = todayISO()) {
  const start = shiftDays(anchor, -BEFORE_DAYS);
  const dates = [...dateRange(start, BEFORE_DAYS + AHEAD_DAYS + 1)];
  const results = { saved: 0, kept: 0, failed: 0, rows: 0 };

  for (const date of dates) {
    try {
      const day = await fetchOneDay(date);
      await writeJSON(earningsCacheFile(date), day);
      results.saved++;
      results.rows += day.data?.length ?? 0;
      console.log(`[earnings] saved ${date} (${day.data?.length ?? 0} rows)`);
    } catch (err) {
      const cached = await readJSONIfExists(earningsCacheFile(date));
      if (cached) {
        results.kept++;
        results.rows += cached.data?.length ?? 0;
        console.warn(`[earnings] ${date} fetch failed, kept cached copy`);
      } else {
        results.failed++;
        console.error(`[earnings] ${date} failed and no cache: ${err.message}`);
      }
    }
    await sleep(120);
  }

  console.log(
    `[earnings] window done — saved=${results.saved} kept=${results.kept} failed=${results.failed}`,
  );
  return results;
}

// Both the CLI and dev endpoint must use the same multi-source fetch.
export async function fetchAllEarnings(anchor = todayISO()) {
  const [nasdaq, watchlist] = await Promise.all([
    fetchEarningsWindow(anchor),
    fetchWatchlistEarnings(env.customStocks, { anchor }),
  ]);
  if (!nasdaq.rows && !watchlist.stocks.some((s) => s.date)) {
    throw new Error('No earnings data available; refusing to publish empty calendars');
  }
  return { nasdaq, watchlist };
}
