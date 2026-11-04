import { fetchWithRetry } from '../lib/http.js';
import { readJSONIfExists, writeJSON } from '../lib/fs.js';
import { watchlistCacheFile } from '../lib/paths.js';
import { normalizeSymbol, tradingViewSymbols } from '../lib/symbols.js';
import { todayISO } from '../lib/date.js';

const SCANNER_URL = 'https://scanner.tradingview.com/global/scan';
const COLUMNS = ['description', 'timezone', 'earnings_release_next_date', 'earnings_release_next_time'];
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// The timestamp describes the reporting venue's day, which may differ from UTC.
export function reportingDate(timestamp, timezone) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0 || !timezone) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(timestamp * 1000));
  } catch {
    return null;
  }
}

export async function fetchWatchlistEarnings(symbols, {
  anchor = todayISO(),
  file = watchlistCacheFile(),
  request = fetchWithRetry,
  now = new Date(),
} = {}) {
  const requested = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
  const candidates = new Map(requested.map((symbol) => [symbol, tradingViewSymbols(symbol)]));
  const tickers = [...new Set([...candidates.values()].flat())];
  const fetchedAt = now.toISOString();
  let rows = new Map();
  let failure;

  if (tickers.length) {
    try {
      const response = await request(SCANNER_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbols: { tickers }, columns: COLUMNS, range: [0, tickers.length] }),
      }, { retries: 2 });
      const payload = await response.json();
      if (!Array.isArray(payload?.data) || payload.data.some((row) =>
        typeof row.s !== 'string' || !Array.isArray(row.d) || row.d.length !== COLUMNS.length)) {
        throw new Error('Invalid TradingView scanner response');
      }
      rows = new Map(payload.data.map((row) => [row.s, row.d]));
    } catch (err) {
      failure = err.message;
      console.warn(`[watchlist] fetch failed: ${failure}`);
    }
  }

  const previous = failure ? await readJSONIfExists(file) : null;
  const stocks = requested.map((symbol) => {
    const options = candidates.get(symbol);
    if (!options.length) return { symbol, status: 'unsupported-symbol' };
    if (failure) {
      const cached = previous?.stocks?.find((stock) => stock.symbol === symbol);
      const age = now.getTime() - Date.parse(cached?.fetchedAt);
      if (cached?.date >= anchor && age >= 0 && age <= MAX_CACHE_AGE_MS) {
        return { ...cached, status: 'cached', error: failure };
      }
      return { symbol, status: 'fetch-failed', error: failure };
    }
    const matches = options.filter((ticker) => rows.has(ticker));
    if (!matches.length) return { symbol, status: 'not-found' };
    if (matches.length > 1) return { symbol, status: 'ambiguous', matches };
    const providerSymbol = matches[0];
    const [companyName, timezone, timestamp, time] = rows.get(providerSymbol);
    const date = reportingDate(timestamp, timezone);
    return {
      symbol, companyName, providerSymbol, timezone, fetchedAt,
      source: 'TradingView',
      sourceUrl: `https://www.tradingview.com/symbols/${providerSymbol.replace(':', '-')}/financials-earnings/`,
      dateStatus: 'unconfirmed',
      status: date && date >= anchor ? 'scheduled' : 'no-upcoming-date',
      date: date && date >= anchor ? date : null,
      time: time === -1 ? 'Pre-market' : time === 1 ? 'After-hours' : '',
    };
  });

  const result = { fetchedAt, stocks };
  await writeJSON(file, result);
  const scheduled = stocks.filter((stock) => stock.date).length;
  console.log(`[watchlist] ${scheduled}/${requested.length} upcoming dates; ${stocks.filter((s) => s.status === 'cached').length} cached`);
  for (const stock of stocks.filter((s) => !s.date)) console.warn(`[watchlist] ${stock.symbol}: ${stock.status}`);
  return result;
}
