import { ExternalLink, Gamepad2, HardDrive, Save } from "lucide-react";
import { buildImageUrl, formatSize, romPlatform, romSize } from "../../lib/format";
import type { Rom } from "../../types";
import { Badge } from "../common/Badge";
import { RemoteImage } from "../common/RemoteImage";
import { EmptyState } from "../common/States";

export function RomGrid({
  roms,
  baseUrl,
  onOpenRom,
  onOpenInRomm,
}: {
  roms: Rom[];
  baseUrl: string;
  onOpenRom: (rom: Rom) => void;
  onOpenInRomm: (rom: Rom) => void;
}) {
  if (!roms.length) return <EmptyState label="No ROMs found" />;

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
      {roms.map((rom) => {
        const cover = buildImageUrl(rom.path_cover_small || rom.url_cover, baseUrl);
        return (
          <article key={rom.id} className="group flex min-h-96 flex-col rounded-md border border-line bg-panel p-3 transition hover:border-brand">
            <button className="aspect-[3/4] overflow-hidden rounded-md bg-ink" onClick={() => onOpenRom(rom)}>
              {cover ? <RemoteImage src={cover} alt={rom.name || "ROM cover"} className="h-full w-full object-cover transition group-hover:scale-105" fallbackClassName="m-auto mt-24 h-12 w-12 text-slate-600" /> : <Gamepad2 className="m-auto mt-24 h-12 w-12 text-slate-600" />}
            </button>
            <div className="mt-3 min-w-0 flex-1">
              <div className="line-clamp-2 text-sm font-semibold leading-5">{rom.name || rom.fs_name}</div>
              <div className="mt-1 truncate text-xs text-slate-400">{romPlatform(rom)}</div>
              <div className="mt-1 text-xs text-slate-500">{formatSize(romSize(rom))}</div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              {rom.isCached ? <Badge icon={<HardDrive />} label="Local" tone="green" /> : null}
              {rom.hasSaves ? <Badge icon={<Save />} label="Save" tone="blue" /> : null}
              <button className="ml-auto rounded-md border border-line p-2 text-slate-300 hover:border-brand hover:text-white" onClick={() => onOpenInRomm(rom)}>
                <ExternalLink className="h-4 w-4" />
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
