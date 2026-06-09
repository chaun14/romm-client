import { Loader2 } from "lucide-react";
import type { DownloadState } from "../../types";

export function DownloadModal({ state, onClose }: { state: DownloadState; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-md rounded-md border border-line bg-panel p-5 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-brand-soft" />
          <div className="font-semibold">{state.title}</div>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-ink">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.min(100, Math.max(0, state.percent))}%` }} />
        </div>
        <div className="mt-3 flex justify-between text-sm text-slate-400">
          <span>{state.percent}%</span>
          <span>{state.detail}</span>
        </div>
        <button className="mt-5 rounded-md border border-line px-4 py-2 text-sm hover:border-brand" onClick={onClose}>
          Hide
        </button>
      </div>
    </div>
  );
}
