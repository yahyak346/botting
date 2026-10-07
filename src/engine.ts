import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { HttpError } from './http.ts';
import { diffPage, fetchPage } from './monitors/page.ts';
import { diffShopify, fetchShopify } from './monitors/shopify.ts';
import { fetchScan, summarizeScan } from './monitors/scan.ts';
import { sendDiscord } from './notify/discord.ts';
import type { Store } from './store.ts';
import type { DetectedEvent, MonitorConfig, MonitorEvent, Snapshot } from './types.ts';

/** Floor on polling so we never hammer a site, whatever the config says. */
export const MIN_INTERVAL_SEC = 30;
const MAX_BACKOFF_SEC = 30 * 60;

export interface MonitorStatus {
  running: boolean;
  lastCheck?: string;
  lastError?: string;
  failures: number;
  nextCheck?: string;
}

interface Runtime {
  timer?: NodeJS.Timeout;
  status: MonitorStatus;
}

interface CheckResult {
  snapshot: Snapshot;
  /** Non-fatal problems, e.g. some shops in a scan failing. */
  warning?: string;
}

async function check(cfg: MonitorConfig, prev: Snapshot | undefined): Promise<CheckResult> {
  if (cfg.kind === 'shopify') return { snapshot: await fetchShopify(cfg) };
  if (cfg.kind === 'page') return { snapshot: await fetchPage(cfg) };
  const { snapshot, failed } = await fetchScan(cfg, prev);
  const warning = failed.length
    ? `${failed.length} shop(s) failed: ${failed.map((f) => `${new URL(f.store).hostname} (${f.error})`).join('; ')}`
    : undefined;
  return { snapshot, warning };
}

export function diff(prev: Snapshot, next: Snapshot, cfg: MonitorConfig): DetectedEvent[] {
  // Scan results are already filtered by the search terms.
  if (prev.kind === 'shopify' && next.kind === 'shopify' && cfg.kind === 'scan') {
    return diffShopify(prev, next, { include: [], exclude: [] });
  }
  if (prev.kind === 'shopify' && next.kind === 'shopify') return diffShopify(prev, next, cfg);
  if (prev.kind === 'page' && next.kind === 'page') return diffPage(prev, next, cfg);
  return []; // monitor kind changed: the new snapshot becomes the baseline
}

/** Emits 'event' (MonitorEvent) and 'status' (id, MonitorStatus). */
export class Engine extends EventEmitter {
  store: Store;
  private runtimes = new Map<string, Runtime>();

  constructor(store: Store) {
    super();
    this.store = store;
  }

  status(id: string): MonitorStatus {
    return this.runtime(id).status;
  }

  private runtime(id: string): Runtime {
    let rt = this.runtimes.get(id);
    if (!rt) {
      rt = { status: { running: false, failures: 0 } };
      this.runtimes.set(id, rt);
    }
    return rt;
  }

  /** (Re)schedules every monitor to match the current config. Call after any config change. */
  sync(): void {
    const ids = new Set(this.store.data.monitors.map((m) => m.id));
    for (const [id, rt] of this.runtimes) {
      if (!ids.has(id)) {
        clearTimeout(rt.timer);
        this.runtimes.delete(id);
        delete this.store.data.snapshots[id];
      }
    }
    for (const m of this.store.data.monitors) {
      const rt = this.runtime(m.id);
      clearTimeout(rt.timer);
      rt.timer = undefined;
      rt.status.nextCheck = undefined;
      if (m.enabled) this.schedule(m.id, rt.status.lastCheck ? this.delayFor(m, rt) : 0);
    }
  }

  stop(): void {
    for (const rt of this.runtimes.values()) clearTimeout(rt.timer);
  }

  private delayFor(cfg: MonitorConfig, rt: Runtime, retryAfterSec?: number): number {
    const base = Math.max(cfg.intervalSec, MIN_INTERVAL_SEC);
    const backoff = Math.min(base * 2 ** rt.status.failures, MAX_BACKOFF_SEC);
    const secs = Math.max(rt.status.failures ? backoff : base, retryAfterSec ?? 0);
    const jitter = 1 + (Math.random() * 0.2 - 0.1); // +/-10% so monitors don't sync up
    return Math.round(secs * jitter * 1000);
  }

  private schedule(id: string, delayMs: number): void {
    const rt = this.runtime(id);
    clearTimeout(rt.timer);
    rt.status.nextCheck = new Date(Date.now() + delayMs).toISOString();
    rt.timer = setTimeout(() => void this.run(id), delayMs);
    this.emit('status', id, rt.status);
  }

  /** Checks one monitor now. Safe to call manually ("run now"). */
  async run(id: string): Promise<void> {
    const cfg = this.store.data.monitors.find((m) => m.id === id);
    const rt = this.runtime(id);
    if (!cfg || rt.status.running) return;
    clearTimeout(rt.timer);
    rt.status.running = true;
    this.emit('status', id, rt.status);

    let retryAfterSec: number | undefined;
    try {
      const prev = this.store.data.snapshots[id];
      const { snapshot: next, warning } = await check(cfg, prev);
      this.store.data.snapshots[id] = next;
      rt.status.failures = 0;
      rt.status.lastError = warning;
      if (prev) {
        for (const detected of diff(prev, next, cfg)) await this.publish(cfg, detected);
      } else if (cfg.kind === 'scan' && next.kind === 'shopify') {
        await this.publish(cfg, summarizeScan(next, cfg));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof HttpError) retryAfterSec = err.retryAfterSec;
      // Only log the first failure of a streak so the feed doesn't fill with repeats.
      if (rt.status.failures === 0) {
        await this.publish(cfg, { type: 'error', title: cfg.name, details: [message] });
      }
      rt.status.failures++;
      rt.status.lastError = message;
    } finally {
      rt.status.running = false;
      rt.status.lastCheck = new Date().toISOString();
      await this.store.save();
      // The config may have been edited or deleted while we were fetching.
      const current = this.store.data.monitors.find((m) => m.id === id);
      if (current?.enabled) this.schedule(id, this.delayFor(current, rt, retryAfterSec));
      else this.emit('status', id, rt.status);
    }
  }

  private async publish(cfg: MonitorConfig, detected: DetectedEvent): Promise<void> {
    const event: MonitorEvent = {
      ...detected,
      id: randomUUID(),
      monitorId: cfg.id,
      monitorName: cfg.name,
      at: new Date().toISOString(),
    };
    this.store.addEvent(event);
    this.emit('event', event);

    const webhook = cfg.webhookUrl || this.store.data.settings.webhookUrl;
    if (!webhook || event.type === 'error') return;
    try {
      await sendDiscord(webhook, event);
    } catch (err) {
      console.error(`[${cfg.name}] Discord notify failed:`, err instanceof Error ? err.message : err);
    }
  }
}
