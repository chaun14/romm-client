import { classNames } from "../../lib/format";
import type { Toast } from "../../types";

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={classNames(
            "rounded-md border px-4 py-3 text-sm shadow-2xl",
            toast.type === "success" && "border-emerald-400/40 bg-emerald-950/90 text-emerald-100",
            toast.type === "error" && "border-rose-400/40 bg-rose-950/90 text-rose-100",
            toast.type === "info" && "border-brand/40 bg-panel/95 text-slate-100",
          )}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
