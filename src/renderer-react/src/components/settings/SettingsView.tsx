import { Cloud, FolderOpen, LogOut, RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import type { Toast } from "../../types";
import { HeaderActions, IconButton } from "../layout/HeaderActions";

export function SettingsView({
  user,
  baseUrl,
  onRefresh,
  notify,
  onLoggedOut,
}: {
  user: any;
  baseUrl: string;
  onRefresh: () => void;
  notify: (message: string, type?: Toast["type"]) => void;
  onLoggedOut: () => void;
}) {
  return (
    <>
      <HeaderActions title="Settings">
        <IconButton onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </IconButton>
      </HeaderActions>
      <div className="max-w-xl rounded-md border border-line bg-panel p-5">
        <div className="mb-5 flex items-center gap-3">
          <Cloud className="h-5 w-5 text-brand-soft" />
          <div>
            <div className="font-semibold">{user ? "Connected" : "Disconnected"}</div>
            <div className="text-sm text-slate-400">{baseUrl || "No RomM server configured"}</div>
          </div>
        </div>
        {user ? (
          <div className="mb-5 rounded-md border border-line bg-ink p-4 text-sm">
            <div>Username: {user.username || "-"}</div>
            <div className="mt-1">Role: {user.role || "-"}</div>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button
            className="flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm text-slate-100 hover:bg-panel-soft"
            onClick={async () => {
              const result = await api.config.openWorkFolder();
              if (result.success) {
                notify("Work folder opened", "success");
              } else {
                notify(result.error || "Unable to open work folder", "error");
              }
            }}
          >
            <FolderOpen className="h-4 w-4" />
            Open work folder
          </button>

          <button
            className="flex items-center gap-2 rounded-md border border-rose-400/40 px-4 py-2 text-sm text-rose-100 hover:bg-rose-500/10"
            onClick={async () => {
              const result = await api.config.logout();
              if (result.success) {
                notify("Logged out", "success");
                onLoggedOut();
              } else {
                notify(result.error || "Logout failed", "error");
              }
            }}
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </div>
    </>
  );
}
