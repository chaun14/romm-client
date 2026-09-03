import { useEffect, useRef } from "react";
import { ExternalLink, Gamepad2, HardDrive, Save } from "lucide-react";
import { buildImageUrl, classNames, formatSize, romPlatform, romSize } from "../../lib/format";
import type { Rom } from "../../types";
import { Badge } from "../common/Badge";
import { RemoteImage } from "../common/RemoteImage";
import { EmptyState } from "../common/States";

export function RomGrid({
  roms,
  baseUrl,
  onOpenRom,
  onOpenInRomm,
  onVisibleRom,
}: {
  roms: Rom[];
  baseUrl: string;
  onOpenRom: (rom: Rom) => void;
  onOpenInRomm: (rom: Rom) => void;
  onVisibleRom: (rom: Rom) => void;
}) {
  const itemRefs = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = Number((entry.target as HTMLElement).dataset.romId);
          const rom = roms.find((item) => item.id === id);
          if (rom && !rom.statusLoaded && !rom.statusLoading) {
            onVisibleRom(rom);
          }
          observer.unobserve(entry.target);
        });
      },
      { root: null, rootMargin: "360px 0px", threshold: 0.01 },
    );

    itemRefs.current.forEach((element, id) => {
      const rom = roms.find((item) => item.id === id);
      if (rom && !rom.statusLoaded && !rom.statusLoading) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [onVisibleRom, roms]);

  if (!roms.length) return <EmptyState label="No ROMs found" />;

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
      {roms.map((rom) => {
        const cover = buildImageUrl(rom.localCoverUrl || rom.path_cover_small || rom.url_cover, baseUrl);
        return (
          <article
            key={rom.id}
            data-rom-id={rom.id}
            ref={(element) => {
              if (element) itemRefs.current.set(rom.id, element);
              else itemRefs.current.delete(rom.id);
            }}
            className={classNames(
              "group relative flex min-h-96 flex-col overflow-hidden rounded-md border bg-panel p-3 transition hover:-translate-y-0.5",
              rom.isCached
                ? "border-emerald-400/70 bg-[linear-gradient(145deg,rgba(16,185,129,0.10),rgba(30,41,59,1)_45%)] shadow-[0_0_0_1px_rgba(16,185,129,0.08)] hover:border-emerald-300 hover:shadow-[0_10px_28px_rgba(16,185,129,0.16)]"
                : rom.hasSaves
                  ? "border-blue-400/60 bg-[linear-gradient(145deg,rgba(99,102,241,0.10),rgba(30,41,59,1)_45%)] hover:border-blue-300 hover:shadow-[0_10px_28px_rgba(99,102,241,0.16)]"
                  : "border-line hover:border-brand",
            )}
          >
            <button
              type="button"
              className="absolute inset-0 z-0 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              onClick={() => onOpenRom(rom)}
              aria-label={`Open details for ${rom.name || rom.fs_name || "ROM"}`}
            />
            {rom.isCached || rom.hasSaves ? (
              <div
                className={classNames(
                  "pointer-events-none absolute inset-x-0 top-0 z-10 h-1",
                  rom.isCached && rom.hasSaves ? "bg-gradient-to-r from-emerald-400 to-brand" : rom.isCached ? "bg-emerald-400" : "bg-brand",
                )}
              />
            ) : null}
            {rom.isCached || rom.hasSaves ? (
              <div className="pointer-events-none absolute right-5 top-5 z-10 flex gap-1.5">
                {rom.isCached ? (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-emerald-500 text-white shadow-lg backdrop-blur" title="Installed locally">
                    <HardDrive className="h-3.5 w-3.5" />
                  </span>
                ) : null}
                {rom.hasSaves ? (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-brand text-white shadow-lg backdrop-blur" title="Save available">
                    <Save className="h-3.5 w-3.5" />
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="pointer-events-none relative z-10 aspect-[3/4] overflow-hidden rounded-md bg-ink">
              {cover ? <RemoteImage src={cover} alt={rom.name || "ROM cover"} className="h-full w-full object-cover transition group-hover:scale-105" fallbackClassName="m-auto mt-24 h-12 w-12 text-slate-600" /> : <Gamepad2 className="m-auto mt-24 h-12 w-12 text-slate-600" />}
            </div>
            <div className="pointer-events-none relative z-10 mt-3 min-w-0 flex-1">
              <div className="line-clamp-2 text-sm font-semibold leading-5">{rom.name || rom.fs_name}</div>
              <div className="mt-1 truncate text-xs text-slate-400">{romPlatform(rom)}</div>
              <div className="mt-1 text-xs text-slate-500">{formatSize(romSize(rom))}</div>
            </div>
            <div className="pointer-events-none relative z-10 mt-3 flex items-center gap-2">
              {rom.isCached ? <Badge icon={<HardDrive />} label="Local" tone="green" /> : null}
              {rom.hasSaves ? <Badge icon={<Save />} label="Save" tone="blue" /> : null}
              <button
                type="button"
                className="pointer-events-auto ml-auto rounded-md border border-line p-2 text-slate-300 hover:border-brand hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
                onClick={() => onOpenInRomm(rom)}
                aria-label={`Open ${rom.name || rom.fs_name || "ROM"} in RomM`}
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
