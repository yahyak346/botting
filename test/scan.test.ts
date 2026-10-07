import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchScan, parseSuggest, searchUrl, summarizeScan } from '../src/monitors/scan.ts';
import { matchesSearch } from '../src/filters.ts';
import { diff } from '../src/engine.ts';
import { parseMonitor } from '../src/validate.ts';
import type { MonitorConfig } from '../src/types.ts';

const suggest = (products: object[]) => JSON.stringify({ resources: { results: { products } } });

test('matchesSearch needs every word of a term and ignores accents', () => {
  const cfg = { include: ['pokemon 30th'], exclude: ['sleeves'] };
  assert.ok(matchesSearch('Pokémon TCG: 30th Celebration Elite Trainer Box', cfg));
  assert.ok(!matchesSearch('Pokémon Scarlet & Violet Booster', cfg));
  assert.ok(!matchesSearch('Pokemon 30th Anniversary Card Sleeves', cfg));
});

test('searchUrl builds a predictive search query', () => {
  const u = new URL(searchUrl('https://shop.test/collections/x', 'pokemon 30th'));
  assert.equal(u.origin + u.pathname, 'https://shop.test/search/suggest.json');
  assert.equal(u.searchParams.get('q'), 'pokemon 30th');
  assert.equal(u.searchParams.get('resources[type]'), 'product');
});

test('parseSuggest handles products with and without variants', () => {
  const products = parseSuggest(
    suggest([
      { id: 1, title: 'A', handle: 'a', available: true, price: '50.00', featured_image: { url: 'https://cdn/a.jpg' } },
      { id: 2, title: 'B', url: '/products/b?_pos=2', variants: [{ id: 21, title: 'Box', available: false, price: '9' }] },
    ]),
    'https://www.shop.test',
  );
  assert.deepEqual(products[0], {
    id: '1', title: 'A', url: 'https://www.shop.test/products/a', image: 'https://cdn/a.jpg', store: 'shop.test',
    variants: [{ id: '1', title: 'Default', available: true, price: '50.00' }],
  });
  assert.equal(products[1].url, 'https://www.shop.test/products/b');
  assert.equal(products[1].variants[0].available, false);
});

test('scan validation', () => {
  const m = parseMonitor({ kind: 'scan', stores: 'shop-a.test\nhttps://shop-b.test/collections/x\nshop-a.test', include: 'pokemon 30th' });
  assert.deepEqual(m.stores, ['https://shop-a.test', 'https://shop-b.test']);
  assert.equal(m.name, 'Market scan');
  assert.throws(() => parseMonitor({ kind: 'scan', stores: 'shop.test' }), /search term/);
  assert.throws(() => parseMonitor({ kind: 'scan', stores: '', include: 'x' }), /at least one shop/);
});

// --- fake shops -----------------------------------------------------------
let server: Server;
let base: string;
let etbAvailable = false;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    res.setHeader('content-type', 'application/json');
    const shop = req.headers.host!.startsWith('localhost') ? 'a' : 'b';
    if (shop === 'a' && url.pathname === '/search/suggest.json') {
      return res.end(suggest([
        { id: 1, title: 'Pokémon 30th Celebration ETB', handle: 'etb', available: etbAvailable, price: '59.99' },
        { id: 2, title: 'Pokémon plush', handle: 'plush', available: true, price: '20' },
      ]));
    }
    if (shop === 'b' && url.pathname === '/search/suggest.json') {
      res.statusCode = 404; // search disabled -> falls back to products.json
      return res.end('{}');
    }
    if (shop === 'b' && url.pathname === '/products.json') {
      return res.end(JSON.stringify({ products: [
        { id: 9, title: 'Pokemon 30th Celebration Booster Bundle', handle: 'bundle', variants: [{ id: 91, title: 'Default', available: true, price: '29.99' }] },
      ] }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = String((server.address() as AddressInfo).port);
});
after(() => server.close());

const noSleep = async () => {};

function scanCfg(stores: string[]): MonitorConfig {
  return parseMonitor({ kind: 'scan', stores: stores.join('\n'), include: 'pokemon 30th' });
}

test('scans several shops, falls back to products.json, and diffs restocks', async () => {
  const cfg = scanCfg([`http://localhost:${base}`, `http://127.0.0.1:${base}`]);

  etbAvailable = false;
  const first = await fetchScan(cfg, undefined, noSleep);
  assert.deepEqual(first.failed, []);
  const titles = Object.values(first.snapshot.products).map((p) => p.title).sort();
  assert.deepEqual(titles, ['Pokemon 30th Celebration Booster Bundle', 'Pokémon 30th Celebration ETB']);

  const summary = summarizeScan(first.snapshot, cfg);
  assert.equal(summary.type, 'scan_summary');
  assert.match(summary.title, /1 in stock across 2 shop/);

  etbAvailable = true;
  const second = await fetchScan(cfg, first.snapshot, noSleep);
  const events = diff(first.snapshot, second.snapshot, cfg);
  assert.deepEqual(events.map((e) => e.type), ['restock']);
  assert.ok(events[0].details.includes('Shop: localhost'));
});

test('a failing shop keeps its previous products; all failing throws', async () => {
  const good = `http://localhost:${base}`;
  const down = 'http://127.0.0.1:1'; // nothing listens here
  const cfg = scanCfg([good, down]);
  const remembered = { id: 'x', title: 'Pokemon 30th old', url: 'u', variants: [] };
  const prev = { kind: 'shopify' as const, products: { '127.0.0.1:1:x': remembered } };

  const res = await fetchScan(cfg, prev, noSleep);
  assert.equal(res.failed.length, 1);
  assert.equal(res.failed[0].store, down);
  assert.deepEqual(res.snapshot.products['127.0.0.1:1:x'], remembered);
  assert.ok(Object.keys(res.snapshot.products).some((k) => k.startsWith('localhost:')));

  await assert.rejects(fetchScan({ ...cfg, stores: [down] }, undefined, noSleep), /All 1 shop/);
});
