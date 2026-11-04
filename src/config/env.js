import 'dotenv/config';
import { normalizeSymbol } from '../lib/symbols.js';

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

function parseTickers(value) {
  if (!value) return [];
  return [...new Set(value
    .split(',')
    .map(normalizeSymbol)
    .filter(Boolean))];
}

export const env = {
  shouldGenSelected: bool(process.env.SHOULD_GEN_SELECTED, true),
  shouldGenAll: bool(process.env.SHOULD_GEN_ALL, true),
  customStocks: parseTickers(process.env.CUSTOM_STOCKS),
  port: Number(process.env.PORT ?? 18302),
};
