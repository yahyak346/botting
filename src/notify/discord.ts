import type { MonitorEvent } from '../types.ts';

const COLORS: Record<MonitorEvent['type'], number> = {
  new_product: 0x5865f2,
  restock: 0x57f287,
  price_change: 0xfee75c,
  sold_out: 0xed4245,
  page_match: 0x57f287,
  page_change: 0xeb459e,
  error: 0x99aab5,
};

const LABELS: Record<MonitorEvent['type'], string> = {
  new_product: 'New product',
  restock: 'Restock',
  price_change: 'Price change',
  sold_out: 'Sold out',
  page_match: 'Keyword alert',
  page_change: 'Page changed',
  error: 'Error',
};

export function isDiscordWebhook(url: string): boolean {
  return /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url);
}

export function buildPayload(event: MonitorEvent) {
  return {
    username: 'Drop Monitor',
    embeds: [
      {
        title: `${LABELS[event.type]}: ${event.title}`.slice(0, 256),
        url: event.url,
        description: event.details.join('\n').slice(0, 4000),
        color: COLORS[event.type],
        thumbnail: event.image ? { url: event.image } : undefined,
        footer: { text: event.monitorName },
        timestamp: event.at,
      },
    ],
  };
}

async function post(webhookUrl: string, body: unknown): Promise<Response> {
  return fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

export async function sendDiscord(webhookUrl: string, event: MonitorEvent): Promise<void> {
  const body = buildPayload(event);
  let res = await post(webhookUrl, body);
  if (res.status === 429) {
    // Discord tells us exactly how long to wait; honour it once.
    const info = (await res.json().catch(() => ({}))) as { retry_after?: number };
    await new Promise((r) => setTimeout(r, Math.min((info.retry_after ?? 1) * 1000, 30_000)));
    res = await post(webhookUrl, body);
  }
  if (!res.ok) throw new Error(`Discord webhook -> HTTP ${res.status}`);
}
