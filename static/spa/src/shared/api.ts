export const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

type JSONRequestOptions = RequestInit & {
  timeoutMs?: number;
};

async function handle(res: Response) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    try {
      const asJson = JSON.parse(text || "{}");
      const msg =
        typeof asJson.detail === "string"
          ? asJson.detail
          : (Array.isArray(asJson.detail) && (asJson.detail[0] as any)?.msg) || "";
      throw new Error(msg || res.statusText);
    } catch {
      throw new Error(text || res.statusText);
    }
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

function buildSignal(signal?: AbortSignal, timeoutMs?: number): {
  signal?: AbortSignal;
  cleanup: () => void;
} {
  const hasTimeout = Number.isFinite(timeoutMs) && Number(timeoutMs) > 0;
  if (!signal && !hasTimeout) {
    return { signal: undefined, cleanup: () => {} };
  }

  const controller = new AbortController();
  const cleanupFns: Array<() => void> = [];

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return { signal: controller.signal, cleanup: () => {} };
    }
    const forwardAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", forwardAbort, { once: true });
    cleanupFns.push(() => signal.removeEventListener("abort", forwardAbort));
  }

  if (hasTimeout) {
    const timeoutId = globalThis.setTimeout(() => {
      controller.abort(new DOMException("Request timed out", "TimeoutError"));
    }, Number(timeoutMs));
    cleanupFns.push(() => globalThis.clearTimeout(timeoutId));
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      cleanupFns.forEach((fn) => fn());
    },
  };
}

function normalizeNetworkError(error: unknown, signal?: AbortSignal): Error {
  const signalReason = signal && "reason" in signal ? signal.reason : undefined;
  const signalReasonName =
    signalReason && typeof signalReason === "object" && "name" in signalReason
      ? String((signalReason as { name?: unknown }).name || "")
      : "";
  const errorName = error instanceof Error ? error.name : "";

  if (signalReasonName === "TimeoutError" || errorName === "TimeoutError") {
    return new Error("The request timed out. Please try again.");
  }
  if (error instanceof Error) return error;
  return new Error("Request failed");
}

async function requestJSON<T = any>(
  path: string,
  method: string,
  payload?: unknown,
  init?: JSONRequestOptions
): Promise<T> {
  const { timeoutMs, signal, headers, ...rest } = init || {};
  const resolved = buildSignal(signal, timeoutMs);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: resolved.signal,
      ...rest,
    });
    return handle(res) as Promise<T>;
  } catch (error) {
    throw normalizeNetworkError(error, resolved.signal);
  } finally {
    resolved.cleanup();
  }
}

export async function getJSON<T = any>(path: string, init?: JSONRequestOptions): Promise<T> {
  return requestJSON<T>(path, "GET", undefined, init);
}

export async function postJSON<T = any>(path: string, payload: any, init?: JSONRequestOptions): Promise<T> {
  return requestJSON<T>(path, "POST", payload, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

export async function patchJSON<T = any>(path: string, payload: any, init?: JSONRequestOptions): Promise<T> {
  return requestJSON<T>(path, "PATCH", payload, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

export async function deleteJSON<T = any>(path: string, init?: JSONRequestOptions): Promise<T> {
  return requestJSON<T>(path, "DELETE", undefined, init);
}
