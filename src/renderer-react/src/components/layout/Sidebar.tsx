import { Boxes, ExternalLink, HardDrive, Settings, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../../lib/api";
import { classNames } from "../../lib/format";
import type { View } from "../../types";

function getInstanceDomain(baseUrl: string) {
  if (!baseUrl) return "No RomM server configured";
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

function NavButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={classNames(
        "mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition",
        active ? "bg-brand text-white" : "text-slate-300 hover:bg-panel-soft hover:text-white",
      )}
      onClick={onClick}
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      {label}
    </button>
  );
}

export function Sidebar({
  view,
  user,
  baseUrl,
  onPlatforms,
  onView,
}: {
  view: View;
  user: any;
  baseUrl: string;
  onPlatforms: () => void;
  onView: (view: View) => void;
}) {
  const instanceDomain = getInstanceDomain(baseUrl);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-panel">
      <div className="border-b border-line px-6 py-5">
        <div className="text-xl font-semibold tracking-normal">RomM Client</div>
        <div className="mt-1 truncate text-sm text-slate-400" title={baseUrl || instanceDomain}>
          {instanceDomain}
        </div>
      </div>

      <nav className="flex-1 p-3">
        <NavButton icon={<Boxes />} label="Platforms" active={view === "platforms"} onClick={onPlatforms} />
        <NavButton icon={<HardDrive />} label="Installed" active={view === "installed"} onClick={() => onView("installed")} />
        <NavButton icon={<SlidersHorizontal />} label="Emulators" active={view === "emulators"} onClick={() => onView("emulators")} />
        <NavButton icon={<Settings />} label="Settings" active={view === "settings"} onClick={() => onView("settings")} />
      </nav>

      <div className="space-y-3 border-t border-line p-4">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-md border border-line bg-panel-soft px-3 py-2 text-sm text-slate-200 transition hover:border-brand hover:text-white"
          onClick={() => api.openRommWebInterface()}
        >
          <ExternalLink size={16} />
          Open RomM
        </button>
        <div className="rounded-md border border-line bg-ink p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className={classNames("h-2.5 w-2.5 rounded-full", user ? "bg-emerald-400" : "bg-rose-400")} />
            <span>{user ? "Connected" : "Disconnected"}</span>
          </div>
          {user ? <div className="mt-2 truncate text-xs text-slate-400">{user.username || "User"}</div> : null}
        </div>
      </div>
    </aside>
  );
}
