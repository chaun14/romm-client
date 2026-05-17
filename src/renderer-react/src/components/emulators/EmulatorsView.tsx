import { CheckCircle2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { LoadingState } from "../common/States";
import { HeaderActions, IconButton } from "../layout/HeaderActions";

export function EmulatorsView({
  loading,
  emulators,
  configs,
  onRefresh,
  onSave,
}: {
  loading: boolean;
  emulators: Record<string, any>;
  configs: Record<string, any>;
  onRefresh: () => void;
  onSave: (key: string, value: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    Object.keys(emulators).forEach((key) => {
      next[key] = configs[key]?.path || "";
    });
    setDrafts(next);
  }, [configs, emulators]);

  return (
    <>
      <HeaderActions title="Emulators">
        <IconButton onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </IconButton>
      </HeaderActions>
      {loading ? (
        <LoadingState />
      ) : (
        <div className="max-w-4xl space-y-3">
          {Object.entries(emulators).map(([key, emulator]) => (
            <div key={key} className="rounded-md border border-line bg-panel p-4">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <div className="font-semibold">{emulator.name || key}</div>
                  <div className="mt-1 text-sm text-slate-400">{(emulator.platforms || []).join(", ") || "No platform metadata"}</div>
                </div>
                {configs[key]?.path ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : null}
              </div>
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-brand"
                  value={drafts[key] || ""}
                  placeholder="Path to emulator executable"
                  onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                />
                <button className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-[#4f46e5]" onClick={() => onSave(key, drafts[key] || "")}>
                  Save
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
