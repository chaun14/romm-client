import { formatSize } from "../../lib/format";

export function StatsBar({ stats }: { stats: any }) {
  const storageBytes = stats?.TOTAL_FILESIZE_BYTES ?? stats?.FS_SIZE_BYTES ?? stats?.fs_size_bytes;
  const items = [
    ["Platforms", stats?.PLATFORMS],
    ["ROMs", stats?.ROMS],
    ["Saves", stats?.SAVES],
    ["States", stats?.STATES],
    ["Screenshots", stats?.SCREENSHOTS],
    ["Storage", storageBytes ? formatSize(storageBytes) : undefined],
  ];

  return (
    <div className="grid grid-cols-6 border-b border-line bg-panel">
      {items.map(([label, value]) => (
        <div key={String(label)} className="border-r border-line px-5 py-3 last:border-r-0">
          <div className="text-lg font-semibold">{value ?? "-"}</div>
          <div className="text-xs uppercase text-slate-500">{label}</div>
        </div>
      ))}
    </div>
  );
}
