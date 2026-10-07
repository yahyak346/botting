import { randomUUID } from 'node:crypto';
import { MIN_INTERVAL_SEC } from './engine.ts';
import { isDiscordWebhook } from './notify/discord.ts';
import type { MonitorConfig, PageMode } from './types.ts';

export class ValidationError extends Error {}

const PAGE_MODES: PageMode[] = ['appears', 'disappears', 'changes'];
const MAX_STORES = 50;
const MAX_SEARCH_TERMS = 5;

function str(v: unknown, field: string, max = 500): string {
  if (typeof v !== 'string') throw new ValidationError(`${field} must be a string`);
  const s = v.trim();
  if (s.length > max) throw new ValidationError(`${field} is too long`);
  return s;
}

function keywords(v: unknown, field: string): string[] {
  if (v === undefined) return [];
  const list = typeof v === 'string' ? v.split(',') : v;
  if (!Array.isArray(list)) throw new ValidationError(`${field} must be a list or comma-separated string`);
  return list.map((k) => str(k, field, 100)).filter(Boolean).slice(0, 50);
}

function httpUrl(v: unknown, field: string): string {
  const s = str(v, field, 2000);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new ValidationError(`${field} is not a valid URL`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new ValidationError(`${field} must be http(s)`);
  }
  return u.toString();
}

/** Shop list from an array or a newline/comma-separated string; bare domains get https://. */
function storeList(v: unknown): string[] {
  const list = typeof v === 'string' ? v.split(/[\n,\s]+/) : v;
  if (!Array.isArray(list)) throw new ValidationError('stores must be a list or one shop per line');
  const origins = new Set<string>();
  for (const raw of list) {
    let s = str(raw, 'stores', 2000);
    if (!s) continue;
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
    origins.add(new URL(httpUrl(s, `store "${s}"`)).origin);
  }
  if (origins.size === 0) throw new ValidationError('Add at least one shop to scan');
  if (origins.size > MAX_STORES) throw new ValidationError(`A market scan can have at most ${MAX_STORES} shops`);
  return [...origins];
}

export function webhook(v: unknown, field = 'webhookUrl'): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = str(v, field, 300);
  if (!isDiscordWebhook(s)) throw new ValidationError(`${field} must be a Discord webhook URL`);
  return s;
}

/** Builds a full MonitorConfig from untrusted input, layered over an existing one when editing. */
export function parseMonitor(input: unknown, existing?: MonitorConfig): MonitorConfig {
  if (!input || typeof input !== 'object') throw new ValidationError('Body must be a JSON object');
  const b = { ...existing, ...(input as Record<string, unknown>) } as Record<string, unknown>;

  const kind = b.kind;
  if (kind !== 'shopify' && kind !== 'page' && kind !== 'scan') {
    throw new ValidationError('kind must be "shopify", "page" or "scan"');
  }

  const stores = kind === 'scan' ? storeList(b.stores) : undefined;
  const url = kind === 'scan' ? '' : httpUrl(b.url, 'url');
  const name = str(b.name ?? '', 'name', 100) || (kind === 'scan' ? 'Market scan' : new URL(url).hostname);

  const intervalSec = Number(b.intervalSec ?? 60);
  if (!Number.isFinite(intervalSec) || intervalSec < MIN_INTERVAL_SEC || intervalSec > 86_400) {
    throw new ValidationError(`intervalSec must be between ${MIN_INTERVAL_SEC} and 86400`);
  }

  const cfg: MonitorConfig = {
    id: existing?.id ?? randomUUID(),
    name,
    kind,
    url,
    stores,
    intervalSec: Math.round(intervalSec),
    enabled: b.enabled === undefined ? true : Boolean(b.enabled),
    include: keywords(b.include, 'include'),
    exclude: keywords(b.exclude, 'exclude'),
    webhookUrl: webhook(b.webhookUrl),
  };

  if (kind === 'scan' && cfg.include.length === 0) {
    throw new ValidationError('A market scan needs at least one search term, e.g. "pokemon 30th"');
  }
  if (cfg.include.length > MAX_SEARCH_TERMS && kind === 'scan') {
    throw new ValidationError(`A market scan can have at most ${MAX_SEARCH_TERMS} search terms`);
  }

  if (kind === 'page') {
    const keyword = b.keyword ? str(b.keyword, 'keyword', 200) : '';
    const pageMode = (b.pageMode || (keyword ? 'appears' : 'changes')) as PageMode;
    if (!PAGE_MODES.includes(pageMode)) throw new ValidationError(`pageMode must be one of ${PAGE_MODES.join(', ')}`);
    if (pageMode !== 'changes' && !keyword) throw new ValidationError(`pageMode "${pageMode}" needs a keyword`);
    cfg.keyword = keyword || undefined;
    cfg.pageMode = pageMode;
  }

  return cfg;
}

/** True when an edit means the old snapshot can't be compared with the next one. */
export function needsNewBaseline(a: MonitorConfig, b: MonitorConfig): boolean {
  return (
    a.kind !== b.kind ||
    a.url !== b.url ||
    a.keyword !== b.keyword ||
    String(a.stores) !== String(b.stores) ||
    (a.kind === 'scan' && String(a.include) !== String(b.include))
  );
}
