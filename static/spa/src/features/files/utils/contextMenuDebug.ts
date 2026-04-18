import { toast } from "sonner";

import { parseErr } from "./formatters";

export const DEBUG_CTXMENU =
  typeof window !== "undefined" &&
  (new URLSearchParams(window.location.search).has("ctxmenu") || loadDebugContextMenuFlag());

function loadDebugContextMenuFlag() {
  try {
    return window.localStorage.getItem("lbp.debug.ctxmenu") === "true";
  } catch {
    return false;
  }
}

function elSummary(el: unknown) {
  try {
    if (!el || typeof el !== "object") return null;
    const element = el as HTMLElement;
    const tag = element.tagName;
    if (!tag) return null;
    const raw = String(element.innerText ?? element.textContent ?? "");
    const text = raw.replace(/\s+/g, " ").trim().slice(0, 80);
    return {
      tag,
      id: element.id,
      className: element.className,
      role: element.getAttribute?.("role") ?? undefined,
      dataset: element.dataset,
      text,
    };
  } catch {
    return null;
  }
}

export function ctxEvtSummary(event: unknown) {
  try {
    const e = event as {
      type?: string;
      target?: HTMLElement | null;
      clientX?: number;
      clientY?: number;
      button?: number;
      buttons?: number;
      detail?: number;
      composedPath?: () => unknown[];
    };

    const target = e?.target ?? null;
    const x = e?.clientX;
    const y = e?.clientY;
    const atPoint =
      typeof document !== "undefined" && typeof x === "number" && typeof y === "number"
        ? document.elementFromPoint(x, y)
        : null;
    const path =
      typeof e?.composedPath === "function"
        ? e.composedPath().slice(0, 8).map(elSummary).filter(Boolean)
        : undefined;

    return {
      type: e?.type,
      x,
      y,
      button: e?.button,
      buttons: e?.buttons,
      detail: e?.detail,
      target: elSummary(target),
      atPoint: elSummary(atPoint),
      path,
    };
  } catch {
    const e = event as { type?: string } | null;
    return { type: e?.type };
  }
}

export function ctxLog(label: string, payload?: unknown) {
  if (!DEBUG_CTXMENU) return;
  console.log(`[ctxmenu] ${label}`, payload ?? "");
}

export function safeAction<T = unknown>(label: string, fn: (event: T) => void | Promise<void>) {
  return (event: T) => {
    try {
      ctxLog(`action.${label}`, ctxEvtSummary(event));
      const result = fn(event);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err: unknown) => {
          console.error(`[files][action:${label}]`, err);
          toast.error(`Action failed: ${label}`, { description: parseErr(err) });
        });
      }
    } catch (err) {
      console.error(`[files][action:${label}]`, err);
      toast.error(`Action failed: ${label}`, { description: parseErr(err) });
    }
  };
}
