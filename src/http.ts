const USER_AGENT = 'drop-monitor/0.1 (personal restock notifier)';
const TIMEOUT_MS = 15_000;

export class HttpError extends Error {
  status: number;
  /** Seconds the server asked us to wait (429 / 503 Retry-After). */
  retryAfterSec?: number;

  constructor(status: number, message: string, retryAfterSec?: number) {
    super(message);
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/** Plain GET with an honest user agent and a timeout. No proxies, no spoofing. */
export async function get(url: string, accept: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new HttpError(
      res.status,
      `GET ${url} -> HTTP ${res.status}`,
      parseRetryAfter(res.headers.get('retry-after')),
    );
  }
  return res.text();
}
