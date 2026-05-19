import type { ReactNode } from "react";

export type View = "platforms" | "installed" | "emulators" | "settings";

export type Platform = {
  id: number | string;
  name?: string;
  slug?: string;
  fs_slug?: string;
  display_name?: string;
  rom_count?: number;
  roms_count?: number;
  is_identified?: boolean;
  fs_size_bytes?: number;
};

export type Rom = {
  id: number;
  name?: string;
  fs_name?: string;
  platform_id?: number | string;
  platform_slug?: string;
  platform_fs_slug?: string;
  platform_name?: string;
  platform_display_name?: string;
  file_size_bytes?: number;
  fs_size_bytes?: number;
  size?: number;
  files?: Array<{ file_size_bytes?: number }>;
  path_cover_small?: string;
  path_cover_big?: string;
  path_cover_large?: string;
  url_cover?: string;
  summary?: string;
  isCached?: boolean;
  hasSaves?: boolean;
  lastSaveDate?: string | null;
  statusLoading?: boolean;
  statusLoaded?: boolean;
};

export type Toast = {
  id: number;
  type: "success" | "error" | "info";
  message: string;
};

export type DownloadState = {
  title: string;
  percent: number;
  detail?: string;
};

export type ImageProps = {
  src: string;
  alt: string;
  className: string;
  fallbackClassName: string;
  fallback?: ReactNode;
};
