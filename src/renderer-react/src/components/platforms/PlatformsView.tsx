import { RefreshCw, Search } from "lucide-react";
import { useMemo } from "react";
import { formatSize } from "../../lib/format";
import type { Platform, Rom } from "../../types";
import { EmptyState, LoadingState } from "../common/States";
import { HeaderActions, IconButton } from "../layout/HeaderActions";
import { RomGrid } from "../roms/RomGrid";
import { PlatformImage } from "./PlatformImage";

export function PlatformsView(props: {
  loading: boolean;
  platforms: Platform[];
  roms: Rom[];
  selectedPlatform: Platform | null;
  search: string;
  baseUrl: string;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  onBack: () => void;
  onPlatformClick: (platform: Platform) => void;
  onOpenRom: (rom: Rom) => void;
  onOpenInRomm: (rom: Rom) => void;
  onVisibleRom: (rom: Rom) => void;
}) {
  const platformsWithRoms = useMemo(() => props.platforms.filter((platform) => (platform.rom_count || 0) > 0), [props.platforms]);

  if (props.selectedPlatform) {
    return (
      <>
        <HeaderActions title={props.selectedPlatform.display_name || props.selectedPlatform.name || "ROMs"}>
          <div className="flex items-center rounded-md border border-line bg-panel">
            <Search className="ml-3 h-4 w-4 text-slate-500" />
            <input
              className="w-72 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-slate-500"
              value={props.search}
              placeholder="Search ROMs..."
              onChange={(event) => props.onSearchChange(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && props.onSearch()}
            />
          </div>
          <IconButton onClick={props.onSearch}>Search</IconButton>
          <IconButton onClick={props.onBack}>Back</IconButton>
          <IconButton onClick={props.onRefresh}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>
        </HeaderActions>
        {props.loading ? <LoadingState /> : <RomGrid roms={props.roms} baseUrl={props.baseUrl} onOpenRom={props.onOpenRom} onOpenInRomm={props.onOpenInRomm} onVisibleRom={props.onVisibleRom} />}
      </>
    );
  }

  return (
    <>
      <HeaderActions title="Platforms">
        <IconButton onClick={props.onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </IconButton>
      </HeaderActions>
      {props.loading ? (
        <LoadingState />
      ) : platformsWithRoms.length === 0 ? (
        <EmptyState label="No platforms with ROMs found" />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {platformsWithRoms.map((platform) => (
            <button
              key={String(platform.id)}
              className="rounded-md border border-line bg-panel p-5 text-left transition hover:-translate-y-0.5 hover:border-brand hover:bg-panel-soft"
              onClick={() => props.onPlatformClick(platform)}
            >
              <div className="mb-5 flex h-20 w-full items-center justify-center">
                <div className="h-16 w-24">
                  <PlatformImage platform={platform} baseUrl={props.baseUrl} />
                </div>
              </div>
              <div className="truncate text-lg font-semibold">{platform.display_name || platform.name || platform.slug}</div>
              <div className="mt-1 text-sm text-slate-400">{platform.rom_count || platform.roms_count || 0} ROMs</div>
              {platform.fs_size_bytes ? <div className="mt-1 text-xs text-slate-500">{formatSize(platform.fs_size_bytes)}</div> : null}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
