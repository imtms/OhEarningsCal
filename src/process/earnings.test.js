import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processEarnings } from './earnings.js';
import { earningsCacheFile, watchlistCacheFile } from '../lib/paths.js';
import { writeJSON } from '../lib/fs.js';
import { buildEvent } from '../generate/ics.js';
import { createEvents } from 'ics';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'earnings-process-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await writeJSON(earningsCacheFile('2026-11-07', dataDir), { date: '2026-11-07', data: [
    { symbol: 'BRK/B', name: 'Berkshire Hathaway', time: 'time-not-supplied', marketCap: '$1,000,000,000,000' },
    { symbol: 'NVDA', name: 'NVIDIA', time: 'time-after-hours', marketCap: '$5,000,000,000,000' },
  ] });
  await writeJSON(watchlistCacheFile(dataDir), { stocks: [
    { symbol: 'BRK.B', companyName: 'Berkshire', date: '2027-02-22', timezone: 'America/New_York', status: 'scheduled', source: 'TradingView' },
    { symbol: 'AAPL', companyName: 'Apple', date: '2027-02-04', status: 'scheduled', source: 'TradingView' },
    { symbol: 'ENR.DE', companyName: 'Siemens Energy', date: '2026-11-11', status: 'scheduled', source: 'TradingView' },
    { symbol: 'LR.PA', companyName: 'Legrand', date: '2026-11-05', status: 'cached', source: 'TradingView' },
    { symbol: 'REMOVED', date: '2026-11-06', status: 'scheduled', source: 'TradingView' },
  ] });
  return { dataDir, anchor: '2026-11-04', customSymbols: ['BRK.B', 'AAPL', 'ENR.DE', 'LR.PA'] };
}

test('merges European dates, normalizes Nasdaq share classes and preserves near-term Nasdaq dates', async (t) => {
  const options = await fixture(t);
  const events = await processEarnings({ ...options, includeUpcomingCustom: true });
  const berkshire = events.filter((e) => e.symbol === 'BRK.B');
  assert.equal(berkshire.length, 1);
  assert.equal(berkshire[0].date, '2026-11-07');
  assert.equal(berkshire[0].source, 'Nasdaq');
  assert.equal(berkshire[0].marketCapValue, 1_000_000_000_000);
  assert.equal(events.find((e) => e.symbol === 'AAPL').date, '2027-02-04');
  assert.equal(events.find((e) => e.symbol === 'LR.PA').status, 'cached');
  assert.equal(events.some((e) => e.symbol === 'REMOVED'), false);
});

test('index/all windows stay bounded and empty watchlists remain empty', async (t) => {
  const options = await fixture(t);
  const all = await processEarnings(options);
  assert.equal(all.some((e) => e.symbol === 'AAPL'), false);
  const index = await processEarnings({ ...options, watchlist: [{ symbol: 'BRK-B', companyName: 'Berkshire index name' }] });
  assert.equal(index.length, 1);
  assert.equal(index[0].companyName, 'Berkshire index name');
  assert.deepEqual(await processEarnings({ ...options, watchlist: [] }), []);
  const european = all.find((e) => e.symbol === 'ENR.DE');
  assert.equal(european.marketCapValue, null); // Never bucket a EUR value as USD.
});

test('new upcoming date replaces an old report and removed variables do not leak from cache', async (t) => {
  const options = await fixture(t);
  await writeJSON(earningsCacheFile('2026-11-03', options.dataDir), {
    date: '2026-11-03', data: [{ symbol: 'AAPL', name: 'Apple' }],
  });
  const events = await processEarnings({ ...options, includeUpcomingCustom: true });
  assert.equal(events.find((e) => e.symbol === 'AAPL').date, '2027-02-04');
  const withoutCustom = await processEarnings({ ...options, customSymbols: [] });
  assert.equal(withoutCustom.some((e) => e.symbol === 'ENR.DE'), false);
});

test('ICS updates retain their UID and use all-day tentative events with source details', () => {
  const entry = {
    symbol: 'BRK.B', companyName: 'Berkshire', date: '2026-11-07', source: 'TradingView',
    sourceUrl: 'https://www.tradingview.com/symbols/NYSE-BRK.B/financials-earnings/',
    timezone: 'America/New_York',
  };
  const first = buildEvent(entry);
  const updated = buildEvent({ ...entry, date: '2026-11-08' });
  assert.equal(first.uid, updated.uid);
  assert.equal(first.status, 'TENTATIVE');
  assert.match(first.description, /TradingView/);
  assert.match(first.description, /America\/New_York/);
  assert.match(first.description, /quote\/BRK-B/);
  const { error, value } = createEvents([first]);
  assert.ifError(error);
  assert.match(value, /DTSTART;VALUE=DATE:20261107/);
  assert.match(value, /UID:BRK.B@oh-earnings-cal/);
  assert.match(value, /STATUS:TENTATIVE/);
});
