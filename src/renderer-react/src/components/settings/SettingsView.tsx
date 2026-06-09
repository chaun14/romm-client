import { Cloud, Download, FolderOpen, LogOut, RefreshCw, RotateCw } from "lucide-react";
import { type ReactNode } from "react";
import { api } from "../../lib/api";
import type { Toast } from "../../types";
import { HeaderActions, IconButton } from "../layout/HeaderActions";

export type UpdateState = {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "none" | "error";
  version?: string;
  releaseNotes?: string;
  percent: number;
  message?: string;
};

const allowedReleaseNoteTags = new Set(["A", "BR", "CODE", "EM", "LI", "OL", "P", "PRE", "STRONG", "UL"]);

function isSafeUrl(value: string) {
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function renderSafeReleaseNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as HTMLElement;
  const children = Array.from(element.childNodes).map((child, index) => renderSafeReleaseNode(child, `${key}-${index}`));

  if (!allowedReleaseNoteTags.has(element.tagName)) {
    return <span key={key}>{children}</span>;
  }

  switch (element.tagName) {
    case "A": {
      const href = element.getAttribute("href") || "";
      if (!isSafeUrl(href)) return <span key={key}>{children}</span>;
      return (
        <a key={key} href={href} target="_blank" rel="noreferrer" className="text-blue-300 underline decoration-blue-300/50 hover:text-blue-200">
          {children}
        </a>
      );
    }
    case "BR":
      return <br key={key} />;
    case "CODE":
      return (
        <code key={key} className="rounded bg-panel-soft px-1 py-0.5 text-slate-100">
          {children}
        </code>
      );
    case "EM":
      return <em key={key}>{children}</em>;
    case "LI":
      return <li key={key}>{children}</li>;
    case "OL":
      return (
        <ol key={key} className="list-decimal space-y-1 pl-5">
          {children}
        </ol>
      );
    case "P":
      return (
        <p key={key} className="mt-2 first:mt-0">
          {children}
        </p>
      );
    case "PRE":
      return (
        <pre key={key} className="mt-2 overflow-x-auto rounded bg-panel-soft p-2 text-xs">
          {children}
        </pre>
      );
    case "STRONG":
      return <strong key={key}>{children}</strong>;
    case "UL":
      return (
        <ul key={key} className="list-disc space-y-1 pl-5">
          {children}
        </ul>
      );
    default:
      return <span key={key}>{children}</span>;
  }
}

function SafeReleaseNotes({ notes }: { notes: string }) {
  const hasHtml = /<\/?[a-z][\s\S]*>/i.test(notes);

  if (!hasHtml) {
    return (
      <div className="whitespace-pre-line">
        {notes}
      </div>
    );
  }

  const document = new DOMParser().parseFromString(notes, "text/html");
  return <div className="space-y-2">{Array.from(document.body.childNodes).map((node, index) => renderSafeReleaseNode(node, String(index)))}</div>;
}

export function SettingsView({
  user,
  baseUrl,
  version,
  update,
  onRefresh,
  onCheckUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  notify,
  onLoggedOut,
}: {
  user: any;
  baseUrl: string;
  version: string;
  update: UpdateState;
  onRefresh: () => void;
  onCheckUpdates: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
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
      <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
      <div className="rounded-md border border-line bg-panel p-5">
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
      <div className="rounded-md border border-line bg-panel p-5">
        <div className="mb-5 flex items-center gap-3">
          <Download className="h-5 w-5 text-brand-soft" />
          <div>
            <div className="font-semibold">Updates</div>
            <div className="text-sm text-slate-400">Current version {version || "-"}</div>
          </div>
        </div>

        <div className="mb-5 rounded-md border border-line bg-ink p-4 text-sm">
          <div className="font-medium">
            {update.status === "checking" && "Checking for updates..."}
            {update.status === "available" && `Version ${update.version || "-"} available`}
            {update.status === "downloading" && `Downloading update ${update.percent}%`}
            {update.status === "downloaded" && `Version ${update.version || "-"} ready`}
            {update.status === "none" && (update.message || "No update available")}
            {update.status === "error" && (update.message || "Update error")}
            {update.status === "idle" && "No check started"}
          </div>
          {update.releaseNotes ? (
            <div className="mt-3 max-h-36 overflow-y-auto text-slate-400">
              <SafeReleaseNotes notes={update.releaseNotes} />
            </div>
          ) : null}
          {update.status === "downloading" || update.status === "downloaded" ? (
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-panel-soft">
              <div className="h-full bg-brand transition-all" style={{ width: `${update.percent}%` }} />
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            className="flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm text-slate-100 hover:bg-panel-soft disabled:cursor-not-allowed disabled:opacity-50"
            disabled={update.status === "checking" || update.status === "downloading"}
            onClick={onCheckUpdates}
          >
            <RefreshCw className="h-4 w-4" />
            Check
          </button>
          <button
            className="flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-[#4f46e5] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={update.status !== "available"}
            onClick={onDownloadUpdate}
          >
            <Download className="h-4 w-4" />
            Download
          </button>
          <button
            className="flex items-center gap-2 rounded-md border border-emerald-400/40 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={update.status !== "downloaded"}
            onClick={onInstallUpdate}
          >
            <RotateCw className="h-4 w-4" />
            Install & restart
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
