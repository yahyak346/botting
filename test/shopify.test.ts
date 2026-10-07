import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffShopify, feedUrl, parseFeed } from '../src/monitors/shopify.ts';
import type { ProductSnap } from '../src/types.ts';

const noFilters = { include: [], exclude: [] };

function product(id: string, title: string, variants: [string, boolean, string][]): ProductSnap {
  return {
    id,
    title,
    url: `https://shop.test/products/${id}`,
    variants: variants.map(([size, available, price], i) => ({ id: `${id}-${i}`, title: size, available, price })),
  };
}

const snap = (...products: ProductSnap[]) => ({
  kind: 'shopify' as const,
  products: Object.fromEntries(products.map((p) => [p.id, p])),
});

test('feedUrl handles store roots and collections', () => {
  assert.equal(feedUrl('https://shop.test'), 'https://shop.test/products.json?limit=250');
  assert.equal(feedUrl('https://shop.test/products/foo?x=1'), 'https://shop.test/products.json?limit=250');
  assert.equal(
    feedUrl('https://shop.test/collections/footwear/extra'),
    'https://shop.test/collections/footwear/products.json?limit=250',
  );
});

test('parseFeed normalises products.json', () => {
  const json = JSON.stringify({
    products: [
      {
        id: 1,
        title: 'Dunk Low',
        handle: 'dunk-low',
        images: [{ src: 'https://cdn.test/1.jpg' }],
        variants: [{ id: 11, title: '10', available: true, price: '110.00' }],
      },
    ],
  });
  assert.deepEqual(parseFeed(json, 'https://shop.test/collections/x'), {
    '1': {
      id: '1',
      title: 'Dunk Low',
      url: 'https://shop.test/products/dunk-low',
      image: 'https://cdn.test/1.jpg',
      variants: [{ id: '11', title: '10', available: true, price: '110.00' }],
    },
  });
  assert.throws(() => parseFeed('{"nope":1}', 'https://shop.test'), /Not a Shopify/);
});

test('detects new products', () => {
  const events = diffShopify(snap(), snap(product('a', 'Dunk Low', [['9', true, '110']])), noFilters);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'new_product');
  assert.match(events[0].details.join(), /In stock: 9/);
});

test('detects restocks of specific sizes', () => {
  const before = snap(product('a', 'Dunk Low', [['9', false, '110'], ['10', false, '110'], ['11', true, '110']]));
  const after = snap(product('a', 'Dunk Low', [['9', true, '110'], ['10', false, '110'], ['11', true, '110']]));
  const events = diffShopify(before, after, noFilters);
  assert.deepEqual(events.map((e) => [e.type, e.details]), [['restock', ['Restocked: 9']]]);
});

test('detects price changes and sell-outs', () => {
  const before = snap(product('a', 'Dunk Low', [['9', true, '110']]));
  const after = snap(product('a', 'Dunk Low', [['9', false, '90']]));
  const types = diffShopify(before, after, noFilters).map((e) => e.type);
  assert.deepEqual(types, ['price_change', 'sold_out']);
});

test('no events when nothing changed', () => {
  const s = snap(product('a', 'Dunk Low', [['9', true, '110']]));
  assert.deepEqual(diffShopify(s, structuredClone(s), noFilters), []);
});

test('respects include/exclude keywords', () => {
  const next = snap(
    product('a', 'Nike Dunk Low', [['9', true, '110']]),
    product('b', 'Nike Dunk Low (Kids)', [['3Y', true, '70']]),
    product('c', 'Plain Tee', [['M', true, '30']]),
  );
  const events = diffShopify(snap(), next, { include: ['dunk'], exclude: ['KIDS'] });
  assert.deepEqual(events.map((e) => e.title), ['Nike Dunk Low']);
});
