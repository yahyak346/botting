import type { MonitorConfig } from './types.ts';

/** Case-insensitive keyword filter on a product title. */
export function matchesFilters(title: string, cfg: Pick<MonitorConfig, 'include' | 'exclude'>): boolean {
  const t = title.toLowerCase();
  if (cfg.exclude.some((k) => t.includes(k.toLowerCase()))) return false;
  if (cfg.include.length === 0) return true;
  return cfg.include.some((k) => t.includes(k.toLowerCase()));
}
