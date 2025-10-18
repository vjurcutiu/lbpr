// features/billing/api.ts
// FOLLOW-UP PATCH: Targeted diagnostic logs for Stripe Portal + Checkout flows.
// Includes a lightweight logger with per-session trace id and consistent fields.

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

/* ------------------------------ logger ------------------------------ */

type LogLevel = "debug" | "info" | "warn" | "error";

const BILLING_TRACE = Math.random().toString(16).slice(2) + "-" + Date.now().toString(36);
function nowISO() { try { return new Date().toISOString(); } catch { return String(Date.now()); } }

function log(level: LogLevel, msg: string, extra?: Record<string, unknown>) {
  const payload = {
    ts: nowISO(),
    level,
    name: "billing",
    trace: BILLING_TRACE,
    msg,
    ...extra,
  };
  // Use console mapping so it shows with the right color in devtools
  const line = `[billing][${payload.trace}] ${msg}`;
  switch (level) {
    case "debug": console.debug(line, payload); break;
    case "info":  console.info(line, payload); break;
    case "warn":  console.warn(line, payload); break;
    case "error": console.error(line, payload); break;
  }
}

export function getBillingTraceId() { return BILLING_TRACE; }

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
  current_period_end?: number; // seconds
  role?: string | null;
  items?: { price: Price }[];
};

/** Wait for a signed-in user (with timeout) */
export function requireUser(timeoutMs = 8000): Promise<User> {
  log("debug", "requireUser:start", { timeoutMs });
  return new Promise((resolve, reject) => {
    let done = false;
    const to = setTimeout(() => {
      if (done) return;
      done = true;
      log("warn", "requireUser:timeout");
      reject(new Error("You need to be signed in to manage billing."));
    }, timeoutMs);

    const unsub = (auth as any).onAuthStateChanged(
      (u: User | null) => {
        if (!done && u) {
          done = true;
          clearTimeout(to);
          unsub();
          log("info", "requireUser:ok", { uid: u.uid });
          resolve(u);
        }
      },
      (err: any) => {
        if (done) return;
        done = true;
        clearTimeout(to);
        unsub();
        log("error", "requireUser:error", { error: String(err), code: (err && err.code) || undefined });
        reject(err);
      }
    );
  });
}

/** Convert low-level Firestore errors into helpful UI messages */
function explainFirestoreError(err: any): Error {
  const code = err?.code || err?.name;
  if (code === "permission-denied") {
    const hints = [
      "Publish Firestore rules that allow public read on `products/*` and `products/*/prices/*`.",
      "Make sure the web app uses the SAME Firebase project as your Firestore/Stripe extension.",
      "If App Check is enforced for Firestore, either disable enforcement for web in dev or initialize App Check.",
    ];
    return new Error("Missing or insufficient permissions. " + hints.join(" "));
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Load active products + nested prices mirrored by the extension */
export async function loadActiveProducts(dbArg: Firestore = db): Promise<Product[]> {
  const startedAt = Date.now();
  log("debug", "loadActiveProducts:start");
  try {
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
    log("info", "loadActiveProducts:ok", {
      products: results.length,
      allowlistCount: allowlist.length,
      ms: Date.now() - startedAt,
    });
    return results;
  } catch (err: any) {
    log("error", "loadActiveProducts:error", { error: String(err), code: err?.code });
    throw explainFirestoreError(err);
  }
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
  log("info", "startCheckout:write", {
    uid: user.uid,
    priceId,
    mode: payload.mode,
    success_url: payload.success_url,
    cancel_url: payload.cancel_url,
  });
  const ref = await addDoc(customerSessions, payload);
  log("debug", "startCheckout:docCreated", { path: `customers/${user.uid}/checkout_sessions/${ref.id}` });

  return new Promise((resolve, reject) => {
    const unsub = onSnapshot(doc(customerSessions, ref.id), (snap) => {
      const data = snap.data();
      log("debug", "startCheckout:snapshot", { exists: !!data });
      if (!data) return;
      if ((data as any).error) {
        unsub();
        const msg = (data as any).error?.message || "Checkout failed.";
        log("error", "startCheckout:errorFromExt", { msg, data });
        reject(new Error(msg));
      }
      if ((data as any).url) {
        const url = (data as any).url as string;
        log("info", "startCheckout:redirect", { url });
        unsub();
        try {
          window.location.assign(url);
        } catch (e) {
          log("error", "startCheckout:redirectFailed", { error: String(e) });
        }
        resolve();
      }
    }, (e) => {
      log("error", "startCheckout:snapshotError", { error: String(e), code: e?.code });
      reject(explainFirestoreError(e));
    });
  });
}

/**
 * Open the Billing Portal via extension.
 * If you are testing a **fixed test portal link** (e.g. from Stripe Dashboard),
 * set VITE_STRIPE_PORTAL_TEST_URL and we'll short-circuit to it for convenience.
 */
export async function openBillingPortal(returnUrl?: string): Promise<void> {
  const portalTestUrl = (import.meta.env.VITE_STRIPE_PORTAL_TEST_URL || "").trim();
  if (portalTestUrl) {
    log("warn", "openBillingPortal:usingTestUrl", { portalTestUrl });
    window.location.assign(portalTestUrl);
    return;
  }

  const user = await requireUser();
  const portalCol = collection(db, "customers", user.uid, "portal_sessions");
  const docPayload = {
    return_url: returnUrl || window.location.origin + "/billing",
  };
  log("info", "openBillingPortal:write", { uid: user.uid, return_url: docPayload.return_url });
  const ref = await addDoc(portalCol, docPayload);
  log("debug", "openBillingPortal:docCreated", { path: `customers/${user.uid}/portal_sessions/${ref.id}` });

  return new Promise((resolve, reject) => {
    const unsub = onSnapshot(doc(portalCol, ref.id), (snap) => {
      const data = snap.data();
      log("debug", "openBillingPortal:snapshot", { exists: !!data });
      if (!data) return;
      if ((data as any).error) {
        unsub();
        const msg = (data as any).error?.message || "Failed to open billing portal.";
        log("error", "openBillingPortal:errorFromExt", { msg, data });
        reject(new Error(msg));
      }
      if ((data as any).url) {
        const url = (data as any).url as string;
        log("info", "openBillingPortal:redirect", { url });
        unsub();
        try {
          window.location.assign(url);
        } catch (e) {
          log("error", "openBillingPortal:redirectFailed", { error: String(e) });
        }
        resolve();
      }
    }, (e) => {
      log("error", "openBillingPortal:snapshotError", { error: String(e), code: e?.code });
      reject(explainFirestoreError(e));
    });
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
    log("debug", "observeSubscriptions:start", { uid: user.uid });
    return onSnapshot(subsQ, (snap) => {
      const subs: Subscription[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      log("info", "observeSubscriptions:update", { count: subs.length });
      cb(subs);
    }, (e) => {
      log("warn", "observeSubscriptions:error", { error: String(e), code: e?.code });
      cb([]);
    });
  });
}
