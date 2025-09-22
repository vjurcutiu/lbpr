export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

async function handle(res: Response) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

export async function getJSON(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  return handle(res);
}

export async function postForm(path: string, body: Record<string, any>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  return handle(res);
}

export async function postJSON(path: string, data: any) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}
