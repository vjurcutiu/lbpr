export function parseErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    const s = JSON.stringify(err as any);
    return s.length ? s : "Unexpected error";
  } catch {
    return "Unexpected error";
  }
}

export function fmtSize(n: number) {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
