// features/billing/api.ts
import { app as firebaseApp, auth as firebaseAuth } from "@/features/auth/firebase";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  onSnapshot,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  type Firestore,
  type DocumentData,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getJSON, postJSON } from "@/shared/api";

// Narrow import of Auth type to avoid coupling here
import type { User } from "firebase/auth";

const db = getFirestore(firebaseApp);

export const STRIPE_PRO_PLAN_KEY = "pro";
export const STRIPE_PRO_LOOKUP_KEY = "pro_monthly";

// ---------- helper logging ----------
const BILLING_TRACE = Math.random().toString(36).slice(2, 10);
export function getBillingTraceId() { return BILLING_TRACE; }
function logBilling(level: "debug" | "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = `[billing][${BILLING_TRACE}] ${msg}`;
  const payload = { level, msg, trace: BILLING_TRACE, ...extra };
  // eslint-disable-next-line no-console
  (console as any)[level === "debug" ? "debug" : level](line, payload);
}

/* ------------------------------ types ------------------------------ */

export type StripeMetadata = Record<string, string | number | boolean | null | undefined>;

export type Price = {
  id: string;
  unit_amount?: number;
  currency?: string;
  interval?: "day" | "week" | "month" | "year";
  interval_count?: number;
  product?: string;
  active?: boolean;
  type?: "recurring" | "one_time";
  lookup_key?: string | null;
  nickname?: string | null;
  metadata?: StripeMetadata;
};

export type Product = {
  id: string;
  name?: string;
  description?: string;
  active?: boolean;
  default_price?: string | { id?: string } | null;
  images?: string[];
  metadata?: StripeMetadata;
  prices?: Price[];
};

export type Subscription = {
  id: string;
  status: "active" | "trialing" | "past_due" | "canceled" | string;
  current_period_start?: number | string | { seconds: number };
  current_period_end?: number | string | { seconds: number };
  cancel_at?: number | string | { seconds: number } | null;
  cancel_at_period_end?: boolean;
  canceled_at?: number | string | { seconds: number } | null;
  items?: { price: Price }[];
};

export type CheckoutOptions = {
  planKey?: string,
  mode?: "subscription" | "payment",
  successUrl?: string,
  cancelUrl?: string,
  quantity?: number,
  allowPromotionCodes?: boolean,
  trialFromPlan?: boolean,
};

export type PlanCatalogSelection = {
  product: Product;
  price: Price;
};

/** Wait for a signed-in user (with timeout) */
export function requireUser(timeoutMs = 8000): Promise<User> {
  return new Promise((resolve, reject) => {
    let done = false;
    const to = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("You need to be signed in to manage billing."));
    }, timeoutMs);

    const { auth } = (firebaseAuth as any) ? { auth: (firebaseAuth as any) } : { auth: firebaseAuth };
    const unsub = (auth as any).onAuthStateChanged(
      (u: User | null) => {
        if (done) return;
        if (u && (u as any).emailVerified) {
          done = true;
          clearTimeout(to);
          unsub();
          resolve(u);
        } else if (u && !(u as any).emailVerified) {
          done = true;
          clearTimeout(to);
          unsub();
          reject(new Error("Please verify your email before managing billing."));
        }
      },
      (err: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(to);
        unsub();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    );
  });
}

function explainFirestoreError(err: unknown): Error {
  const anyErr = err as any;
  const code = anyErr?.code || anyErr?.name;
  if (code === "permission-denied") {
    return new Error("Missing or insufficient permissions for Firestore billing collections.");
  }
  return err instanceof Error ? err : new Error(String(err));
}

function normalizeKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function stripeMetadataValue(metadata: StripeMetadata | undefined, key: string): string {
  return normalizeKey(metadata?.[key]);
}

function metadataPlanKey(product: Product): string {
  return (
    stripeMetadataValue(product.metadata, "app_plan_key") ||
    stripeMetadataValue(product.metadata, "plan_key") ||
    stripeMetadataValue(product.metadata, "code")
  );
}

function productMatchesPlanKey(product: Product, planKey: string): boolean {
  const metaKey = metadataPlanKey(product);
  if (metaKey) return metaKey === planKey;

  const normalizedName = normalizeKey(product.name);
  if (!normalizedName) return false;
  const words = normalizedName.split(/[^a-z0-9]+/).filter(Boolean);
  return words.includes(planKey);
}

function extractStripeId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.includes("/") ? trimmed.split("/").filter(Boolean).at(-1) || null : trimmed;
  }

  const anyValue = value as any;
  if (typeof anyValue.id === "string" && anyValue.id.trim()) return anyValue.id.trim();
  if (typeof anyValue.path === "string" && anyValue.path.trim()) {
    return anyValue.path.split("/").filter(Boolean).at(-1) || null;
  }
  return null;
}

function resolveDefaultPriceId(product: Product): string | null {
  return extractStripeId(product.default_price);
}

function isRecurringPrice(price: Price): boolean {
  return price.active !== false && price.type !== "one_time" && !!price.interval;
}

function coercePriceDoc(priceId: string, data: any, fallbackProductId: string): Price {
  const recurring = data?.recurring || {};
  return {
    id: priceId,
    unit_amount: data?.unit_amount,
    currency: data?.currency,
    interval: data?.interval || recurring.interval,
    interval_count: data?.interval_count || recurring.interval_count,
    product: extractStripeId(data?.product) || fallbackProductId,
    active: data?.active,
    type: data?.type,
    lookup_key: data?.lookup_key || null,
    nickname: data?.nickname || null,
    metadata: data?.metadata || {},
  };
}

function parseEmbeddedPrices(raw: unknown, fallbackProductId: string): Price[] {
  const prices: Price[] = [];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [priceId, value] of Object.entries(raw as Record<string, any>)) {
      if (value && typeof value === "object") prices.push(coercePriceDoc(priceId, value, fallbackProductId));
    }
  } else if (Array.isArray(raw)) {
    for (const value of raw) {
      if (!value || typeof value !== "object") continue;
      const priceId = String((value as any).id || "").trim();
      if (priceId) prices.push(coercePriceDoc(priceId, value, fallbackProductId));
    }
  }
  return prices;
}

export function selectPlanCatalogPrice(
  products: Product[],
  planKey: string = STRIPE_PRO_PLAN_KEY,
  lookupKey: string = STRIPE_PRO_LOOKUP_KEY,
): PlanCatalogSelection | undefined {
  const normalizedPlanKey = normalizeKey(planKey);
  const normalizedLookupKey = normalizeKey(lookupKey);
  const candidates = products.filter((product) => product.active !== false && productMatchesPlanKey(product, normalizedPlanKey));

  for (const product of candidates) {
    const prices = (product.prices || []).filter(isRecurringPrice);
    const defaultPriceId = resolveDefaultPriceId(product);
    const defaultPrice = defaultPriceId ? prices.find((price) => price.id === defaultPriceId) : undefined;
    if (defaultPrice) return { product, price: defaultPrice };

    const lookupPrice = normalizedLookupKey
      ? prices.find((price) => normalizeKey(price.lookup_key) === normalizedLookupKey)
      : undefined;
    if (lookupPrice) return { product, price: lookupPrice };

    if (prices.length === 1) return { product, price: prices[0] };
  }

  return undefined;
}

export async function loadPlanCatalogSelection(planKey: string = STRIPE_PRO_PLAN_KEY): Promise<PlanCatalogSelection | undefined> {
  try {
    const data = await getJSON<PlanCatalogSelection>(`/billing/catalog?plan_key=${encodeURIComponent(planKey)}`, {
      cache: "no-store",
      timeoutMs: 10000,
    });
    if (data?.product?.id && data?.price?.id) return data;
  } catch (e) {
    logBilling("warn", "server billing catalog fallback failed", { err: (e as any)?.message || String(e) });
  }
  return undefined;
}

/** Load active products + nested prices mirrored by the extension */
export async function loadActiveProducts(dbArg: Firestore = db): Promise<Product[]> {
  const productsCol = collection(dbArg, "products");
  const q = query(productsCol, where("active", "==", true));
  const snaps = await getDocs(q);

  const results: Product[] = [];
  for (const pDoc of snaps.docs) {
    const data = pDoc.data() as DocumentData;
    const product: Product = {
      id: pDoc.id,
      name: data.name,
      description: data.description,
      active: data.active,
      default_price: data.default_price,
      images: Array.isArray(data.images) ? data.images : [],
      metadata: data.metadata || {},
      prices: parseEmbeddedPrices(data.prices, pDoc.id),
    };

    // Prices are mirrored by the extension in a subcollection.
    const pricesSnap = await getDocs(collection(dbArg, "products", pDoc.id, "prices"));
    const subcollectionPrices = pricesSnap.docs.map((pr) => {
      const prData = pr.data() as DocumentData;
      const recurring = prData.recurring || {};
      return {
        id: pr.id,
        unit_amount: prData.unit_amount,
        currency: prData.currency,
        interval: prData.interval || recurring.interval,
        interval_count: prData.interval_count || recurring.interval_count,
        product: extractStripeId(prData.product) || pDoc.id,
        active: prData.active,
        type: prData.type,
        lookup_key: prData.lookup_key || null,
        nickname: prData.nickname || null,
        metadata: prData.metadata || {},
      };
    });
    if (subcollectionPrices.length) product.prices = subcollectionPrices;
    results.push(product);
  }
  return results;
}

/** Observe active Stripe products and nested prices mirrored by the extension.
 *  The Billing page uses this instead of a one-time fetch so Stripe dashboard changes
 *  appear after the Firebase extension syncs them to Firestore.
 */
export function observeActiveProducts(cb: (products: Product[]) => void, dbArg: Firestore = db): () => void {
  const productsCol = collection(dbArg, "products");
  const q = query(productsCol, where("active", "==", true));
  const productsById = new Map<string, Product>();
  const priceUnsubs = new Map<string, () => void>();
  let closed = false;

  const emit = () => {
    if (closed) return;
    cb(Array.from(productsById.values()));
  };

  const unsubProducts = onSnapshot(q, (snap) => {
    const activeProductIds = new Set<string>();

    for (const pDoc of snap.docs) {
      activeProductIds.add(pDoc.id);
      const data = pDoc.data() as DocumentData;
      const embeddedPrices = parseEmbeddedPrices(data.prices, pDoc.id);
      const existingPrices = productsById.get(pDoc.id)?.prices || embeddedPrices;
      productsById.set(pDoc.id, {
        id: pDoc.id,
        name: data.name,
        description: data.description,
        active: data.active,
        default_price: data.default_price,
        images: Array.isArray(data.images) ? data.images : [],
        metadata: data.metadata || {},
        prices: existingPrices,
      });

      if (!priceUnsubs.has(pDoc.id)) {
        const unsubPrices = onSnapshot(collection(dbArg, "products", pDoc.id, "prices"), (pricesSnap) => {
          const product = productsById.get(pDoc.id);
          if (!product) return;
          const subcollectionPrices = pricesSnap.docs.map((pr) => {
            const prData = pr.data() as DocumentData;
            const recurring = prData.recurring || {};
            return {
              id: pr.id,
              unit_amount: prData.unit_amount,
              currency: prData.currency,
              interval: prData.interval || recurring.interval,
              interval_count: prData.interval_count || recurring.interval_count,
              product: extractStripeId(prData.product) || pDoc.id,
              active: prData.active,
              type: prData.type,
              lookup_key: prData.lookup_key || null,
              nickname: prData.nickname || null,
              metadata: prData.metadata || {},
            };
          });
          product.prices = subcollectionPrices.length ? subcollectionPrices : (product.prices || []);
          productsById.set(pDoc.id, { ...product });
          emit();
        }, (e) => {
          logBilling("warn", "price catalog listener failed", { productId: pDoc.id, err: (e as any)?.message || String(e) });
          emit();
        });
        priceUnsubs.set(pDoc.id, unsubPrices);
      }
    }

    for (const productId of Array.from(productsById.keys())) {
      if (!activeProductIds.has(productId)) {
        productsById.delete(productId);
        priceUnsubs.get(productId)?.();
        priceUnsubs.delete(productId);
      }
    }

    emit();
  }, (e) => {
    const err = explainFirestoreError(e);
    logBilling("error", "product catalog listener failed", { err: err.message });
    cb([]);
  });

  return () => {
    closed = true;
    unsubProducts();
    for (const unsub of priceUnsubs.values()) unsub();
    priceUnsubs.clear();
  };
}

/** Start a Checkout Session via the backend, which resolves the active Stripe price server-side. */
export async function startCheckout(opts?: CheckoutOptions): Promise<void> {
  await requireUser();

  const payload = {
    plan_key: opts?.planKey || STRIPE_PRO_PLAN_KEY,
    mode: opts?.mode || "subscription",
    success_url: opts?.successUrl,
    cancel_url: opts?.cancelUrl,
    quantity: opts?.quantity ?? 1,
    allow_promotion_codes: !!opts?.allowPromotionCodes,
    trial_from_plan: !!opts?.trialFromPlan,
  };

  const data = await postJSON<{ url?: string }>("/billing/checkout", payload, { timeoutMs: 20000 });
  const url = data?.url;
  if (typeof url !== "string" || !url.startsWith("http")) {
    throw new Error("Checkout failed to start.");
  }
  window.location.assign(url);
}

/** Open the Billing Portal using the official callable function (preferred).
 *  Falls back to Firestore `portal_sessions` for older extension versions.
 */
export async function openBillingPortal(returnUrl?: string): Promise<void> {
  const env: any = (import.meta as any).env || {};
  const e2e = env.VITE_E2E === "1" || env.MODE === "e2e";
  const hardcoded = e2e ? String(env.VITE_STRIPE_PORTAL_TEST_URL || "").trim() : "";
  if (hardcoded) {
    logBilling("warn", "Using hardcoded VITE_STRIPE_PORTAL_TEST_URL (E2E mode). This bypasses the extension.");
    window.location.assign(hardcoded);
    return;
  }

  const region = String(env.VITE_FIREBASE_FUNCTIONS_REGION || "us-central1").trim();
  try {
    const functions = getFunctions(firebaseApp, region);
    // Callable provided by the Firestore Stripe Payments extension.
    const createPortalLink = httpsCallable(functions, "ext-firestore-stripe-payments-createPortalLink");
    const res = await createPortalLink({
      returnUrl: returnUrl || window.location.origin + "/billing",
      locale: "auto",
    } as any);
    const data: any = res?.data;
    const url = data?.url as string | undefined;
    if (typeof url === "string" && url.startsWith("http")) {
      window.location.assign(url);
      return;
    }
    throw new Error("Callable returned no URL");
  } catch (err: unknown) {
    logBilling("warn", "createPortalLink failed, attempting Firestore fallback", { err: (err as any)?.message || String(err), region });
    // ----- Firestore fallback for older extension versions -----
    const user = await requireUser();
    const portalCol = collection(db, "customers", user.uid, "portal_sessions");
    const ref = await addDoc(portalCol, { return_url: returnUrl || window.location.origin + "/billing" });
    await new Promise<void>((resolve, reject) => {
      const unsub = onSnapshot(doc(portalCol, ref.id), (snap) => {
        const data = snap.data() as any;
        if (!data) return;
        if (data.error) {
          unsub();
          const msg = data.error?.message || "Failed to open billing portal.";
          reject(new Error(msg));
        }
        if (data.url) {
          const url = data.url as string;
          unsub();
          try { window.location.assign(url); } finally { resolve(); }
        }
      }, (e) => reject(explainFirestoreError(e)));
    });
  }
}

/** Observe current subscriptions (latest first) */
export function observeSubscriptions(cb: (subs: Subscription[]) => void) {
  return requireUser().then((user) => {
    const subsQ = query(
      collection(db, "customers", user.uid, "subscriptions"),
      orderBy("created", "desc"),
      limit(10),
    );
    return onSnapshot(subsQ, (snap) => {
      const subs: Subscription[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      cb(subs);
      // lightweight debug line to help verify sync after portal actions
      try {
        const top = subs[0] as any;
        console.debug(`[billing][${getBillingTraceId()}] diag:subscriptions:snapshot`, {
          count: subs.length,
          topStatus: top?.status || null,
          topCancelAt: top?.cancel_at || null,
          topCPend: top?.current_period_end || null
        });
      } catch {
        /* ignore logging errors */
      }
    }, (_e) => { cb([]); });
  });
}
