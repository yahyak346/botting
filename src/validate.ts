import { randomUUID } from 'node:crypto';
import { MIN_INTERVAL_SEC } from './engine.ts';
import { isDiscordWebhook } from './notify/discord.ts';
import type { MonitorConfig, PageMode } from './types.ts';

export class ValidationError extends Error {}

const PAGE_MODES: PageMode[] = ['appears', 'disappears', 'changes'];

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
  if (kind !== 'shopify' && kind !== 'page') throw new ValidationError('kind must be "shopify" or "page"');

  const url = httpUrl(b.url, 'url');
  const name = str(b.name ?? '', 'name', 100) || new URL(url).hostname;

  const intervalSec = Number(b.intervalSec ?? 60);
  if (!Number.isFinite(intervalSec) || intervalSec < MIN_INTERVAL_SEC || intervalSec > 86_400) {
    throw new ValidationError(`intervalSec must be between ${MIN_INTERVAL_SEC} and 86400`);
  }

  const cfg: MonitorConfig = {
    id: existing?.id ?? randomUUID(),
    name,
    kind,
    url,
    intervalSec: Math.round(intervalSec),
    enabled: b.enabled === undefined ? true : Boolean(b.enabled),
    include: keywords(b.include, 'include'),
    exclude: keywords(b.exclude, 'exclude'),
    webhookUrl: webhook(b.webhookUrl),
  };

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
  return a.kind !== b.kind || a.url !== b.url || a.keyword !== b.keyword;
}
