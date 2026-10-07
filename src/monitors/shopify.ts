import { get } from '../http.ts';
import { matchesFilters } from '../filters.ts';
import type { DetectedEvent, MonitorConfig, ProductSnap, Snapshot } from '../types.ts';

type ShopifySnapshot = Extract<Snapshot, { kind: 'shopify' }>;

/**
 * Turns a store or collection URL into its public products.json feed.
 *   https://shop.com                      -> https://shop.com/products.json?limit=250
 *   https://shop.com/collections/new      -> https://shop.com/collections/new/products.json?limit=250
 */
export function feedUrl(input: string): string {
  const u = new URL(input);
  const collection = u.pathname.match(/^\/collections\/[^/]+/);
  const path = collection ? `${collection[0]}/products.json` : '/products.json';
  return `${u.origin}${path}?limit=250`;
}

interface RawVariant {
  id: number | string;
  title?: string;
  available?: boolean;
  price?: string | number;
}
interface RawProduct {
  id: number | string;
  title?: string;
  handle?: string;
  images?: { src?: string }[];
  variants?: RawVariant[];
}

export function parseFeed(json: string, storeUrl: string): Record<string, ProductSnap> {
  const data = JSON.parse(json) as { products?: RawProduct[] };
  if (!Array.isArray(data.products)) throw new Error('Not a Shopify products.json response');
  const origin = new URL(storeUrl).origin;
  const out: Record<string, ProductSnap> = {};
  for (const p of data.products) {
    const id = String(p.id);
    out[id] = {
      id,
      title: p.title ?? '(untitled)',
      url: `${origin}/products/${p.handle ?? id}`,
      image: p.images?.[0]?.src,
      variants: (p.variants ?? []).map((v) => ({
        id: String(v.id),
        title: v.title ?? 'Default',
        available: Boolean(v.available),
        price: String(v.price ?? ''),
      })),
    };
  }
  return out;
}

export async function fetchShopify(cfg: MonitorConfig): Promise<ShopifySnapshot> {
  const body = await get(feedUrl(cfg.url), 'application/json');
  return { kind: 'shopify', products: parseFeed(body, cfg.url) };
}

function sizes(variants: { title: string }[]): string {
  return variants.map((v) => v.title).join(', ');
}

/** Compares two feed snapshots and returns what changed, respecting keyword filters. */
export function diffShopify(
  prev: ShopifySnapshot,
  next: ShopifySnapshot,
  cfg: Pick<MonitorConfig, 'include' | 'exclude'>,
): DetectedEvent[] {
  const events: DetectedEvent[] = [];

  for (const product of Object.values(next.products)) {
    if (!matchesFilters(product.title, cfg)) continue;
    const base = { title: product.title, url: product.url, image: product.image };
    const inStock = product.variants.filter((v) => v.available);
    const old = prev.products[product.id];

    if (!old) {
      events.push({
        ...base,
        type: 'new_product',
        details: [
          `Price: ${product.variants[0]?.price ?? '?'}`,
          inStock.length ? `In stock: ${sizes(inStock)}` : 'Not available yet',
        ],
      });
      continue;
    }

    const oldById = new Map(old.variants.map((v) => [v.id, v]));
    const restocked = inStock.filter((v) => !oldById.get(v.id)?.available);
    if (restocked.length) {
      events.push({ ...base, type: 'restock', details: [`Restocked: ${sizes(restocked)}`] });
    }

    const priceChanges = product.variants
      .map((v) => ({ v, before: oldById.get(v.id)?.price }))
      .filter(({ v, before }) => before !== undefined && before !== v.price);
    if (priceChanges.length) {
      const { v, before } = priceChanges[0];
      events.push({ ...base, type: 'price_change', details: [`Price: ${before} -> ${v.price}`] });
    }

    const wasInStock = old.variants.some((v) => v.available);
    if (wasInStock && inStock.length === 0 && product.variants.length > 0) {
      events.push({ ...base, type: 'sold_out', details: ['All sizes sold out'] });
    }
  }

  return events;
}
