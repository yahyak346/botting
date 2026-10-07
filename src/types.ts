export type MonitorKind = 'shopify' | 'page' | 'scan';
export type PageMode = 'appears' | 'disappears' | 'changes';

export interface MonitorConfig {
  id: string;
  name: string;
  kind: MonitorKind;
  /** Store / collection URL (shopify) or any page URL (page). Empty for scans. */
  url: string;
  /** Scan monitors: Shopify shop URLs to search. */
  stores?: string[];
  intervalSec: number;
  enabled: boolean;
  /**
   * Only alert on products whose title contains one of these (empty = all).
   * For scans these are the search terms; every word of a term must be in the title.
   */
  include: string[];
  /** Never alert on products whose title contains one of these. */
  exclude: string[];
  /** Overrides the global webhook for this monitor. */
  webhookUrl?: string;
  /** Page monitors: text to look for, e.g. "Add to cart" or "Sold out". */
  keyword?: string;
  pageMode?: PageMode;
}

export interface VariantSnap {
  id: string;
  title: string;
  available: boolean;
  price: string;
}

export interface ProductSnap {
  id: string;
  title: string;
  url: string;
  image?: string;
  /** Shop the product came from (scans only). */
  store?: string;
  variants: VariantSnap[];
}

export type Snapshot =
  | { kind: 'shopify'; products: Record<string, ProductSnap> }
  | { kind: 'page'; hash: string; matched: boolean };

export type EventType =
  | 'new_product'
  | 'restock'
  | 'price_change'
  | 'sold_out'
  | 'page_match'
  | 'page_change'
  | 'scan_summary'
  | 'error';

/** An event before it is attributed to a monitor and timestamped. */
export interface DetectedEvent {
  type: EventType;
  title: string;
  url?: string;
  image?: string;
  details: string[];
}

export interface MonitorEvent extends DetectedEvent {
  id: string;
  monitorId: string;
  monitorName: string;
  at: string;
}

export interface Settings {
  webhookUrl?: string;
}
