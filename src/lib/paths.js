import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..', '..');

export const DATA_DIR = resolve(ROOT, 'data');
export const EARNINGS_DIR = resolve(DATA_DIR, 'earnings');
export const INDICES_DIR = resolve(DATA_DIR, 'indices');

export const DOCS_DIR = resolve(ROOT, 'docs');
export const ICS_DIR = resolve(DOCS_DIR, 'ics');

export function earningsCacheFile(isoDate, dataDir = DATA_DIR) {
  return resolve(dataDir, 'earnings', `${isoDate}.json`);
}

export function watchlistCacheFile(dataDir = DATA_DIR) {
  return resolve(dataDir, 'earnings', 'watchlist.json');
}

export function indexFile(slug) {
  return resolve(INDICES_DIR, `${slug}.json`);
}

export function icsFile(slug) {
  return resolve(ICS_DIR, `${slug}.ics`);
}
