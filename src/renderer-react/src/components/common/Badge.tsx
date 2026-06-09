import type { ReactNode } from "react";
import { classNames } from "../../lib/format";

export function Badge({ icon, label, tone }: { icon: ReactNode; label: string; tone: "green" | "blue" }) {
  return (
    <span className={classNames("inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px]", tone === "green" ? "bg-emerald-400/15 text-emerald-200" : "bg-brand/15 text-blue-200")}>
      <span className="[&>svg]:h-3 [&>svg]:w-3">{icon}</span>
      {label}
    </span>
  );
}
