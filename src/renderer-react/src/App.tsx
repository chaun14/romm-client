import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toasts } from "./components/common/Toasts";
import { EmulatorsView } from "./components/emulators/EmulatorsView";
import { Sidebar } from "./components/layout/Sidebar";
import { StatsBar } from "./components/layout/StatsBar";
import { ChoiceModal } from "./components/modals/ChoiceModal";
import { DownloadModal } from "./components/modals/DownloadModal";
import { RomModal } from "./components/modals/RomModal";
import { PlatformsView } from "./components/platforms/PlatformsView";
import { InstalledView } from "./components/roms/InstalledView";
import { SettingsView } from "./components/settings/SettingsView";
import { api, asArray, events, getResultData, pageSize } from "./lib/api";
import { formatSize, romPlatform } from "./lib/format";
import type { DownloadState, Platform, Rom, Toast, View } from "./types";

export function App() {
  const [view, setView] = useState<View>("platforms");
  const [loading, setLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [roms, setRoms] = useState<Rom[]>([]);
  const [installedRoms, setInstalledRoms] = useState<Rom[]>([]);
  const [emulators, setEmulators] = useState<Record<string, any>>({});
  const [emulatorConfigs, setEmulatorConfigs] = useState<Record<string, any>>({});
  const [search, setSearch] = useState("");
  const [installedSearch, setInstalledSearch] = useState("");
  const [installedPlatform, setInstalledPlatform] = useState("");
  const [selectedRom, setSelectedRom] = useState<Rom | null>(null);
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [saveChoice, setSaveChoice] = useState<any>(null);
  const [emulatorChoice, setEmulatorChoice] = useState<any>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const previousViews = useRef<View[]>([]);
  const selectedPlatformRef = useRef(selectedPlatform);
  const selectedRomRef = useRef(selectedRom);
  const downloadRef = useRef(download);
  const saveChoiceRef = useRef(saveChoice);
  const emulatorChoiceRef = useRef(emulatorChoice);

  const notify = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = Date.now();
    setToasts((items) => [...items, { id, type, message }]);
    window.setTimeout(() => setToasts((items) => items.filter((toast) => toast.id !== id)), 4500);
  }, []);

  const resetPlatformView = useCallback(() => {
    setView("platforms");
    setSelectedPlatform(null);
    setRoms([]);
    setSearch("");
  }, []);

  const navigateToView = useCallback((nextView: View) => {
    setView((currentView) => {
      if (currentView !== nextView) {
        previousViews.current.push(currentView);
      }
      return nextView;
    });

  const goBack = useCallback(() => {
    if (downloadRef.current) {
      setDownload(null);
      return;
    }

    if (saveChoiceRef.current) {
      setSaveChoice(null);
      return;
    }

    if (emulatorChoiceRef.current) {
      setEmulatorChoice(null);
      return;
    }

    if (selectedRomRef.current) {
      setSelectedRom(null);
      return;
    }

    if (selectedPlatformRef.current) {
      resetPlatformView();
      return;
    }

    const previousView = previousViews.current.pop();
    if (previousView) {
      setView(previousView);
    }
  }, [resetPlatformView]);

  const enrichRoms = useCallback(async (items: Rom[]) => {
    const enriched = await Promise.all(
      items.map(async (rom) => {
        const [cacheResult, savesResult] = await Promise.all([
          api.checkRomCache(rom).catch(() => ({ success: false, data: false })),
          api.checkRomSaves(rom).catch(() => ({ success: false, data: false })),
        ]);

        return {
          ...rom,
          isCached: cacheResult.success ? Boolean(cacheResult.data ?? cacheResult.cached) : false,
          hasSaves: Boolean(savesResult.success && savesResult.data),
        };
      }),
    );

    return enriched.sort((a, b) => Number(b.isCached) - Number(a.isCached) || (a.name || "").localeCompare(b.name || ""));
  }, []);

  const refreshShell = useCallback(async () => {
    const [userResult, urlResult, statsResult] = await Promise.all([
      api.config.getCurrentUser().catch(() => null),
      api.config.getBaseUrl().catch(() => ""),
      api.stats.fetch().catch(() => null),
    ]);

    setUser(getResultData(userResult, null));
    setBaseUrl(getResultData(urlResult, ""));
    setStats(getResultData(statsResult, null));
  }, []);

  const loadPlatforms = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.platforms.fetchAll();
      setPlatforms(asArray<Platform>(getResultData(result, [])));
    } catch (error: any) {
      notify(error.message || "Unable to load platforms", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const loadInstalled = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.roms.fetchLocal();
      setInstalledRoms(await enrichRoms(asArray<Rom>(getResultData(result, []))));
    } catch (error: any) {
      notify(error.message || "Unable to load installed ROMs", "error");
    } finally {
      setLoading(false);
    }
  }, [enrichRoms, notify]);

  const loadEmulators = useCallback(async () => {
    setLoading(true);
    try {
      const [supportedResult, configsResult] = await Promise.all([
        api.emulator.getSupportedEmulators(),
        api.emulator.getConfigs(),
      ]);
      setEmulators(getResultData(supportedResult, {}));
      setEmulatorConfigs(getResultData(configsResult, {}));
    } catch (error: any) {
      notify(error.message || "Unable to load emulators", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const loadRomsForPlatform = useCallback(
    async (platform: Platform) => {
      const platformId = typeof platform.id === "string" && /^\d+$/.test(platform.id) ? Number(platform.id) : platform.id;
      setSelectedPlatform(platform);
      setRoms([]);
      setSearch("");
      setLoading(true);
      try {
        const result = await api.roms.getByPlatform(platformId, pageSize, 0);
        const data = getResultData<any>(result, []);
        setRoms(await enrichRoms(asArray<Rom>(data)));
      } catch (error: any) {
        notify(error.message || "Unable to load ROMs", "error");
      } finally {
        setLoading(false);
      }
    },
    [enrichRoms, notify],
  );

  const runSearch = useCallback(async () => {
    if (!selectedPlatform) return;
    if (!search.trim()) {
      await loadRomsForPlatform(selectedPlatform);
      return;
    }

    setLoading(true);
    try {
      const platformId = typeof selectedPlatform.id === "string" && /^\d+$/.test(selectedPlatform.id) ? Number(selectedPlatform.id) : selectedPlatform.id;
      const result = await api.roms.search(search.trim(), platformId, pageSize, 0);
      const data = getResultData<any>(result, []);
      setRoms(await enrichRoms(asArray<Rom>(data)));
    } catch (error: any) {
      notify(error.message || "Search failed", "error");
    } finally {
      setLoading(false);
    }
  }, [enrichRoms, loadRomsForPlatform, notify, search, selectedPlatform]);

  const launchRom = useCallback(
    async (rom: Rom, integrated = false) => {
      setSelectedRom(null);
      setDownload({ title: integrated ? `Launching ${rom.name}` : `Preparing ${rom.name}`, percent: 0 });

      try {
        api.onRomDownloadProgress((progress) => {
          setDownload({
            title: progress.message || `Preparing ${rom.name}`,
            percent: Math.round(progress.percent || progress.progress || 0),
            detail: progress.transferred && progress.total ? `${formatSize(progress.transferred)} / ${formatSize(progress.total)}` : progress.step,
          });
        });

        api.onDownloadComplete(() => {
          api.removeDownloadProgressListener();
          api.removeDownloadCompleteListener();
          setDownload(null);
          notify(`${rom.name || "ROM"} is ready`, "success");
          loadInstalled();
        });

        const result = await api.roms.launch(rom, null);
        if (!result?.success) {
          throw new Error(result?.error || "Unable to launch ROM");
        }

        if (integrated) {
          setDownload(null);
        }
      } catch (error: any) {
        api.removeDownloadProgressListener();
        api.removeDownloadCompleteListener();
        setDownload(null);
        notify(error.message || "Unable to launch ROM", "error");
      }
    },
    [loadInstalled, notify],
  );

  const deleteRom = useCallback(
    async (rom: Rom) => {
      const result = await api.deleteCachedRom(rom);
      if (result.success) {
        notify(`${rom.name || "ROM"} removed from local cache`, "success");
        await loadInstalled();
      } else {
        notify(result.error || "Unable to delete ROM", "error");
      }
    },
    [loadInstalled, notify],
  );

  useEffect(() => {
    refreshShell();
    loadPlatforms();
    loadInstalled();
    loadEmulators();

    events.onSaveChoiceModal?.((data: any) => setSaveChoice(data));
    events.onEmulatorChoiceModal?.((data: any) => setEmulatorChoice(data));
    events.onRomLaunched?.((data: any) => notify(`${data?.rom?.name || "ROM"} launched`, "success"));
    events.onRomLaunchFailed?.((data: any) => notify(data?.error || "Launch failed", "error"));

    return () => {
      events.removeSaveChoiceListener?.();
      events.removeEmulatorChoiceListener?.();
      events.removeRomLaunchListeners?.();
    };
  }, [loadEmulators, loadInstalled, loadPlatforms, notify, refreshShell]);

  useEffect(() => {
    selectedPlatformRef.current = selectedPlatform;
    selectedRomRef.current = selectedRom;
    downloadRef.current = download;
    saveChoiceRef.current = saveChoice;
    emulatorChoiceRef.current = emulatorChoice;
  }, [download, emulatorChoice, saveChoice, selectedPlatform, selectedRom]);

  useEffect(() => {
    const handleMouseBack = (event: MouseEvent) => {
      if (event.button !== 3) return;
      event.preventDefault();
      event.stopPropagation();
      goBack();
    };

    window.addEventListener("mouseup", handleMouseBack, { capture: true });
    return () => window.removeEventListener("mouseup", handleMouseBack, { capture: true });
  }, [goBack]);

  const filteredInstalled = useMemo(() => {
    return installedRoms.filter((rom) => {
      const matchesSearch = (rom.name || rom.fs_name || "").toLowerCase().includes(installedSearch.toLowerCase());
      const matchesPlatform = !installedPlatform || romPlatform(rom) === installedPlatform;
      return matchesSearch && matchesPlatform;
    });
  }, [installedPlatform, installedRoms, installedSearch]);

  const installedPlatforms = useMemo(() => Array.from(new Set(installedRoms.map(romPlatform))).sort(), [installedRoms]);

  return (
    <div className="flex h-full bg-ink text-slate-100">
      <Sidebar view={view} user={user} baseUrl={baseUrl} onPlatforms={resetPlatformView} onView={navigateToView} />

      <main className="flex min-w-0 flex-1 flex-col">
        <StatsBar stats={stats} />

        <section className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {view === "platforms" ? (
            <PlatformsView
              loading={loading}
              platforms={platforms}
              roms={roms}
              selectedPlatform={selectedPlatform}
              search={search}
              baseUrl={baseUrl}
              onRefresh={selectedPlatform ? () => loadRomsForPlatform(selectedPlatform) : loadPlatforms}
              onSearchChange={setSearch}
              onSearch={runSearch}
              onBack={resetPlatformView}
              onPlatformClick={loadRomsForPlatform}
              onOpenRom={setSelectedRom}
              onOpenInRomm={(rom) => api.openRommWebInterface(rom.id)}
            />
          ) : null}

          {view === "installed" ? (
            <InstalledView
              loading={loading}
              roms={filteredInstalled}
              platforms={installedPlatforms}
              platform={installedPlatform}
              search={installedSearch}
              baseUrl={baseUrl}
              onRefresh={loadInstalled}
              onSearchChange={setInstalledSearch}
              onPlatformChange={setInstalledPlatform}
              onOpenRom={setSelectedRom}
              onLaunch={launchRom}
              onDelete={deleteRom}
            />
          ) : null}

          {view === "emulators" ? (
            <EmulatorsView
              loading={loading}
              emulators={emulators}
              configs={emulatorConfigs}
              onRefresh={loadEmulators}
              onSave={async (key, value) => {
                const result = await api.emulator.saveConfig(key, value);
                if (result.success) {
                  notify("Emulator path saved", "success");
                  loadEmulators();
                } else {
                  notify(result.error || "Unable to save emulator path", "error");
                }
              }}
            />
          ) : null}

          {view === "settings" ? <SettingsView user={user} baseUrl={baseUrl} onRefresh={refreshShell} notify={notify} /> : null}
        </section>
      </main>

      {selectedRom ? (
        <RomModal
          rom={selectedRom}
          baseUrl={baseUrl}
          onClose={() => setSelectedRom(null)}
          onLaunch={() => launchRom(selectedRom)}
          onLaunchIntegrated={() => launchRom(selectedRom, true)}
          onOpenInRomm={() => api.openRommWebInterface(selectedRom.id)}
        />
      ) : null}

      {download ? <DownloadModal state={download} onClose={() => setDownload(null)} /> : null}

      {saveChoice ? (
        <ChoiceModal
          title="Choose a save"
          subtitle="Multiple saves are available for this game."
          options={(saveChoice.cloudSaves || saveChoice.saves || [])
            .slice()
            .sort((a: any, b: any) => {
              const dateA = Date.parse(a.updated_at || a.created_at || "");
              const dateB = Date.parse(b.updated_at || b.created_at || "");
              return (Number.isNaN(dateB) ? 0 : dateB) - (Number.isNaN(dateA) ? 0 : dateA);
            })
            .map((save: any) => ({
              key: String(save.id),
              title: save.name || save.file_name || `Cloud save ${save.id}`,
              detail: save.updated_at || save.created_at || "Cloud save",
              action: () => {
                events.sendSaveChoice?.("cloud", save.id);
                setSaveChoice(null);
              },
            }))}
          fallbackAction={() => {
            events.sendSaveChoice?.("local");
            setSaveChoice(null);
          }}
          fallbackLabel="Use local save"
          onClose={() => setSaveChoice(null)}
        />
      ) : null}

      {emulatorChoice ? (
        <ChoiceModal
          title="Choose an emulator"
          subtitle="Multiple emulators can launch this ROM."
          options={(emulatorChoice.emulators || []).map((emulator: any) => ({
            key: emulator.key,
            title: emulator.name || emulator.key,
            detail: (emulator.platforms || []).join(", "),
            action: () => {
              events.sendEmulatorChoice?.(emulator.key, emulatorChoice.rom);
              setEmulatorChoice(null);
            },
          }))}
          onClose={() => setEmulatorChoice(null)}
        />
      ) : null}

      <Toasts toasts={toasts} />
    </div>
  );
}
