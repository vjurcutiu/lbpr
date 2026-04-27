// __mocks__/billingApiMock.ts
// Re-export shapes to keep types happy when importing from '@/features/billing/api'
export type { Product, Price, Subscription } from "@/features/billing/api";
import type { Product, Price, Subscription } from "@/features/billing/api";

export const STRIPE_PRO_PLAN_KEY = "pro";
export const STRIPE_PRO_LOOKUP_KEY = "pro_monthly";

function normalizeKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function productMatchesPlan(product: Product, planKey: string): boolean {
  const metadata = product.metadata || {};
  const metaKey =
    normalizeKey(metadata.app_plan_key) ||
    normalizeKey(metadata.plan_key) ||
    normalizeKey(metadata.code);
  if (metaKey) return metaKey === planKey;
  return normalizeKey(product.name).split(/[^a-z0-9]+/).includes(planKey);
}

function defaultPriceId(product: Product): string | null {
  const raw = product.default_price;
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  return typeof raw.id === "string" ? raw.id : null;
}

export function selectPlanCatalogPrice(
  products: Product[],
  planKey: string = STRIPE_PRO_PLAN_KEY,
  lookupKey: string = STRIPE_PRO_LOOKUP_KEY,
): { product: Product; price: Price } | undefined {
  const normalizedPlanKey = normalizeKey(planKey);
  const normalizedLookupKey = normalizeKey(lookupKey);
  const product = products.find((item) => item.active !== false && productMatchesPlan(item, normalizedPlanKey));
  if (!product) return undefined;

  const prices = (product.prices || []).filter((price) => price.active !== false && price.type !== "one_time" && !!price.interval);
  const defaultId = defaultPriceId(product);
  const selected =
    (defaultId ? prices.find((price) => price.id === defaultId) : undefined) ||
    prices.find((price) => normalizeKey(price.lookup_key) === normalizedLookupKey) ||
    (prices.length === 1 ? prices[0] : undefined);

  return selected ? { product, price: selected } : undefined;
}

// Provide test doubles that return Promises by default because the component calls `.catch(...)`
export const loadActiveProducts = vi.fn(async () => {
  return [];
});

export const startCheckout = vi.fn(async (_opts?: any) => {
  // Simulate Stripe redirect creation success
  return { id: "cs_test_123" };
});

export const openBillingPortal = vi.fn(async () => {
  // Simulate portal session creation success
  return { id: "bps_test_123" };
});

// Observe subscriptions: resolves to an unsubscribe function and may call cb synchronously.
export const observeSubscriptions = vi.fn((cb: (subs: Subscription[]) => void) => {
  cb([]);
  return Promise.resolve(() => {});
});
