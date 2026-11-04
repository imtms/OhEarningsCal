// Keep the watchlist's Yahoo-style exchange suffixes; normalize US share classes.
export function normalizeSymbol(value) {
  return String(value ?? '').trim().toUpperCase().replace(/^([A-Z]+)[/-]([AB])$/, '$1.$2');
}

export function tradingViewSymbols(value) {
  const symbol = normalizeSymbol(value);
  if (!/^[A-Z0-9][A-Z0-9.:-]*$/.test(symbol)) return [];
  if (symbol.includes(':')) return [symbol];
  if (symbol.endsWith('.DE')) return [`XETR:${symbol.slice(0, -3)}`];
  if (symbol.endsWith('.PA')) return [`EURONEXT:${symbol.slice(0, -3)}`];
  // A dot other than a US share class must not silently resolve on a US venue.
  if (symbol.includes('.') && !/^[A-Z]+\.[AB]$/.test(symbol)) return [];
  return ['NASDAQ', 'NYSE', 'AMEX'].map((exchange) => `${exchange}:${symbol}`);
}

export function yahooSymbol(value) {
  return normalizeSymbol(value).replace(/^([A-Z]+)\.([AB])$/, '$1-$2');
}
