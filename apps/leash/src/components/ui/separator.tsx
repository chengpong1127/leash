import { cn } from "@/lib/utils";

export function Separator({ className }: { className?: string }) {
  return <hr data-slot="separator" className={cn("h-px w-full border-0 bg-border", className)} />;
}
