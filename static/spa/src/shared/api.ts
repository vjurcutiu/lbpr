// static/spa/src/shared/api.ts
export const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "/api";

async function handle(res: Response) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Try to parse JSON error payloads from FastAPI if present
    try {
      const asJson = JSON.parse(text || "{}");
      const msg =
        typeof asJson.detail === "string"
          ? asJson.detail
          : (Array.isArray(asJson.detail) && asJson.detail[0]?.msg) || "";
      throw new Error(msg || res.statusText);
    } catch {
      throw new Error(text || res.statusText);
    }
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

export async function getJSON<T = unknown>(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    method: "GET",
  });
  return handle(res) as Promise<T>;
}

export type Formish =
  | Record<string, string>
  | URLSearchParams;

export async function postForm<T = unknown>(
  path: string,
  body: Formish
) {
  const params =
    body instanceof URLSearchParams
      ? body
      : new URLSearchParams(body);

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  return handle(res) as Promise<T>;
}

export async function postJSON<T = unknown, P = unknown>(
  path: string,
  payload: P,
  init?: RequestInit
) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    body: JSON.stringify(payload),
    ...init,
  });
  return handle(res) as Promise<T>;
}
