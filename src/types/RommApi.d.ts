export interface Config {
  baseUrl?: string;
  sessionCookie?: string;
  csrfToken?: string;
  username?: string;
  password?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  fileName?: string;
}

export interface DownloadProgress {
  percent: number;
  downloaded: string;
  total: string;
  loaded: number;
  totalBytes: number;
  totalFilesNumber: number;
  currentFileNumber: number;
}

export interface RomOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: string;
  groupByMetaId?: boolean;
}

export interface HeartbeatResponse {
  SYSTEM: {
    VERSION: string;
    SHOW_SETUP_WIZARD: boolean;
  };
  METADATA_SOURCES: {
    ANY_SOURCE_ENABLED: boolean;
    IGDB_API_ENABLED: boolean;
    SS_API_ENABLED: boolean;
    MOBY_API_ENABLED: boolean;
    STEAMGRIDDB_API_ENABLED: boolean;
    RA_API_ENABLED: boolean;
    LAUNCHBOX_API_ENABLED: boolean;
    HASHEOUS_API_ENABLED: boolean;
    PLAYMATCH_API_ENABLED: boolean;
    TGDB_API_ENABLED: boolean;
    FLASHPOINT_API_ENABLED: boolean;
    HLTB_API_ENABLED: boolean;
  };
  FILESYSTEM: {
    FS_PLATFORMS: string[];
  };
  EMULATION: {
    DISABLE_EMULATOR_JS: boolean;
    DISABLE_RUFFLE_RS: boolean;
  };
  FRONTEND: {
    UPLOAD_TIMEOUT: number;
    DISABLE_USERPASS_LOGIN: boolean;
    YOUTUBE_BASE_URL: string;
  };
  OIDC: {
    ENABLED: boolean;
    PROVIDER: string;
  };
  TASKS: {
    ENABLE_SCHEDULED_RESCAN: boolean;
    SCHEDULED_RESCAN_CRON: string;
    ENABLE_SCHEDULED_UPDATE_SWITCH_TITLEDB: boolean;
    SCHEDULED_UPDATE_SWITCH_TITLEDB_CRON: string;
    ENABLE_SCHEDULED_UPDATE_LAUNCHBOX_METADATA: boolean;
    SCHEDULED_UPDATE_LAUNCHBOX_METADATA_CRON: string;
    ENABLE_SCHEDULED_CONVERT_IMAGES_TO_WEBP: boolean;
    SCHEDULED_CONVERT_IMAGES_TO_WEBP_CRON: string;
  };
}

export interface User {
  id: number;
  username: string;
  email: string;
  enabled: boolean;
  role: string;
  oauth_scopes: string[];
  avatar_path: string;
  last_login: string;
  last_active: string;
  ra_username: string;
  ra_progression: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface ConfigResponse {
  CONFIG_FILE_MOUNTED: boolean;
  EXCLUDED_PLATFORMS: string[];
  EXCLUDED_SINGLE_EXT: string[];
  EXCLUDED_SINGLE_FILES: string[];
  EXCLUDED_MULTI_FILES: string[];
  EXCLUDED_MULTI_PARTS_EXT: string[];
  EXCLUDED_MULTI_PARTS_FILES: string[];
  PLATFORMS_BINDING: Record<string, string>;
  PLATFORMS_VERSIONS: Record<string, string>;
  EJS_DEBUG: boolean;
  EJS_CACHE_LIMIT: number | null;
  EJS_SETTINGS: Record<string, any>;
  EJS_CONTROLS: Record<string, any>;
  SCAN_METADATA_PRIORITY: string[];
  SCAN_ARTWORK_PRIORITY: string[];
  SCAN_REGION_PRIORITY: string[];
  SCAN_LANGUAGE_PRIORITY: string[];
}

export interface Platform {
  id: number;
  slug: string;
  fs_slug: string;
  rom_count: number;
  name: string;
  igdb_slug: string | null;
  moby_slug: string | null;
  hltb_slug: string | null;
  custom_name: string;
  igdb_id: number | null;
  sgdb_id: number | null;
  moby_id: number | null;
  launchbox_id: number | null;
  ss_id: number | null;
  ra_id: number | null;
  hasheous_id: number | null;
  tgdb_id: number | null;
  flashpoint_id: number | null;
  category: string;
  generation: number;
  family_name: string;
  family_slug: string;
  url: string | null;
  url_logo: string | null;
  firmware: any[];
  aspect_ratio: string;
  created_at: string;
  updated_at: string;
  fs_size_bytes: number;
  is_unidentified: boolean;
  is_identified: boolean;
  missing_from_fs: boolean;
  display_name: string;
}

export interface StatsResponse {
  PLATFORMS: number;
  ROMS: number;
  SAVES: number;
  STATES: number;
  SCREENSHOTS: number;
  TOTAL_FILESIZE_BYTES: number;
}

export interface RomMetadata {
  rom_id: number;
  genres: string[];
  franchises: string[];
  collections: string[];
  companies: string[];
  game_modes: string[];
  age_ratings: string[];
  first_release_date: number;
  average_rating: number | null;
}

export interface IgdbMetadata {
  total_rating: string;
  aggregated_rating: string | null;
  first_release_date: number;
  youtube_video_id: string | null;
  genres: string[];
  franchises: string[];
  alternative_names: string[];
  collections: string[];
  companies: string[];
  game_modes: string[];
  age_ratings: Array<{
    rating: string;
    category: string;
    rating_cover_url: string;
  }>;
  platforms: Array<{
    igdb_id: number;
    name: string;
  }>;
  expansions: any[];
  dlcs: any[];
  remasters: any[];
  remakes: any[];
  expanded_games: any[];
  ports: any[];
  similar_games: Array<{
    id: number;
    name: string;
    slug: string;
    type: string;
    cover_url: string;
  }>;
}

export interface RomFile {
  id: number;
  rom_id: number;
  file_name: string;
  file_path: string;
  file_size_bytes: number;
  full_path: string;
  created_at: string;
  updated_at: string;
  last_modified: string;
  crc_hash: string;
  md5_hash: string;
  sha1_hash: string;
  category: string | null;
}

export interface RomSibling {
  id: number;
  name: string;
  fs_name_no_tags: string;
  fs_name_no_ext: string;
  sort_comparator: string;
}

export interface RomUser {
  id: number;
  user_id: number;
  rom_id: number;
  created_at: string;
  updated_at: string;
  last_played: string | null;
  note_raw_markdown: string;
  note_is_public: boolean;
  is_main_sibling: boolean;
  backlogged: boolean;
  now_playing: boolean;
  hidden: boolean;
  rating: number;
  difficulty: number;
  completion: number;
  status: string | null;
  user__username: string;
}

export interface Rom {
  id: number;
  igdb_id: number | null;
  sgdb_id: number | null;
  moby_id: number | null;
  ss_id: number | null;
  ra_id: number | null;
  launchbox_id: number | null;
  hasheous_id: number | null;
  tgdb_id: number | null;
  flashpoint_id: number | null;
  hltb_id: number | null;
  platform_id: number;
  platform_slug: string;
  platform_fs_slug: string;
  platform_name: string;
  platform_custom_name: string;
  platform_display_name: string;
  fs_name: string;
  fs_name_no_tags: string;
  fs_name_no_ext: string;
  fs_extension: string;
  fs_path: string;
  fs_size_bytes: number;
  name: string;
  slug: string;
  summary: string;
  alternative_names: string[];
  youtube_video_id: string | null;
  metadatum: RomMetadata;
  igdb_metadata: IgdbMetadata;
  moby_metadata: Record<string, any>;
  ss_metadata: Record<string, any>;
  launchbox_metadata: Record<string, any>;
  hasheous_metadata: Record<string, any>;
  flashpoint_metadata: Record<string, any>;
  hltb_metadata: Record<string, any>;
  path_cover_small: string;
  path_cover_large: string;
  url_cover: string;
  has_manual: boolean;
  path_manual: string | null;
  url_manual: string;
  is_identifying: boolean;
  is_unidentified: boolean;
  is_identified: boolean;
  revision: string;
  regions: string[];
  languages: string[];
  tags: string[];
  crc_hash: string;
  md5_hash: string;
  sha1_hash: string;
  multi: boolean;
  has_simple_single_file: boolean;
  has_nested_single_file: boolean;
  has_multiple_files: boolean;
  files: RomFile[];
  full_path: string;
  created_at: string;
  updated_at: string;
  missing_from_fs: boolean;
  siblings: RomSibling[];
  rom_user: RomUser;
}

export interface LocalRom extends Rom {
  localPath: string;
  localFiles?: string[];
}

export interface RomUserSave {
  id: number;
  rom_id: number;
  user_id: number;
  file_name: string;
  file_name_no_tags: string;
  file_name_no_ext: string;
  file_extension: string;
  file_path: string;
  file_size_bytes: number;
  full_path: string;
  download_path: string;
  missing_from_fs: boolean;
  created_at: string;
  updated_at: string;
  emulator: string | null;
  screenshot: string | null;
}

export interface RomUserState {
  id: number;
  rom_id: number;
  user_id: number;
  file_name: string;
  file_name_no_tags: string;
  file_name_no_ext: string;
  file_extension: string;
  file_path: string;
  file_size_bytes: number;
  full_path: string;
  download_path: string;
  missing_from_fs: boolean;
  created_at: string;
  updated_at: string;
  emulator: string | null;
  screenshot: string | null;
}

export interface RomUserScreenshot {
  id: number;
  rom_id: number;
  user_id: number;
  file_name: string;
  file_path: string;
  file_size_bytes: number;
  full_path: string;
  download_path: string;
  missing_from_fs: boolean;
  created_at: string;
  updated_at: string;
}

export interface RomUserNote {
  user_id: number;
  username: string;
  note_raw_markdown: string;
}

export interface RomUserCollection {
  id: number;
  name: string;
  description: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

interface RomDetails extends Rom {
  merged_ra_metadata: Record<string, any>;
  merged_screenshots: string[];
  user_saves: RomUserSave[];
  user_states: RomUserState[];
  user_screenshots: RomUserScreenshot[];
  user_notes: RomUserNote[];
  user_collections: RomUserCollection[];
}

export interface RomsResponse {
  items: Rom[];
  total: number;
  limit: number;
  offset: number;
  char_index: Record<string, any>;
  rom_id_index: number[];
}
