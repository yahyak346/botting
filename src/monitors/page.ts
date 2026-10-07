import { createHash } from 'node:crypto';
import { get } from '../http.ts';
import type { DetectedEvent, MonitorConfig, Snapshot } from '../types.ts';

type PageSnapshot = Extract<Snapshot, { kind: 'page' }>;

/** Reduces HTML to its visible-ish text so cosmetic markup churn doesn't trigger alerts. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function snapshotPage(html: string, keyword: string | undefined): PageSnapshot {
  const text = htmlToText(html);
  return {
    kind: 'page',
    hash: createHash('sha256').update(text).digest('hex'),
    matched: keyword ? text.toLowerCase().includes(keyword.toLowerCase()) : false,
  };
}

export async function fetchPage(cfg: MonitorConfig): Promise<PageSnapshot> {
  return snapshotPage(await get(cfg.url, 'text/html'), cfg.keyword);
}

export function diffPage(
  prev: PageSnapshot,
  next: PageSnapshot,
  cfg: Pick<MonitorConfig, 'url' | 'name' | 'keyword' | 'pageMode'>,
): DetectedEvent[] {
  const base = { title: cfg.name, url: cfg.url };
  const mode = cfg.pageMode ?? (cfg.keyword ? 'appears' : 'changes');

  if (mode === 'appears' && !prev.matched && next.matched) {
    return [{ ...base, type: 'page_match', details: [`"${cfg.keyword}" appeared on the page`] }];
  }
  if (mode === 'disappears' && prev.matched && !next.matched) {
    return [{ ...base, type: 'page_match', details: [`"${cfg.keyword}" is gone from the page`] }];
  }
  if (mode === 'changes' && prev.hash !== next.hash) {
    return [{ ...base, type: 'page_change', details: ['Page content changed'] }];
  }
  return [];
}
