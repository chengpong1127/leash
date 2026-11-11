import { cn } from "@/lib/utils";

/** Determinate progress bar. `value` and `max` are announced to assistive tech. */
export function Progress({ value, max, className, tone = "default" }: { value: number; max: number; className?: string; tone?: "default" | "full" }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : value > 0 ? 100 : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      data-slot="progress"
      className={cn("h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
    >
      <div className={cn("h-full rounded-full transition-all", tone === "full" ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
    </div>
  );
}
