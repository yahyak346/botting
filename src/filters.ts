import type { MonitorConfig } from './types.ts';

/** Lowercases and strips accents so "Pokemon" matches "Pokémon". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Case- and accent-insensitive keyword filter on a product title. */
export function matchesFilters(title: string, cfg: Pick<MonitorConfig, 'include' | 'exclude'>): boolean {
  const t = normalize(title);
  if (cfg.exclude.some((k) => t.includes(normalize(k)))) return false;
  if (cfg.include.length === 0) return true;
  return cfg.include.some((k) => t.includes(normalize(k)));
}

/** True when every word of at least one search term is in the title, and no exclude word is. */
export function matchesSearch(title: string, cfg: Pick<MonitorConfig, 'include' | 'exclude'>): boolean {
  const t = normalize(title);
  if (cfg.exclude.some((k) => t.includes(normalize(k)))) return false;
  return cfg.include.some((term) => normalize(term).split(/\s+/).filter(Boolean).every((w) => t.includes(w)));
}
