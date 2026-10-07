import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { Engine } from './engine.ts';
import { sendDiscord } from './notify/discord.ts';
import { ValidationError, needsNewBaseline, parseMonitor, webhook } from './validate.ts';
import type { MonitorConfig, MonitorEvent } from './types.ts';

const INDEX_HTML = new URL('../public/index.html', import.meta.url);
const MAX_BODY = 64 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

class HttpStatus extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  // Requiring JSON forces a CORS preflight, so other websites can't drive this API.
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new HttpStatus(415, 'Content-Type must be application/json');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpStatus(413, 'Body too large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpStatus(400, 'Invalid JSON');
  }
}

function maskWebhook(url?: string): string | undefined {
  return url?.replace(/\/[\w-]+$/, '/••••••');
}

export function createApp(engine: Engine) {
  const { store } = engine;
  const clients = new Set<ServerResponse>();

  const view = (m: MonitorConfig) => ({ ...m, webhookUrl: maskWebhook(m.webhookUrl), status: engine.status(m.id) });

  const broadcast = (type: string, data: unknown) => {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(msg);
  };
  engine.on('event', (e: MonitorEvent) => broadcast('monitor-event', e));
  engine.on('status', (id: string, status: unknown) => broadcast('status', { id, status }));

  const findMonitor = (id: string) => {
    const m = store.data.monitors.find((x) => x.id === id);
    if (!m) throw new HttpStatus(404, 'Monitor not found');
    return m;
  };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Block DNS-rebinding: only answer requests addressed to localhost.
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!LOCAL_HOSTS.has(host)) throw new HttpStatus(403, 'Forbidden host');

    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const method = req.method ?? 'GET';

    if (method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(await readFile(INDEX_HTML));
      return;
    }

    if (parts[0] !== 'api') throw new HttpStatus(404, 'Not found');
    const [, resource, id, action] = parts;

    if (resource === 'stream' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (resource === 'events' && method === 'GET') {
      return send(res, 200, store.data.events);
    }

    if (resource === 'settings') {
      if (method === 'GET') {
        return send(res, 200, { webhookUrl: maskWebhook(store.data.settings.webhookUrl) });
      }
      if (method === 'PUT') {
        const body = (await readJson(req)) as { webhookUrl?: unknown };
        if (!String(body.webhookUrl ?? '').includes('••')) {
          store.data.settings.webhookUrl = webhook(body.webhookUrl);
        }
        await store.save();
        return send(res, 200, { webhookUrl: maskWebhook(store.data.settings.webhookUrl) });
      }
    }

    if (resource === 'test-webhook' && method === 'POST') {
      const body = (await readJson(req)) as { monitorId?: string };
      const m = body.monitorId ? findMonitor(body.monitorId) : undefined;
      const target = m?.webhookUrl || store.data.settings.webhookUrl;
      if (!target) throw new HttpStatus(400, 'No webhook configured');
      await sendDiscord(target, {
        id: 'test',
        type: 'restock',
        title: 'Test alert',
        details: ['If you can see this, your webhook works.'],
        monitorId: m?.id ?? 'test',
        monitorName: m?.name ?? 'Drop Monitor',
        at: new Date().toISOString(),
      });
      return send(res, 200, { ok: true });
    }

    if (resource === 'monitors') {
      if (!id && method === 'GET') return send(res, 200, store.data.monitors.map(view));

      if (!id && method === 'POST') {
        const m = parseMonitor(await readJson(req));
        store.data.monitors.push(m);
        await store.save();
        engine.sync();
        return send(res, 201, view(m));
      }

      if (id && !action && method === 'PATCH') {
        const old = findMonitor(id);
        const body = (await readJson(req)) as Record<string, unknown>;
        // An omitted or masked webhook means "keep the current one".
        if (body.webhookUrl === undefined || String(body.webhookUrl).includes('••')) {
          body.webhookUrl = old.webhookUrl;
        }
        const updated = parseMonitor(body, old);
        if (needsNewBaseline(old, updated)) delete store.data.snapshots[id];
        store.data.monitors[store.data.monitors.indexOf(old)] = updated;
        await store.save();
        engine.sync();
        return send(res, 200, view(updated));
      }

      if (id && !action && method === 'DELETE') {
        findMonitor(id);
        store.data.monitors = store.data.monitors.filter((m) => m.id !== id);
        await store.save();
        engine.sync();
        res.writeHead(204).end();
        return;
      }

      if (id && action === 'run' && method === 'POST') {
        findMonitor(id);
        void engine.run(id);
        return send(res, 202, { ok: true });
      }
    }

    throw new HttpStatus(404, 'Not found');
  }

  return createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      const status = err instanceof HttpStatus ? err.status : err instanceof ValidationError ? 400 : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: err instanceof Error ? err.message : 'Error' });
      else res.end();
    });
  });
}
