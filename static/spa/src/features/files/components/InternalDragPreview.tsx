import { FileText, Folder } from "lucide-react";

import { cn } from "@/lib/utils";

export function InternalDragPreview({
  kind,
  labels,
  count,
}: {
  kind: "file" | "folder";
  labels: string[];
  count: number;
}) {
  const top = labels[0] || (kind === "folder" ? "Folder" : "File");
  const rest = labels.slice(1).filter(Boolean);
  const shown = rest.slice(0, 2);
  const remaining = Math.max(0, count - 1 - shown.length);

  const stackDepth = Math.min(3, Math.max(1, count));

  return (
    <div className="pointer-events-none">
      <div className="relative">
        {/* Subtle stacked cards to imply multiple items */}
        {Array.from({ length: stackDepth }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "absolute inset-0 rounded-lg border bg-background shadow-lg",
              i === 0 ? "" : "opacity-70"
            )}
            style={{ transform: `translate(${i * 6}px, ${i * 6}px)` }}
          />
        ))}

        <div className="relative rounded-lg border bg-background shadow-lg px-3 py-2 min-w-[220px] max-w-[320px]">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 text-muted-foreground">
              {kind === "folder" ? <Folder className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{count === 1 ? top : `${top}`}</div>

              {count > 1 && (
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {shown.join(", ")}
                  {remaining > 0 ? `${shown.length ? " " : ""}+ ${remaining} more` : ""}
                </div>
              )}
            </div>

            {count > 1 && (
              <div className="ml-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground shadow">
                {count}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
