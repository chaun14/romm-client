import { ExternalLink, Gamepad2, Play, X } from "lucide-react";
import { useState } from "react";
import { buildImageUrl, classNames, formatSize, romPlatform, romSize } from "../../lib/format";
import type { Rom } from "../../types";
import { RemoteImage } from "../common/RemoteImage";

export function RomModal({
  rom,
  baseUrl,
  canLaunchIntegrated,
  onClose,
  onLaunch,
  onLaunchIntegrated,
  onOpenInRomm,
}: {
  rom: Rom;
  baseUrl: string;
  canLaunchIntegrated: boolean;
  onClose: () => void;
  onLaunch: () => void;
  onLaunchIntegrated: () => void;
  onOpenInRomm: () => void;
}) {
  const cover = buildImageUrl(rom.localCoverUrl || rom.path_cover_big || rom.path_cover_large || rom.path_cover_small || rom.url_cover, baseUrl);
  const [expandedCover, setExpandedCover] = useState(false);

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6" onMouseDown={onClose}>
        <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-md border border-line bg-panel shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
          <div className="flex items-center border-b border-line px-5 py-4">
            <h2 className="mr-auto text-xl font-semibold">{rom.name || rom.fs_name}</h2>
            <button className="rounded-md p-2 text-slate-400 hover:bg-panel-soft hover:text-white" onClick={onClose}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="grid gap-5 p-5 md:grid-cols-[160px,1fr]">
            <div className="flex justify-center">
              <button
                className="flex aspect-[3/4] h-56 max-w-full items-center justify-center overflow-hidden rounded-md bg-ink text-left transition hover:ring-2 hover:ring-brand"
                onClick={() => cover && setExpandedCover(true)}
                title="Expand cover"
              >
                {cover ? <RemoteImage src={cover} alt={rom.name || "ROM cover"} className="mx-auto block h-full w-full object-contain object-center" fallbackClassName="m-auto h-12 w-12 text-slate-600" /> : <Gamepad2 className="m-auto h-12 w-12 text-slate-600" />}
              </button>
            </div>
            <div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Info label="Platform" value={romPlatform(rom)} />
                <Info label="Size" value={formatSize(romSize(rom))} />
                <Info label="File" value={rom.fs_name || "-"} wide />
              </div>
              {rom.summary ? <p className="mt-5 leading-7 text-slate-300">{rom.summary}</p> : null}
              <div className="mt-6 flex flex-wrap gap-2">
                <button className="flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-[#4f46e5]" onClick={onLaunch}>
                  <Play className="h-4 w-4" />
                  {rom.isCached ? "Launch" : "Download"}
                </button>
                {!rom.isCached && canLaunchIntegrated ? (
                  <button className="rounded-md border border-line px-4 py-2 text-sm hover:border-brand" onClick={onLaunchIntegrated}>
                    Launch with EmulatorJS
                  </button>
                ) : null}
                <button className="flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm hover:border-brand" onClick={onOpenInRomm}>
                  <ExternalLink className="h-4 w-4" />
                  Open in RomM
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {expandedCover && cover ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6" onMouseDown={() => setExpandedCover(false)}>
          <div className="relative max-h-full max-w-full" onMouseDown={(event) => event.stopPropagation()}>
            <button className="absolute right-2 top-2 rounded-md bg-black/60 p-2 text-white hover:bg-black/80" onClick={() => setExpandedCover(false)}>
              <X className="h-5 w-5" />
            </button>
            <RemoteImage src={cover} alt={rom.name || "ROM cover"} className="mx-auto block max-h-[calc(100vh-3rem)] max-w-[calc(100vw-3rem)] rounded-md object-contain shadow-2xl" fallbackClassName="h-16 w-16 text-slate-500" />
          </div>
        </div>
      ) : null}
    </>
  );
}

function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={classNames("rounded-md border border-line bg-ink p-3", wide && "col-span-2")}>
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm">{value}</div>
    </div>
  );
}
