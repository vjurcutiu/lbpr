import { cn } from "@/lib/utils"

function DialogSurfaceBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-slot="dialog-surface-background"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] bg-background",
        className
      )}
    >
      <span className="absolute -right-20 -top-24 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
      <span className="absolute left-1/2 top-0 h-40 w-[28rem] -translate-x-1/2 rounded-full bg-muted/45 blur-3xl" />
      <span className="absolute -bottom-28 -left-24 h-64 w-64 rounded-full bg-primary/[0.06] blur-3xl" />
    </div>
  )
}

export { DialogSurfaceBackground }
