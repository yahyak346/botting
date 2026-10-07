export type MonitorKind = 'shopify' | 'page';
export type PageMode = 'appears' | 'disappears' | 'changes';

export interface MonitorConfig {
  id: string;
  name: string;
  kind: MonitorKind;
  /** Store / collection URL (shopify) or any page URL (page). */
  url: string;
  intervalSec: number;
  enabled: boolean;
  /** Only alert on products whose title contains one of these (empty = all). */
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
