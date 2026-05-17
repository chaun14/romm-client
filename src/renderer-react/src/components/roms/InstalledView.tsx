import { Gamepad2, Play, RefreshCw, Trash2 } from "lucide-react";
import { buildImageUrl, formatSize, romPlatform, romSize } from "../../lib/format";
import type { Rom } from "../../types";
import { RemoteImage } from "../common/RemoteImage";
import { EmptyState, LoadingState } from "../common/States";
import { HeaderActions, IconButton } from "../layout/HeaderActions";

type InstalledViewProps = {
  loading: boolean;
  roms: Rom[];
  platforms: string[];
  platform: string;
  search: string;
  baseUrl: string;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  onPlatformChange: (value: string) => void;
  onOpenRom: (rom: Rom) => void;
  onLaunch: (rom: Rom) => void;
  onDelete: (rom: Rom) => void;
};

export function InstalledView(props: InstalledViewProps) {
  return (
    <>
      <HeaderActions title="Installed ROMs">
        <select className="rounded-md border border-line bg-panel px-3 py-2 text-sm outline-none" value={props.platform} onChange={(event) => props.onPlatformChange(event.target.value)}>
          <option value="">All platforms</option>
          {props.platforms.map((platform) => (
            <option key={platform} value={platform}>
              {platform}
            </option>
          ))}
        </select>
        <input
          className="w-72 rounded-md border border-line bg-panel px-3 py-2 text-sm outline-none placeholder:text-slate-500"
          value={props.search}
          placeholder="Search installed ROMs..."
          onChange={(event) => props.onSearchChange(event.target.value)}
        />
        <IconButton onClick={props.onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </IconButton>
      </HeaderActions>
      {props.loading ? <LoadingState /> : <InstalledList {...props} />}
    </>
  );
}

function InstalledList(props: Pick<InstalledViewProps, "roms" | "baseUrl" | "onOpenRom" | "onLaunch" | "onDelete">) {
  if (!props.roms.length) return <EmptyState label="No installed ROMs found" />;

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
      {props.roms.map((rom) => {
        const cover = buildImageUrl(rom.path_cover_small || rom.url_cover, props.baseUrl);
        return (
          <article key={rom.id} className="rounded-md border border-line bg-panel p-4">
            <div className="flex gap-4">
              <button className="h-20 w-16 shrink-0 overflow-hidden rounded-md bg-ink" onClick={() => props.onOpenRom(rom)}>
                {cover ? <RemoteImage src={cover} alt={rom.name || "ROM cover"} className="h-full w-full object-cover" fallbackClassName="m-auto mt-6 h-7 w-7 text-slate-600" /> : <Gamepad2 className="m-auto mt-6 h-7 w-7 text-slate-600" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{rom.name || rom.fs_name}</div>
                <div className="mt-1 truncate text-sm text-slate-400">{romPlatform(rom)}</div>
                <div className="mt-1 text-xs text-slate-500">{formatSize(romSize(rom))}</div>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button className="flex flex-1 items-center justify-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-[#4f46e5]" onClick={() => props.onLaunch(rom)}>
                <Play className="h-4 w-4" />
                Launch
              </button>
              <button className="rounded-md border border-line px-3 py-2 text-slate-300 hover:border-rose-400 hover:text-rose-200" onClick={() => props.onDelete(rom)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
