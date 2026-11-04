import { readJSONIfExists, writeJSON } from '../lib/fs.js';
import { DOCS_DIR, indexFile, watchlistCacheFile } from '../lib/paths.js';
import { resolve } from 'node:path';
import { processEarnings } from '../process/earnings.js';
import { writeIcsFile } from '../generate/ics.js';
import { INDICES, CUSTOM_SLUG, SELECTED_SLUG, ALL_SLUG, MARKETCAP_TIERS } from '../config/indices.js';
import { env } from '../config/env.js';
import { normalizeSymbol } from '../lib/symbols.js';

async function loadIndex(slug) {
  const rows = await readJSONIfExists(indexFile(slug));
  if (!rows) {
    console.warn(`[gen] missing data/indices/${slug}.json — run 'pnpm fetch:indices' first`);
    return [];
  }
  return rows;
}

async function buildCustomWatchlist(allIndexRows) {
  if (env.customStocks.length === 0) return null;
  const lookup = new Map(allIndexRows.map((r) => [normalizeSymbol(r.symbol), r]));
  return env.customStocks.map((sym) => {
    const hit = lookup.get(sym);
    return hit ?? { symbol: sym, companyName: sym, industry: '' };
  });
}

async function genForList(slug, label, watchlist, includeUpcomingCustom = false) {
  const events = await processEarnings({ watchlist, customSymbols: env.customStocks, includeUpcomingCustom });
  await writeIcsFile({ slug, label, events });
  return events;
}

async function main() {
  // 1. Load each index's constituents and write their ics.
  const allIndexRows = [];
  for (const meta of INDICES) {
    const rows = await loadIndex(meta.slug);
    allIndexRows.push(...rows);
    await genForList(meta.slug, meta.label, rows);
  }

  // 2. Custom watchlist (driven by CUSTOM_STOCKS env var).
  const customWatchlist = await buildCustomWatchlist(allIndexRows);
  let customEvents = [];
  if (customWatchlist) {
    customEvents = await genForList(CUSTOM_SLUG, 'Custom Watchlist', customWatchlist, true);
  } else {
    console.log('[gen] CUSTOM_STOCKS not set — skipping customstock.ics');
  }

  // Publish coverage even when a company has no date, instead of silently omitting it.
  const cached = await readJSONIfExists(watchlistCacheFile());
  const stocks = env.customStocks.map((symbol) => {
    const event = customEvents.find((entry) => entry.symbol === symbol);
    const resolution = cached?.stocks?.find((entry) => entry.symbol === symbol);
    return {
      symbol,
      companyName: event?.companyName || resolution?.companyName || symbol,
      status: event?.date >= new Date().toISOString().slice(0, 10) ? 'scheduled' : resolution?.status || 'not-fetched',
      date: event?.date || null,
      source: event?.source || resolution?.source || null,
      sourceUrl: event?.sourceUrl || resolution?.sourceUrl || null,
      dateStatus: event?.dateStatus || 'unconfirmed',
      timezone: event?.timezone || resolution?.timezone || null,
      dataStatus: event?.status === 'cached' ? 'cached' : resolution?.status === 'fetch-failed' ? 'fetch-failed' : 'fresh',
      fetchedAt: resolution?.fetchedAt || null,
    };
  });
  await writeJSON(resolve(DOCS_DIR, 'watchlist-status.json'), {
    generatedAt: new Date().toISOString(),
    total: stocks.length,
    scheduled: stocks.filter((stock) => stock.status === 'scheduled').length,
    stocks,
  });

  // 3. selected = union of all indices + custom (de-dup by symbol).
  if (env.shouldGenSelected) {
    const seen = new Set();
    const selected = [];
    for (const r of [...allIndexRows, ...(customWatchlist ?? [])]) {
      const sym = normalizeSymbol(r.symbol);
      if (seen.has(sym)) continue;
      seen.add(sym);
      selected.push(r);
    }
    await genForList(SELECTED_SLUG, 'Selected (Indices + Custom)', selected, true);
  }

  // 4. all + market-cap tiers — both derived from the unfiltered full set.
  //    Always compute the full set so tiers can be generated regardless of
  //    SHOULD_GEN_ALL; only the all.ics write is gated on the flag.
  const allEvents = await processEarnings({ watchlist: null, customSymbols: env.customStocks });
  if (env.shouldGenAll) {
    await writeIcsFile({ slug: ALL_SLUG, label: 'All Earnings', events: allEvents });
  }
  for (const tier of MARKETCAP_TIERS) {
    const events = allEvents.filter(
      (e) => e.marketCapValue !== null && e.marketCapValue >= tier.min && e.marketCapValue < tier.max,
    );
    await writeIcsFile({ slug: tier.slug, label: tier.label, events });
  }

  console.log('[gen] done.');
}

await main();
