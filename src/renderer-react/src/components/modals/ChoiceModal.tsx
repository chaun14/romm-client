import { X } from "lucide-react";
import { useMemo, useState } from "react";

export function ChoiceModal({
  title,
  subtitle,
  options,
  fallbackAction,
  fallbackLabel,
  onClose,
}: {
  title: string;
  subtitle: string;
  options: Array<{ key: string; title: string; detail?: string; action: () => void }>;
  fallbackAction?: () => void;
  fallbackLabel?: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;

    return options.filter((option) => {
      return option.title.toLowerCase().includes(normalized) || (option.detail || "").toLowerCase().includes(normalized);
    });
  }, [options, query]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-xl flex-col rounded-md border border-line bg-panel shadow-2xl">
        <div className="border-b border-line p-5">
          <div className="flex items-start gap-4">
            <div className="mr-auto">
              <h2 className="text-xl font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
            </div>
            <button className="rounded-md p-2 text-slate-400 hover:bg-panel-soft hover:text-white" onClick={onClose}>
              <X className="h-5 w-5" />
            </button>
          </div>
          {options.length > 5 ? (
            <input
              className="mt-4 w-full rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none placeholder:text-slate-500 focus:border-brand"
              value={query}
              placeholder="Search saves..."
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="space-y-2">
            {filteredOptions.map((option) => (
              <button
                key={option.key}
                className="w-full rounded-md border border-line bg-ink p-4 text-left transition hover:border-brand hover:bg-panel-soft"
                onClick={option.action}
              >
                <div className="font-semibold">{option.title}</div>
                {option.detail ? <div className="mt-1 text-sm text-slate-400">{option.detail}</div> : null}
              </button>
            ))}
            {filteredOptions.length === 0 ? <div className="rounded-md border border-dashed border-line p-6 text-center text-sm text-slate-400">No matching option</div> : null}
          </div>
        </div>

        {fallbackAction ? (
          <div className="border-t border-line p-5">
            <button className="w-full rounded-md border border-line p-3 text-sm text-slate-200 transition hover:border-brand" onClick={fallbackAction}>
              {fallbackLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
