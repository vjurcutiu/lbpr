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

// Narrow import of Auth type to avoid coupling here
import type { User } from "firebase/auth";

const db = getFirestore(firebaseApp);

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

export type Price = {
  id: string;
  unit_amount?: number;
  currency?: string;
  interval?: "day" | "week" | "month" | "year";
  interval_count?: number;
  product?: string;
  active?: boolean;
  type?: "recurring" | "one_time";
};

export type Product = {
  id: string;
  name?: string;
  description?: string;
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

/** Wait for a signed-in user (with timeout) */
export function requireUser(timeoutMs = 8000): Promise<User> {
  return new Promise((resolve, reject) => {
    let done = false;
    const to = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("You need to be signed in to manage billing."));
    }, timeoutMs);

    const { auth } = firebaseAuth as any ? { auth: (firebaseAuth as any) } : { auth: firebaseAuth };
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

  const allowlist = (import.meta.env.VITE_STRIPE_PRICE_ALLOWLIST || "").split(",").map(s => s.trim()).filter(Boolean);
  const allowSet = new Set(allowlist);

  const results: Product[] = [];
  for (const pDoc of snaps.docs) {
    const data = pDoc.data() as DocumentData;
    const product: Product = {
      id: pDoc.id,
      name: data.name,
      description: data.description,
      prices: [],
    };

    // Prices are mirrored by the extension in a subcollection
    const pricesSnap = await getDocs(collection(dbArg, "products", pDoc.id, "prices"));
    for (const pr of pricesSnap.docs) {
      const prData = pr.data() as DocumentData;
      if (allowSet.size && !allowSet.has(pr.id)) continue;
      product.prices!.push({
        id: pr.id,
        unit_amount: prData.unit_amount,
        currency: prData.currency,
        interval: prData.interval,
        interval_count: prData.interval_count,
        product: prData.product,
        active: prData.active,
        type: prData.type,
      });
    }
    results.push(product);
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
        const msg = (data as any).error?.message || "Checkout failed to start.";
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
