import { HttpError, get } from '../http.ts';
import { matchesSearch } from '../filters.ts';
import { feedUrl, parseFeed } from './shopify.ts';
import type { DetectedEvent, MonitorConfig, ProductSnap, Snapshot } from '../types.ts';

type ShopifySnapshot = Extract<Snapshot, { kind: 'shopify' }>;

/** Pause between shops so a scan is a trickle of requests, not a burst. */
const STORE_DELAY_MS = 1500;
const RESULTS_PER_QUERY = 10;

export function searchUrl(store: string, query: string): string {
  const u = new URL('/search/suggest.json', new URL(store).origin);
  u.searchParams.set('q', query);
  u.searchParams.set('resources[type]', 'product');
  u.searchParams.set('resources[limit]', String(RESULTS_PER_QUERY));
  return u.toString();
}

interface SuggestVariant {
  id?: number | string;
  title?: string;
  available?: boolean;
  price?: string | number;
}
interface SuggestProduct {
  id: number | string;
  title?: string;
  handle?: string;
  url?: string;
  available?: boolean;
  price?: string | number;
  image?: string | null;
  featured_image?: { url?: string | null } | null;
  variants?: SuggestVariant[];
}

/** Parses Shopify's predictive-search response into product snapshots. */
export function parseSuggest(json: string, store: string): ProductSnap[] {
  const data = JSON.parse(json) as { resources?: { results?: { products?: SuggestProduct[] } } };
  const products = data.resources?.results?.products;
  if (!Array.isArray(products)) throw new Error('Not a Shopify search response');
  const origin = new URL(store).origin;
  return products.map((p) => {
    const id = String(p.id);
    const path = p.handle ? `/products/${p.handle}` : (p.url ?? '').split('?')[0] || `/products/${id}`;
    const variants = p.variants?.length
      ? p.variants.map((v, i) => ({
          id: String(v.id ?? `${id}-${i}`),
          title: v.title ?? 'Default',
          available: Boolean(v.available),
          price: String(v.price ?? p.price ?? ''),
        }))
      : [{ id, title: 'Default', available: Boolean(p.available), price: String(p.price ?? '') }];
    return {
      id,
      title: p.title ?? '(untitled)',
      url: new URL(path, origin).toString(),
      image: p.featured_image?.url ?? p.image ?? undefined,
      store: new URL(store).hostname.replace(/^www\./, ''),
      variants,
    };
  });
}

/** Searches one shop; falls back to its products.json feed if search is switched off. */
async function scanStore(store: string, cfg: MonitorConfig): Promise<ProductSnap[]> {
  const found: ProductSnap[] = [];
  try {
    for (const query of cfg.include) {
      found.push(...parseSuggest(await get(searchUrl(store, query), 'application/json'), store));
    }
  } catch (err) {
    // Only fall back when the shop has search switched off; don't double up after a rate limit.
    if (err instanceof HttpError && err.status !== 404) throw err;
    const feed = parseFeed(await get(feedUrl(store), 'application/json'), store);
    const host = new URL(store).hostname.replace(/^www\./, '');
    found.length = 0;
    found.push(...Object.values(feed).map((p) => ({ ...p, store: host })));
  }
  return found.filter((p) => matchesSearch(p.title, cfg));
}

const keyOf = (store: string, id: string) => `${new URL(store).host}:${id}`;

export interface ScanResult {
  snapshot: ShopifySnapshot;
  failed: { store: string; error: string }[];
}

export async function fetchScan(
  cfg: MonitorConfig,
  prev: Snapshot | undefined,
  sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): Promise<ScanResult> {
  const stores = cfg.stores ?? [];
  const products: Record<string, ProductSnap> = {};
  const failed: ScanResult['failed'] = [];

  for (const [i, store] of stores.entries()) {
    if (i > 0) await sleep(STORE_DELAY_MS);
    try {
      for (const p of await scanStore(store, cfg)) products[keyOf(store, p.id)] = p;
    } catch (err) {
      failed.push({ store, error: err instanceof Error ? err.message : String(err) });
      // Keep what we knew about this shop so a blip doesn't look like everything vanished.
      if (prev?.kind === 'shopify') {
        const prefix = `${new URL(store).host}:`;
        for (const [k, p] of Object.entries(prev.products)) if (k.startsWith(prefix)) products[k] = p;
      }
    }
  }

  if (stores.length > 0 && failed.length === stores.length) {
    throw new Error(`All ${stores.length} shop(s) failed. First error: ${failed[0].error}`);
  }
  return { snapshot: { kind: 'shopify', products }, failed };
}

/** The first scan reports what's buyable right now instead of staying silent. */
export function summarizeScan(snapshot: ShopifySnapshot, cfg: MonitorConfig): DetectedEvent {
  const inStock = Object.values(snapshot.products).filter((p) => p.variants.some((v) => v.available));
  const lines = inStock.slice(0, 15).map((p) => `${p.title} (${p.store}) ${p.variants[0]?.price ?? ''} ${p.url}`);
  if (inStock.length > lines.length) lines.push(`…and ${inStock.length - lines.length} more`);
  return {
    type: 'scan_summary',
    title: `${cfg.name}: ${inStock.length} in stock across ${cfg.stores?.length ?? 0} shop(s)`,
    image: inStock[0]?.image,
    url: inStock[0]?.url,
    details: lines.length ? lines : ['Nothing matching is in stock right now. You will get an alert when that changes.'],
  };
}
