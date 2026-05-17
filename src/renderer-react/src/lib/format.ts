import type { Platform, Rom } from "../types";

export function formatSize(bytes?: number) {
  if (!bytes || bytes <= 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function romSize(rom: Rom) {
  return rom.file_size_bytes || rom.fs_size_bytes || rom.size || rom.files?.[0]?.file_size_bytes;
}

export function romPlatform(rom: Rom) {
  return rom.platform_display_name || rom.platform_name || rom.platform_slug || rom.platform_fs_slug || "Unknown";
}

export function buildImageUrl(value: string | undefined, baseUrl: string) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl || window.location.href).toString();
  } catch {
    return value;
  }
}

export function platformSlug(platform: Platform) {
  return platform.slug || (platform.is_identified ? platform.fs_slug : "") || "";
}

export function classNames(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}
