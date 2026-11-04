import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchWatchlistEarnings, reportingDate } from './watchlist.js';
import { readJSON, writeJSON } from '../lib/fs.js';
import { normalizeSymbol, tradingViewSymbols, yahooSymbol } from '../lib/symbols.js';

async function cache(t) {
  const dir = await mkdtemp(join(tmpdir(), 'earnings-watchlist-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'watchlist.json');
}

const timestamp = (date) => Date.parse(date) / 1000;
const now = new Date('2026-11-04T12:00:00Z');

test('resolves US share classes and European exchanges without confusing suffixes', () => {
  assert.equal(normalizeSymbol(' brk/b '), 'BRK.B');
  assert.equal(yahooSymbol('BRK.B'), 'BRK-B');
  assert.deepEqual(tradingViewSymbols('BRK-B'), ['NASDAQ:BRK.B', 'NYSE:BRK.B', 'AMEX:BRK.B']);
  assert.deepEqual(tradingViewSymbols('ENR.DE'), ['XETR:ENR']);
  assert.deepEqual(tradingViewSymbols('LR.PA'), ['EURONEXT:LR']);
  assert.deepEqual(tradingViewSymbols('XETR:ENR'), ['XETR:ENR']);
  assert.deepEqual(tradingViewSymbols('ABC.UNKNOWN'), []);
  assert.deepEqual(tradingViewSymbols('../NVDA'), []);
});

test('uses the reporting timezone at UTC date boundaries and rejects unknown dates', () => {
  assert.equal(reportingDate(timestamp('2026-11-05T00:30:00Z'), 'America/New_York'), '2026-11-04');
  assert.equal(reportingDate(timestamp('2026-11-04T23:30:00Z'), 'Europe/Paris'), '2026-11-05');
  for (const value of [null, 0, '1793860200', NaN]) assert.equal(reportingDate(value, 'Europe/Paris'), null);
  assert.equal(reportingDate(timestamp('2026-11-05T12:00:00Z'), 'Invalid/Zone'), null);
  assert.equal(reportingDate(timestamp('2026-11-05T12:00:00Z'), null), null);
});

test('fetches all venues in one request, preserves symbols and distinguishes missing dates', async (t) => {
  const file = await cache(t);
  let calls = 0;
  const result = await fetchWatchlistEarnings(['BRK.B', 'brk-b', 'ENR.DE', 'LR.PA', 'SPCX', 'UNKNOWN', 'ABC.UNKNOWN'], {
    file, anchor: '2026-11-04', now,
    request: async (url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.ok(body.symbols.tickers.includes('XETR:ENR'));
      assert.ok(body.symbols.tickers.includes('EURONEXT:LR'));
      assert.equal(body.range[1], body.symbols.tickers.length);
      return { json: async () => ({ data: [
        { s: 'NYSE:BRK.B', d: ['Berkshire', 'America/New_York', timestamp('2026-11-07T12:00:00Z'), 0] },
        { s: 'XETR:ENR', d: ['Siemens Energy', 'Europe/Berlin', timestamp('2026-11-11T12:00:00Z'), -1] },
        { s: 'EURONEXT:LR', d: ['Legrand', 'Europe/Paris', timestamp('2026-11-05T06:30:00Z'), -1] },
        { s: 'NASDAQ:SPCX', d: ['SPCX issuer', 'America/New_York', null, 0] },
      ] }) };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.stocks.length, 6);
  assert.deepEqual(result.stocks.map((s) => s.status), [
    'scheduled', 'scheduled', 'scheduled', 'no-upcoming-date', 'not-found', 'unsupported-symbol',
  ]);
  assert.equal(result.stocks[1].symbol, 'ENR.DE');
  assert.equal(result.stocks[1].time, 'Pre-market');
  assert.equal(result.stocks[0].time, '');
  assert.deepEqual(await readJSON(file), result);
});

test('does not guess when more than one US venue matches', async (t) => {
  const result = await fetchWatchlistEarnings(['ABC'], {
    file: await cache(t), now,
    request: async () => ({ json: async () => ({ data: [
      { s: 'NYSE:ABC', d: ['One', 'America/New_York', null, 0] },
      { s: 'NASDAQ:ABC', d: ['Two', 'America/New_York', null, 0] },
    ] }) }),
  });
  assert.equal(result.stocks[0].status, 'ambiguous');
});

test('keeps recent future dates on outage, expires old cache and removes deleted symbols', async (t) => {
  const file = await cache(t);
  await writeJSON(file, { stocks: [
    { symbol: 'LR.PA', date: '2026-11-05', fetchedAt: '2026-11-03T12:00:00Z', source: 'TradingView' },
    { symbol: 'ENR.DE', date: '2026-11-11', fetchedAt: '2026-10-01T12:00:00Z' },
    { symbol: 'NVDA', date: '2026-11-17', fetchedAt: '2026-11-03T12:00:00Z' },
    { symbol: 'AAPL', date: '2026-11-03', fetchedAt: '2026-11-03T12:00:00Z' },
  ] });
  const result = await fetchWatchlistEarnings(['LR.PA', 'ENR.DE', 'AAPL'], {
    file, anchor: '2026-11-04', now,
    request: async () => { throw new Error('upstream offline'); },
  });
  assert.equal(result.stocks[0].status, 'cached');
  assert.equal(result.stocks[0].fetchedAt, '2026-11-03T12:00:00Z');
  assert.equal(result.stocks[1].status, 'fetch-failed');
  assert.equal(result.stocks[2].status, 'fetch-failed');
  assert.equal(result.stocks.some((s) => s.symbol === 'NVDA'), false);
});

test('invalid provider payload is a failure, not a successful empty calendar', async (t) => {
  const result = await fetchWatchlistEarnings(['LR.PA'], {
    file: await cache(t), now,
    request: async () => ({ json: async () => ({ error: 'rate limit' }) }),
  });
  assert.equal(result.stocks[0].status, 'fetch-failed');
});
