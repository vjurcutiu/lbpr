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
import type { User } from "firebase/auth";

const db   = getFirestore(firebaseApp);
const auth = firebaseAuth;

type LogLevel = "debug" | "info" | "warn" | "error";
const BILLING_TRACE = Math.random().toString(16).slice(2) + "-" + Date.now().toString(36);
export function getBillingTraceId() { return BILLING_TRACE; }
function log(level: LogLevel, msg: string, extra?: Record<string, unknown>) {
  const line = `[billing][${BILLING_TRACE}] ${msg}`;
  const payload = { level, msg, trace: BILLING_TRACE, ...extra };
  (console as any)[level === "debug" ? "debug" : level](line, payload);
}

/* ------------------------------ types ------------------------------ */

export type Price = {
  id: string;
  unit_amount?: number;
  currency?: string;
  interval?: "day" | "week" | "month" | "year";
  interval_count?: number;
  product?: string;
  active?: boolean;
  trial_period_days?: number | null;
  nickname?: string | null;
  type?: "one_time" | "recurring";
};

export type Product = {
  id: string;
  name: string;
  description?: string;
  active?: boolean;
  default_price?: string | null;
  images?: string[];
  metadata?: Record<string, string>;
  prices?: Price[];
};

export type Subscription = {
  id: string;
  status:
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "unpaid"
    | "incomplete"
    | "incomplete_expired"
    | "paused";
  cancel_at_period_end?: boolean;
  cancel_at?: number | string | { seconds: number };
  canceled_at?: number | string | { seconds: number } | null;
  current_period_end?: number | string | { seconds: number };
  role?: string | null;
  items?: { price: Price }[];
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

    const unsub = (auth as any).onAuthStateChanged(
      (u: User | null) => {
        if (!done && u) {
          done = true;
          clearTimeout(to);
          unsub();
          resolve(u);
        }
      },
      (err: any) => {
        if (done) return;
        done = true;
        clearTimeout(to);
        unsub();
        reject(err);
      }
    );
  });
}

function explainFirestoreError(err: any): Error {
  const code = err?.code || err?.name;
  if (code === "permission-denied") {
    return new Error("Missing or insufficient permissions for Firestore billing collections.");
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Load active products + nested prices mirrored by the extension */
export async function loadActiveProducts(dbArg: Firestore = db): Promise<Product[]> {
  const productsCol = collection(dbArg, "products");
  const q = query(productsCol, where("active", "==", true));
  const snaps = await getDocs(q);

  const allowlist = (import.meta.env.VITE_STRIPE_PRICE_ALLOWLIST || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const allowSet = new Set(allowlist);

  const results: Product[] = [];
  for (const pDoc of snaps.docs) {
    const data = pDoc.data() as DocumentData;
    const product: Product = {
      id: pDoc.id,
      name: data.name,
      description: data.description,
      active: data.active,
      default_price: data.default_price || null,
      images: data.images || [],
      metadata: data.metadata || {},
      prices: [],
    };

    const pricesSnap = await getDocs(
      query(collection(pDoc.ref, "prices"), where("active", "==", true))
    );
    product.prices = pricesSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) } as Price))
      .filter(pr => allowSet.size ? allowSet.has(pr.id) : true)
      .sort((a, b) => (a.unit_amount || 0) - (b.unit_amount || 0));

    if ((product.prices?.length || 0) > 0) results.push(product);
  }
  return results;
}

/** Start a Checkout Session via extension (subscription by default) */
export async function startCheckout(priceId: string, opts?: {
  mode?: "subscription" | "payment",
  successUrl?: string,
  cancelUrl?: string,
  quantity?: number,
  allowPromotionCodes?: boolean,
  trialFromPlan?: boolean,
}): Promise<void> {
  const user = await requireUser();
  const customerSessions = collection(db, "customers", user.uid, "checkout_sessions");
  const payload: any = {
    price: priceId,
    mode: opts?.mode || "subscription",
    success_url: opts?.successUrl || window.location.origin + "/billing",
    cancel_url:  opts?.cancelUrl  || window.location.origin + "/billing",
    quantity: opts?.quantity || 1,
    allow_promotion_codes: !!opts?.allowPromotionCodes,
    trial_from_plan: !!opts?.trialFromPlan,
  };
  const ref = await addDoc(customerSessions, payload);
  return new Promise((resolve, reject) => {
    const unsub = onSnapshot(doc(customerSessions, ref.id), (snap) => {
      const data = snap.data();
      if (!data) return;
      if ((data as any).error) {
        unsub();
        const msg = (data as any).error?.message || "Checkout failed.";
        reject(new Error(msg));
      }
      if ((data as any).url) {
        const url = (data as any).url as string;
        unsub();
        try { window.location.assign(url); } finally { resolve(); }
      }
    }, (e) => reject(explainFirestoreError(e)));
  });
}

/** Open the Billing Portal via extension (or fixed test URL via env) */
export async function openBillingPortal(returnUrl?: string): Promise<void> {
  const portalTestUrl = (import.meta.env.VITE_STRIPE_PORTAL_TEST_URL || "").trim();
  if (portalTestUrl) {
    window.location.assign(portalTestUrl);
    return;
  }

  const user = await requireUser();
  const portalCol = collection(db, "customers", user.uid, "portal_sessions");
  const ref = await addDoc(portalCol, { return_url: returnUrl || window.location.origin + "/billing" });
  return new Promise((resolve, reject) => {
    const unsub = onSnapshot(doc(portalCol, ref.id), (snap) => {
      const data = snap.data();
      if (!data) return;
      if ((data as any).error) {
        unsub();
        const msg = (data as any).error?.message || "Failed to open billing portal.";
        reject(new Error(msg));
      }
      if ((data as any).url) {
        const url = (data as any).url as string;
        unsub();
        try { window.location.assign(url); } finally { resolve(); }
      }
    }, (e) => reject(explainFirestoreError(e)));
  });
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
    }, (_e) => { cb([]); });
  });
}
