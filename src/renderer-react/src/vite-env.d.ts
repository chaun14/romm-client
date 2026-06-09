/// <reference types="vite/client" />

type ApiResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

type RommApiBridge = {
  config: {
    setRommUrl: (url: string) => Promise<ApiResult>;
    setCredentials: (username: string, password: string) => Promise<ApiResult>;
    testConnection: () => Promise<ApiResult>;
    logout: () => Promise<ApiResult>;
    getCurrentUser: () => Promise<ApiResult<any>>;
    getBaseUrl: () => Promise<string | null>;
    getPlatformImageUrl: (slug: string) => Promise<string | null>;
    startOAuth: (url: string) => Promise<ApiResult>;
    hasSavedCredentials: () => Promise<boolean>;
    authenticateWithSavedCredentials: () => Promise<ApiResult>;
    hasSavedSession: () => Promise<boolean>;
    authenticateWithSavedSession: () => Promise<ApiResult>;
    getVersion: () => Promise<ApiResult<string>>;
    openWorkFolder: () => Promise<ApiResult<string>>;
  };
  roms: Record<string, (...args: any[]) => Promise<any>>;
  emulator: Record<string, (...args: any[]) => Promise<any>>;
  saves: Record<string, (...args: any[]) => Promise<any>>;
  platforms: Record<string, (...args: any[]) => Promise<any>>;
  stats: Record<string, (...args: any[]) => Promise<any>>;
  updates: Record<string, (...args: any[]) => Promise<any>>;
  images: {
    fetchDataUrl: (url: string) => Promise<ApiResult<string>>;
  };
  loginComplete: () => void;
  onRomDownloadProgress: (callback: (progress: any) => void) => void;
  removeDownloadProgressListener: () => void;
  onDownloadComplete: (callback: (data: any) => void) => void;
  removeDownloadCompleteListener: () => void;
  checkRomCache: (rom: any) => Promise<ApiResult<boolean>>;
  checkRomSaves: (rom: any) => Promise<ApiResult<boolean>>;
  deleteCachedRom: (rom: any) => Promise<ApiResult>;
  getRomCacheSize: (rom: any) => Promise<ApiResult<number>>;
  openRommWebInterface: (romId?: number) => Promise<ApiResult>;
};

type ElectronEventsBridge = {
  [key: string]: (...args: any[]) => void;
};

declare global {
  interface Window {
    electronAPI: RommApiBridge;
    electronEvents: ElectronEventsBridge;
  }
}

export {};
