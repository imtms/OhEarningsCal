import { readJSONIfExists } from '../lib/fs.js';
import { DATA_DIR, earningsCacheFile, watchlistCacheFile } from '../lib/paths.js';
import { dateRange, shiftDays, todayISO } from '../lib/date.js';
import { parseMarketCap } from '../lib/marketcap.js';
import { normalizeSymbol } from '../lib/symbols.js';

const DEFAULT_WINDOW = { before: 30, after: 30 };

function normalizeTime(raw) {
  if (raw === 'time-pre-market') return 'Pre-market';
  if (raw === 'time-after-hours' || raw === 'time-after-market') return 'After-hours';
  return '';
}

function toEvent(row, dateISO, watchlistEntry) {
  const symbol = normalizeSymbol(row.symbol);
  return {
    symbol,
    date: dateISO,
    marketCap: row.marketCap || 'N/A',
    marketCapValue: parseMarketCap(row.marketCap),
    fiscalQuarterEnding: row.fiscalQuarterEnding || '',
    time: normalizeTime(row.time),
    epsForecast: row.epsForecast || '',
    noOfEsts: row.noOfEsts || '',
    companyName: (watchlistEntry?.companyName !== symbol && watchlistEntry?.companyName) || row.name || symbol,
    industry: watchlistEntry?.industry || '',
    source: 'Nasdaq',
    sourceUrl: `https://www.nasdaq.com/market-activity/earnings?date=${dateISO}`,
    dateStatus: 'unconfirmed',
  };
}

/**
 * Read every cached earnings day in [anchor-before, anchor+after] and produce
 * a normalized, deduplicated, date-sorted list of events.
 *
 * @param {object} opts
 * @param {string} [opts.anchor]    YYYY-MM-DD, defaults to today
 * @param {{before:number, after:number}} [opts.window]
 * @param {Array<{symbol:string, companyName?:string, industry?:string}> | null} [opts.watchlist]
 *        null = no filter (include every ticker the API returned)
 *        []   = filter everything out (returns [])
 *        [..] = keep only listed tickers, enriching companyName/industry from the entry
 * @param {string[]} [opts.customSymbols] Current CUSTOM_STOCKS; ignores removed cached symbols.
 * @param {boolean} [opts.includeUpcomingCustom] Include the next custom date beyond the normal window.
 * @param {string} [opts.dataDir] Cache root, defaults to the project's data/ directory.
 */
export async function processEarnings({
  anchor = todayISO(),
  window = DEFAULT_WINDOW,
  watchlist = null,
  customSymbols = [],
  includeUpcomingCustom = false,
  dataDir = DATA_DIR,
} = {}) {
  const start = shiftDays(anchor, -window.before);
  const totalDays = window.before + window.after + 1;

  const end = shiftDays(anchor, window.after);
  const filterMap = watchlist ? new Map(watchlist.map((w) => [normalizeSymbol(w.symbol), w])) : null;
  const events = [];

  for (const date of dateRange(start, totalDays)) {
    const day = await readJSONIfExists(earningsCacheFile(date, dataDir));
    if (!day || !Array.isArray(day.data)) continue; // weekend / missing / no data

    for (const row of day.data) {
      const sym = normalizeSymbol(row.symbol);
      if (!sym) continue;
      if (filterMap && !filterMap.has(sym)) continue;
      events.push(toEvent(row, day.date || date, filterMap?.get(sym)));
    }
  }

  // Dedup by symbol — keeps the latest occurrence (Map overwrites on duplicate keys).
  const bySymbol = new Map(events.map((e) => [e.symbol, e]));
  const customSet = new Set(customSymbols.map(normalizeSymbol));
  const supplemental = await readJSONIfExists(watchlistCacheFile(dataDir));
  for (const stock of supplemental?.stocks ?? []) {
    const symbol = normalizeSymbol(stock.symbol);
    if (!customSet.has(symbol) || (filterMap && !filterMap.has(symbol))) continue;
    const nasdaq = bySymbol.get(symbol);
    // Keep Nasdaq's near-term US calendar, adding metadata for non-index stocks.
    if (nasdaq) {
      if (nasdaq.companyName === symbol && stock.companyName) nasdaq.companyName = stock.companyName;
      nasdaq.timezone = stock.timezone;
      nasdaq.providerSymbol = stock.providerSymbol;
    }
    if (!stock.date || stock.date < anchor || !['scheduled', 'cached'].includes(stock.status)) continue;
    if (stock.date > end && !includeUpcomingCustom) continue;
    if (nasdaq?.date >= anchor) continue;
    const enrichment = filterMap?.get(symbol);
    bySymbol.set(symbol, {
      ...stock,
      symbol,
      companyName: (enrichment?.companyName !== symbol && enrichment?.companyName) || stock.companyName || symbol,
      industry: enrichment?.industry || '',
      marketCap: 'N/A', // The global feed's market caps use local currencies.
      marketCapValue: null,
    });
  }
  const dedup = Array.from(bySymbol.values());
  dedup.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return dedup;
}
