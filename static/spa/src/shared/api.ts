export const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

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
  // try json, else text
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

export async function getJSON<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    method: "GET",
    headers: {
      ...(init?.headers || {}),
    },
    ...init,
  });
  return handle(res) as Promise<T>;
}

export async function postJSON<T = any>(path: string, payload: any, init?: RequestInit): Promise<T> {
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
