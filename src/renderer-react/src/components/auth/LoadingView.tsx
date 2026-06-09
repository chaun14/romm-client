import { Loader2 } from "lucide-react";
import { classNames } from "../../lib/format";

export type LoadingStepKey = "url" | "auth" | "cache" | "roms";
export type LoadingStepStatus = "idle" | "pending" | "success" | "warning" | "error";

export type LoadingStep = {
  key: LoadingStepKey;
  label: string;
  status: LoadingStepStatus;
  message?: string;
};

const statusText: Record<LoadingStepStatus, string> = {
  idle: "",
  pending: "○",
  success: "✓",
  warning: "!",
  error: "×",
};

export function LoadingView({ steps, message }: { steps: LoadingStep[]; message: string }) {
  const currentStatus = steps.find((step) => step.status === "pending")?.status || steps.find((step) => step.status === "error")?.status || "pending";

  return (
    <div className="flex h-full items-center justify-center bg-ink px-6 text-slate-100">
      <div className="w-full max-w-md rounded-md border border-line bg-panel p-8 text-center shadow-2xl">
        <div className="mb-1 text-3xl font-bold text-brand">RomM Client</div>
        <div className="mb-8 text-sm text-slate-400">Your ROM Management Solution</div>

        <Loader2 className="mx-auto mb-6 h-14 w-14 animate-spin text-brand" />

        <div className="mb-4 flex items-center justify-center gap-2 text-sm text-slate-300">
          <span
            className={classNames(
              "h-2.5 w-2.5 rounded-full",
              currentStatus === "error" && "bg-rose-400",
              currentStatus === "warning" && "bg-amber-400",
              currentStatus !== "error" && currentStatus !== "warning" && "bg-brand",
            )}
          />
          <span>{message}</span>
        </div>

        <div className="mt-7 space-y-2 text-left">
          {steps.map((step) => (
            <div
              key={step.key}
              className={classNames(
                "flex items-center gap-3 text-sm text-slate-500",
                step.status === "pending" && "text-slate-100",
                step.status === "success" && "text-emerald-300",
                step.status === "warning" && "text-amber-300",
                step.status === "error" && "text-rose-300",
              )}
            >
              <span
                className={classNames(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-panel-soft text-xs",
                  step.status === "pending" && "animate-pulse text-slate-100",
                  step.status === "success" && "text-emerald-300",
                  step.status === "warning" && "text-amber-300",
                  step.status === "error" && "text-rose-300",
                )}
              >
                {statusText[step.status]}
              </span>
              <span>{step.message || step.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
