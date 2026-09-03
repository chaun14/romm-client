import { Cloud, Loader2, Lock, LogIn, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export function LoginView({
  onAuthenticated,
  onContinueOffline,
  offlineRomCount,
}: {
  onAuthenticated: () => Promise<void> | void;
  onContinueOffline: () => Promise<void> | void;
  offlineRomCount: number;
}) {
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "logging-in" | "offline">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    api.config.getBaseUrl().then((url) => {
      if (url) setServerUrl(String(url).replace(/\/$/, ""));
    }).catch(() => {});
  }, []);

  const normalizeUrl = (value: string) => value.trim().replace(/\/$/, "");

  const prepareServer = async () => {
    const cleanUrl = normalizeUrl(serverUrl);
    if (!cleanUrl) throw new Error("RomM server URL is required");

    setStatus("checking");
    await api.config.setRommUrl(cleanUrl);
    const connection = await api.config.testConnection();
    if (!connection?.success) {
      throw new Error(connection?.error || "Unable to reach RomM server");
    }
    return cleanUrl;
  };

  const loginWithPassword = async () => {
    setError("");
    try {
      await prepareServer();
      if (!username.trim() || !password) {
        throw new Error("Username and password are required");
      }

      setStatus("logging-in");
      const result = await api.config.setCredentials(username.trim(), password);
      setPassword("");
      if (!result?.success) {
        throw new Error(result?.error || "Login failed");
      }

      await onAuthenticated();
    } catch (loginError: any) {
      setError(loginError.message || "Login failed");
    } finally {
      setStatus("idle");
    }
  };

  const loginWithOAuth = async () => {
    setError("");
    try {
      const cleanUrl = await prepareServer();
      setStatus("logging-in");
      const result = await api.config.startOAuth(cleanUrl);
      if (!result?.success) {
        throw new Error(result?.error || "OAuth login failed");
      }
      await onAuthenticated();
    } catch (loginError: any) {
      setError(loginError.message || "OAuth login failed");
    } finally {
      setStatus("idle");
    }
  };

  const continueOffline = async () => {
    setError("");
    setStatus("offline");
    try {
      await onContinueOffline();
    } catch (offlineError: any) {
      setError(offlineError.message || "Unable to start offline mode");
      setStatus("idle");
    }
  };

  const busy = status !== "idle";

  return (
    <div className="flex h-full items-center justify-center bg-ink px-6 text-slate-100">
      <div className="w-full max-w-md rounded-md border border-line bg-panel p-6 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand/20 text-brand-soft">
            <Cloud className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">RomM Client</h1>
            <p className="text-sm text-slate-400">Connect to your RomM instance</p>
          </div>
        </div>

        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-300">Server URL</span>
            <input
              className="w-full rounded-md border border-line bg-ink px-3 py-2 outline-none placeholder:text-slate-500 focus:border-brand"
              placeholder="https://romm.example.com"
              type="url"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              disabled={busy}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-300">Username</span>
              <input
                className="w-full rounded-md border border-line bg-ink px-3 py-2 outline-none placeholder:text-slate-500 focus:border-brand"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-300">Password</span>
              <input
                className="w-full rounded-md border border-line bg-ink px-3 py-2 outline-none placeholder:text-slate-500 focus:border-brand"
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && loginWithPassword()}
                disabled={busy}
              />
            </label>
          </div>

          {error ? <div className="rounded-md border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}

          <button
            className="flex w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#4f46e5] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={loginWithPassword}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Login and save session
          </button>

          <button
            className="flex w-full items-center justify-center gap-2 rounded-md border border-line px-4 py-2.5 text-sm text-slate-200 transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-60"
            onClick={loginWithOAuth}
            disabled={busy}
          >
            <LogIn className="h-4 w-4" />
            Login with RomM web session
          </button>

          {offlineRomCount > 0 ? (
            <div className="border-t border-line pt-4">
              <button
                className="flex w-full items-center justify-center gap-2 rounded-md border border-amber-400/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100 transition hover:border-amber-300 hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={continueOffline}
                disabled={busy}
              >
                {status === "offline" ? <Loader2 className="h-4 w-4 animate-spin" /> : <WifiOff className="h-4 w-4" />}
                Continue offline
              </button>
              <div className="mt-2 text-center text-xs text-slate-500">
                {offlineRomCount} local {offlineRomCount === 1 ? "game" : "games"} available
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
