import fs, { readFileSync, existsSync } from "fs";
import pathModule from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import type { ApiResponse, DownloadProgress, RomOptions, HeartbeatResponse, User, ConfigResponse, Platform, StatsResponse, Rom, RomDetails, RomsResponse, LocalRom } from "../types/RommApi";
import { getApiAvailabilityEffect } from "../utils/ApiAvailability";
const FormData = require("form-data");

const API_REQUEST_TIMEOUT_MS = 10_000;

type HttpClient = {
  get: (url: string, options?: any) => Promise<any>;
  post: (url: string, data?: any, options?: any) => Promise<any>;
};

type AxiosModule = {
  default: {
    create: (options: any) => HttpClient;
    get: HttpClient["get"];
    post: HttpClient["post"];
  };
};

export class RommApi {
  private baseUrl: string = "";
  public sessionToken: string | null = null;
  private csrfToken: string | null = null;
  private client: HttpClient | null = null;
  private available = false;
  private axiosPromise: Promise<AxiosModule["default"]> = import("axios").then((module) => (module as AxiosModule).default);

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    void this.initClient();
  }

  private async getAxios(): Promise<AxiosModule["default"]> {
    return this.axiosPromise;
  }

  private async getClient(): Promise<HttpClient> {
    if (!this.client) {
      await this.initClient();
    }
    return this.client!;
  }

  private async initClient(): Promise<void> {
    const headers: Record<string, string> = {};
    const axios = await this.getAxios();

    if (this.sessionToken) headers["Cookie"] = this.sessionToken;
    if (this.csrfToken) headers["X-CSRFToken"] = this.csrfToken;

    this.client = axios.create({
      baseURL: this.baseUrl,
      withCredentials: true,
      headers,
      timeout: API_REQUEST_TIMEOUT_MS,
    });
  }

  private parseCookiesFromHeaders(setCookieHeaders: string[]): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!setCookieHeaders) return cookies;

    for (const cookieStr of setCookieHeaders) {
      const cookie = cookieStr.split(";", 1)[0];
      const separatorIndex = cookie.indexOf("=");
      if (separatorIndex <= 0) continue;
      const name = cookie.slice(0, separatorIndex).trim();
      const value = cookie.slice(separatorIndex + 1).trim();
      if (name && value) cookies[name] = value;
    }
    return cookies;
  }

  private async handleApiError(error: any): Promise<{ success: false; error: string; status?: number; code?: string }> {
    const status = error.response?.status;
    const availabilityEffect = getApiAvailabilityEffect(error);
    if (availabilityEffect === "available") this.available = true;
    else if (availabilityEffect === "unavailable") this.available = false;
    const errorKind = availabilityEffect === "unchanged" ? "Operation Error" : "API Error";
    console.error(`[ROMM API] ${errorKind} details:`, {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      headers: error.response?.headers,
      url: error.config?.url,
      method: error.config?.method,
      hasSessionToken: !!this.sessionToken,
      hasCsrfToken: !!this.csrfToken,
    });

    return {
      success: false,
      error: error.response?.data?.detail || error.response?.data?.message || error.message,
      status: typeof error.response?.status === "number" ? error.response.status : undefined,
      code: typeof error.code === "string" ? error.code : undefined,
    };
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, "");
    this.client = null;
    this.available = false;
    void this.initClient();
  }

  get isAvailable(): boolean {
    return this.available;
  }

  get isAuthenticated(): boolean {
    return !!this.sessionToken;
  }

  get sessionTokenValue(): string | null {
    // Extract token value from cookie string (format: "romm_session=tokenvalue")
    if (this.sessionToken) {
      const match = this.sessionToken.match(/romm_session=([^;]+)/);
      return match ? match[1] : null;
    }
    return null;
  }

  get csrfTokenValue(): string | null {
    return this.csrfToken;
  }

  public async loginWithCredentials(username: string, password: string): Promise<ApiResponse<Boolean | string>> {
    try {
      const axios = await this.getAxios();
      const auth = Buffer.from(`${username}:${password}`).toString("base64");

      // Login request
      const loginResponse = await axios.post(`${this.baseUrl}/api/login`, null, {
        withCredentials: true,
        headers: { Authorization: `Basic ${auth}` },
        timeout: API_REQUEST_TIMEOUT_MS,
      });

      // Get main page for additional cookies
      const pageResponse = await axios.get(this.baseUrl, {
        withCredentials: true,
        headers: { Authorization: `Basic ${auth}` },
        timeout: API_REQUEST_TIMEOUT_MS,
      });

      // Parse all cookies
      const cookies = {
        ...this.parseCookiesFromHeaders(loginResponse.headers["set-cookie"] || []),
        ...this.parseCookiesFromHeaders(pageResponse.headers["set-cookie"] || []),
      };

      // Extract tokens
      if (cookies["romm_session"]) {
        this.sessionToken = `romm_session=${cookies["romm_session"]}`;
        console.log("Login successful, session token obtained.");
      }
      if (!this.sessionToken) throw new Error("Login response did not include a RomM session cookie");
      this.csrfToken = cookies["romm_csrftoken"] || cookies["csrftoken"];

      await this.initClient();
      this.available = true;
      return { success: true, data: username };
    } catch (error: any) {
      this.clearAuth();
      return this.handleApiError(error);
    }
  }

  /**
   * Login using saved session token
   * Verifies that the session is still valid
   */
  public async loginWithSession(sessionToken: string, csrfToken?: string): Promise<ApiResponse<boolean>> {
    try {
      console.log("Attempting session login with token");
      // Reconstruct the full cookie from the token
      this.sessionToken = `romm_session=${sessionToken}`;
      if (csrfToken) {
        this.csrfToken = csrfToken;
      }

      // Re-initialize client with session
      await this.initClient();

      // Test if session is still valid by making an authenticated request
      // Use /api/me to get current user info (standard endpoint for session validation)
      const client = await this.getClient();
      const response = await client.get("/api/users/me");

      if (response.status === 200 && response.data) {
        console.log("Session login successful - session is still valid.");
        this.available = true;
        return { success: true, data: true };
      } else {
        throw new Error("Session validation failed" + response.status);
      }
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        console.log(`Session login rejected by RomM (${status}); clearing the in-memory session.`);
        this.clearAuth();
      } else {
        console.warn(`Session validation could not reach RomM; preserving the session: ${error.message}`);
      }
      return this.handleApiError(error);
    }
  }

  setOAuthToken(token: string): void {
    // For OAuth, the token is actually the session token
    this.sessionToken = `romm_session=${token}`;
    this.client = null;
    this.available = false;
    void this.initClient();
  }

  async testAuthentication(): Promise<ApiResponse<boolean>> {
    try {
      // Test authentication by making an authenticated request
      const client = await this.getClient();
      const response = await client.get("/api/users/me");

      if (response.status === 200 && response.data) {
        console.log("OAuth authentication successful - session is valid.");
        this.available = true;
        return { success: true, data: true };
      } else {
        throw new Error("Authentication test failed");
      }
    } catch (error: any) {
      console.log("OAuth authentication failed - token invalid or expired.");
      const status = error.response?.status;
      if (status === 401 || status === 403) this.clearAuth();
      return this.handleApiError(error);
    }
  }

  public isUserAuthenticated(): boolean {
    return this.isAuthenticated && this.sessionToken !== null;
  }

  clearAuth(): void {
    this.sessionToken = null;
    this.csrfToken = null;
    this.available = false;

    this.client = null;
    void this.initClient();
  }

  async testConnection(): Promise<ApiResponse<HeartbeatResponse>> {
    try {
      let client = await this.getClient();
      // Try to get CSRF token from main page
      try {
        const response = await client.get("");
        const htmlContent = response.data;

        // Extract CSRF from HTML
        const csrfMatch =
          htmlContent.match(/name="csrf_token"\s+value="([^"]+)"/) || htmlContent.match(/csrf_token["\s]*:\s*["']([^"']+)["']/) || htmlContent.match(/window\.csrf_token\s*=\s*["']([^"']+)["']/);

        if (csrfMatch?.[1]) {
          this.csrfToken = csrfMatch[1];
          await this.initClient();
          client = await this.getClient();
        }

        // Extract CSRF from cookies as fallback
        const cookies = this.parseCookiesFromHeaders(response.headers["set-cookie"] || []);
        const csrfFromCookie = cookies["romm_csrftoken"] || cookies["csrftoken"];
        if (csrfFromCookie && !this.csrfToken) {
          this.csrfToken = csrfFromCookie;
          await this.initClient();
          client = await this.getClient();
        }
      } catch (error) {
        // CSRF token not critical for heartbeat
      }

      const response = await client.get("/api/heartbeat");
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      this.available = true;

      // Handle different response formats
      const data = response.data;
      if (data?.data) return { success: true, data: data.data };
      if (data && !data.success && Object.keys(data).length > 1) {
        const { success, ...heartbeatData } = data;
        return { success: true, data: heartbeatData };
      }
      return data?.success ? { success: true, data } : { success: false, data };
    } catch (error: any) {
      return this.handleApiError(error);
    }
  }

  async logout(): Promise<ApiResponse> {
    try {
      if (this.sessionToken) {
        const client = await this.getClient();
        await client.post("/api/logout");
      }
      this.clearAuth();
      return { success: true };
    } catch (error: any) {
      this.clearAuth();
      return this.handleApiError(error);
    }
  }

  private async apiCall<T>(method: "get" | "post", endpoint: string, options: any = {}): Promise<ApiResponse<T>> {
    console.log(`API Call: ${method.toUpperCase()} ${endpoint}`, JSON.stringify(options));
    try {
      const client = await this.getClient();
      const response = await client[method](endpoint, options);
      this.available = true;
      return { success: true, data: response.data };
    } catch (error: any) {
      return this.handleApiError(error);
    }
  }

  async getCurrentUser(): Promise<ApiResponse<User>> {
    return this.apiCall("get", "/api/users/me");
  }

  async getConfig(): Promise<ApiResponse<ConfigResponse>> {
    return this.apiCall("get", "/api/config");
  }

  async fetchPlatforms(): Promise<ApiResponse<Platform[]>> {
    return this.apiCall("get", "/api/platforms");
  }

  async fetchStats(): Promise<ApiResponse<StatsResponse>> {
    return this.apiCall("get", "/api/stats");
  }

  async getRomDetails(romId: number): Promise<ApiResponse<RomDetails>> {
    return this.apiCall("get", `/api/roms/${romId}`);
  }

  async fetchRoms(options: RomOptions & { search?: string; platform_id?: number; platform_ids?: number | string } = {}): Promise<ApiResponse<RomsResponse>> {
    const params: any = {
      limit: options.limit || 15,
      offset: options.offset || 0,
      order_by: options.orderBy || "id",
      order_dir: options.orderDir || "desc",
      with_char_index: false,
    };

    // Handle search parameter - RomM expects 'search_term' not 'search'
    if (options.search) {
      params.search_term = options.search;
    }

    // Add other options
    if (options.platform_ids !== undefined) params.platform_ids = options.platform_ids;
    else if (options.platform_id !== undefined) params.platform_ids = options.platform_id;
    if (options.groupByMetaId !== undefined) params.group_by_meta_id = options.groupByMetaId;

    return this.apiCall("get", "/api/roms", { params });
  }

  async fetchAllRoms(options: RomOptions = {}): Promise<ApiResponse<Rom[]>> {
    const allRoms: Rom[] = [];
    let offset = 0;
    const limit = options.limit || 100;

    while (true) {
      const response = await this.fetchRoms({ ...options, limit, offset });
      if (!response.success) break;

      if (!response.data) break;

      allRoms.push(...response.data.items.filter((rom) => rom.missing_from_fs == false));
      if (response.data.items.length < limit) break;

      offset += limit;
    }

    return { success: true, data: allRoms };
  }

  fetchRomById(romId: number): Promise<ApiResponse<RomDetails>> {
    return this.apiCall("get", `/api/roms/${romId}`);
  }

  async searchRoms(query: string, options: RomOptions = {}): Promise<ApiResponse<RomsResponse>> {
    return this.fetchRoms({ search: query, ...options });
  }

  async getRomsByPlatform(platformId: number, options: RomOptions = {}): Promise<ApiResponse<RomsResponse>> {
    return this.fetchRoms({
      platform_ids: platformId,
      limit: options.limit || 72,
      orderBy: options.orderBy || "name",
      orderDir: options.orderDir || "asc",
      groupByMetaId: options.groupByMetaId ?? true,
      ...options,
    });
  }

  async downloadRom(rom: Rom | LocalRom, path: string, onProgress?: (progress: DownloadProgress) => void): Promise<ApiResponse<Buffer>> {
    try {
      let totalToDownload = 0;
      const toDownload: Map<number, { endpoint: string; dest_path: string; rom: Rom | LocalRom }> = new Map();
      await fs.promises.mkdir(path, { recursive: true });

      const romFiles = Array.isArray(rom.files) ? rom.files : [];
      if (rom.has_simple_single_file) {
        const singleFile = romFiles[0];
        const fileName = singleFile?.file_name || rom.fs_name;
        toDownload.set(singleFile?.id || rom.id, { endpoint: `/api/roms/${rom.id}/content/${encodeURIComponent(rom.fs_name)}`, dest_path: this.resolveDownloadDestination(path, fileName), rom });
        totalToDownload += singleFile?.file_size_bytes || rom.fs_size_bytes || 0;
      } else if (rom.has_multiple_files || rom.has_nested_single_file || romFiles.length > 0) {
        for (let file of romFiles) {
          toDownload.set(file.id, { endpoint: `/api/roms/${rom.id}/content/${encodeURIComponent(rom.fs_name)}?file_ids=${file.id}`, dest_path: this.resolveDownloadDestination(path, file.file_name), rom });
          totalToDownload += file.file_size_bytes;
        }
      }

      console.log(
        `Downloading ROM: ${rom.id}, File: ${rom.fs_name}, url: ${Array.from(toDownload.values())
          .map((item) => item.endpoint)
            .join(", ")}`
        );

        if (toDownload.size === 0) {
          throw new Error(`No downloadable files found for ROM ${rom.id} (${rom.name || rom.fs_name})`);
        }

        let fileCount = 0;
        let completedBytes = 0;
        const totalFiles = toDownload.size;
        for (let [id, { endpoint, dest_path, rom }] of toDownload) {
          fileCount++;
          const client = await this.getClient();
          const response = await client.get(endpoint, {
            responseType: "stream",
            timeout: 0,
          });

          if (response.status !== 200) {
            response.data?.destroy?.();
            throw new Error(`Failed to download ROM file ${id}: HTTP ${response.status}`);
          }

          await fs.promises.mkdir(pathModule.dirname(dest_path), { recursive: true });
          const partialPath = `${dest_path}.part`;
          let currentFileBytes = 0;
          let lastProgressAt = 0;
          const expectedFileBytes = Number(response.headers?.["content-length"]) || 0;

          const reportProgress = (force = false) => {
            if (onProgress) {
              const now = Date.now();
              if (!force && now - lastProgressAt < 100) return;
              lastProgressAt = now;
              const downloadedBytes = completedBytes + currentFileBytes;
              const expectedTotalBytes = totalToDownload || completedBytes + expectedFileBytes;
              const percent = expectedTotalBytes > 0 ? Math.min(100, Math.round((downloadedBytes * 100) / expectedTotalBytes)) : 0;
              onProgress({
                percent,
                downloaded: (downloadedBytes / 1024 / 1024).toFixed(2),
                total: expectedTotalBytes > 0 ? (expectedTotalBytes / 1024 / 1024).toFixed(2) : "0.00",
                loaded: downloadedBytes,
                totalBytes: expectedTotalBytes,
                totalFilesNumber: totalFiles,
                currentFileNumber: fileCount,
              });
            }
          };

          const progressStream = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              currentFileBytes += chunk.length;
              reportProgress();
              callback(null, chunk);
            },
          });

          try {
            await fs.promises.rm(partialPath, { force: true });
            await pipeline(response.data, progressStream, fs.createWriteStream(partialPath));

            const stats = await fs.promises.stat(partialPath);
            if (!stats.isFile() || stats.size === 0) {
              throw new Error(`Downloaded ROM file ${id} is empty or missing: ${partialPath}`);
            }
            if (expectedFileBytes > 0 && stats.size !== expectedFileBytes) {
              throw new Error(`Downloaded ROM file ${id} is incomplete: expected ${expectedFileBytes} bytes, received ${stats.size}`);
            }

            reportProgress(true);
            await fs.promises.rm(dest_path, { force: true });
            await fs.promises.rename(partialPath, dest_path);
            completedBytes += stats.size;
          } catch (error) {
            response.data?.destroy?.();
            await fs.promises.rm(partialPath, { force: true });
            throw error;
          }

          const stats = await fs.promises.stat(dest_path);
          if (!stats.isFile() || stats.size === 0) {
            throw new Error(`Downloaded ROM file ${id} is empty or missing: ${dest_path}`);
          }
          console.log(`Downloaded ROM file ID: ${id} to ${dest_path}`);
        }
  
        this.available = true;
        return { success: true };
    } catch (error: any) {
      return this.handleApiError(error);
    }
  }

  async downloadSave(romId: number): Promise<ApiResponse> {
    console.log(`[ROMM API] Downloading save list for ROM ID: ${romId}`);
    try {
      const result = this.apiCall("get", "/api/saves", { params: { rom_id: romId } });
      console.log(`[ROMM API] Save list download initiated for ROM ${romId}`);
      const response = await result;
      /*
      console.log(`[ROMM API] Save list response for ROM ${romId}:`, {
        success: response.success,
        hasData: !!response.data,
        dataType: response.data ? typeof response.data : "null",
        dataLength: Array.isArray(response.data) ? response.data.length : "N/A",
        error: response.error,
      });*/
      return response;
    } catch (error: any) {
      console.error(`[ROMM API] Error downloading save list for ROM ${romId}:`, error.message);
      return this.handleApiError(error);
    }
  }

  async uploadSave(romId: number, savePath: string, emulator?: string): Promise<ApiResponse> {
    try {
      if (!existsSync(savePath)) throw new Error(`Save file not found: ${savePath}`);

      // Refresh CSRF token if needed
      try {
        const client = await this.getClient();
        const heartbeatResponse = await client.get("/api/heartbeat");
        const cookies = this.parseCookiesFromHeaders(heartbeatResponse.headers["set-cookie"] || []);
        const freshToken = cookies["romm_csrftoken"] || cookies["csrftoken"];
        if (freshToken) {
          this.csrfToken = freshToken;
        }
      } catch {}

      const formData = new FormData();
      const fileBuffer = readFileSync(savePath);
      const fileName = savePath.split(/[/\\]/).pop() || "save.zip";

      if (this.csrfToken) formData.append("csrf_token", this.csrfToken);
      formData.append("saveFile", fileBuffer, { filename: fileName, contentType: "application/x-zip-compressed" });
      if (emulator) formData.append("emulator", emulator);

      const client = await this.getClient();
      const response = await client.post(`/api/saves`, formData, {
        params: { rom_id: romId },
        headers: {
          ...formData.getHeaders(),
          ...(this.csrfToken && {
            "X-CSRFToken": this.csrfToken,
            Cookie: `${this.sessionToken}; romm_csrftoken=${this.csrfToken}`,
          }),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 0,
      });

      this.available = true;
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error(`[ROMM API] Upload save failed: ${error.message}`);
      return this.handleApiError(error);
    }
  }

  async downloadSaveFile(saveOrPath: string | any): Promise<ApiResponse<Buffer>> {
    try {
      const downloadPath = typeof saveOrPath === "string" ? saveOrPath : saveOrPath.download_path;
      console.log(`[ROMM API] Downloading save file:`, {
        inputType: typeof saveOrPath,
        downloadPath,
        hasDownloadPath: !!downloadPath,
        saveId: typeof saveOrPath === "object" ? saveOrPath.id : "N/A",
        fileName: typeof saveOrPath === "object" ? saveOrPath.file_name : "N/A",
      });

      if (!downloadPath) {
        console.error(`[ROMM API] No download_path provided for save file download`);
        throw new Error("No download_path provided");
      }

      console.log(`[ROMM API] Starting download from: ${downloadPath}`);
      const client = await this.getClient();
      const response = await client.get(downloadPath, { responseType: "arraybuffer", timeout: 0 });
      console.log(`[ROMM API] Save file download completed:`, {
        status: response.status,
        contentLength: response.data ? response.data.length : "unknown",
        contentType: response.headers["content-type"],
      });

      this.available = true;
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error(`[ROMM API] Error downloading save file:`, error.message);
      return this.handleApiError(error);
    }
  }

  getPlatformImageUrl(slug: string): string | null {
    return slug ? `${this.baseUrl}/assets/platforms/${slug}.svg` : null;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getAuthHeaders(): Record<string, string> {
    return this.sessionToken ? { Cookie: this.sessionToken } : {};
  }

  private resolveDownloadDestination(rootDirectory: string, fileName: string): string {
    const destination = pathModule.resolve(rootDirectory, fileName);
    const relative = pathModule.relative(pathModule.resolve(rootDirectory), destination);
    if (!fileName || !relative || relative.startsWith("..") || pathModule.isAbsolute(relative)) {
      throw new Error(`Unsafe ROM file path: ${fileName || "<empty>"}`);
    }
    return destination;
  }
}
