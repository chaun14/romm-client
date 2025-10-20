import axios, { AxiosInstance } from "axios";
import fs, { readFileSync, existsSync } from "fs";
import type { ApiResponse, DownloadProgress, RomOptions, HeartbeatResponse, User, ConfigResponse, Platform, StatsResponse, Rom, RomDetails, RomsResponse, LocalRom } from "../types/RommApi";
const FormData = require("form-data");

export class RommApi {
  private baseUrl: string = "";
  public sessionToken: string | null = null;
  private csrfToken: string | null = null;
  private client: AxiosInstance | null = null;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.initClient();
  }

  private initClient(): void {
    const headers: Record<string, string> = {};

    if (this.sessionToken) headers["Cookie"] = this.sessionToken;
    if (this.csrfToken) headers["X-CSRFToken"] = this.csrfToken;

    this.client = axios.create({
      baseURL: this.baseUrl,
      withCredentials: true,
      headers,
    });
  }

  private parseCookiesFromHeaders(setCookieHeaders: string[]): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!setCookieHeaders) return cookies;

    for (const cookieStr of setCookieHeaders) {
      const [name, value] = cookieStr.split(";")[0].split("=");
      if (name && value) cookies[name.trim()] = value.trim();
    }
    return cookies;
  }

  private async handleApiError(error: any): Promise<{ success: false; error: string }> {
    console.error(`[ROMM API] API Error details:`, {
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
    };
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, "");
    this.initClient();
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
      const auth = Buffer.from(`${username}:${password}`).toString("base64");

      // Login request
      const loginResponse = await axios.post(`${this.baseUrl}/api/login`, null, {
        withCredentials: true,
        headers: { Authorization: `Basic ${auth}` },
      });

      // Get main page for additional cookies
      const pageResponse = await axios.get(this.baseUrl, {
        withCredentials: true,
        headers: { Authorization: `Basic ${auth}` },
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
      this.csrfToken = cookies["romm_csrftoken"] || cookies["csrftoken"];

      this.initClient();
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
      // Reconstruct the full cookie from the token
      this.sessionToken = `romm_session=${sessionToken}`;
      if (csrfToken) {
        this.csrfToken = csrfToken;
      }

      // Re-initialize client with session
      this.initClient();

      // Test if session is still valid by making an authenticated request
      // Use /api/me to get current user info (standard endpoint for session validation)
      const response = await this.client!.get("/api/users/me");

      if (response.status === 200 && response.data) {
        console.log("Session login successful - session is still valid.");
        return { success: true, data: true };
      } else {
        throw new Error("Session validation failed" + response.status);
      }
    } catch (error: any) {
      console.log("Session login failed - session expired or invalid." + error.message);
      this.clearAuth();
      return this.handleApiError(error);
    }
  }

  public isUserAuthenticated(): boolean {
    return this.isAuthenticated && this.sessionToken !== null;
  }

  clearAuth(): void {
    this.sessionToken = null;
    this.csrfToken = null;

    this.initClient();
  }

  async testConnection(): Promise<ApiResponse<HeartbeatResponse>> {
    try {
      // Try to get CSRF token from main page
      try {
        const response = await this.client!.get("");
        const htmlContent = response.data;

        // Extract CSRF from HTML
        const csrfMatch =
          htmlContent.match(/name="csrf_token"\s+value="([^"]+)"/) || htmlContent.match(/csrf_token["\s]*:\s*["']([^"']+)["']/) || htmlContent.match(/window\.csrf_token\s*=\s*["']([^"']+)["']/);

        if (csrfMatch?.[1]) {
          this.csrfToken = csrfMatch[1];
          this.initClient();
        }

        // Extract CSRF from cookies as fallback
        const cookies = this.parseCookiesFromHeaders(response.headers["set-cookie"] || []);
        const csrfFromCookie = cookies["romm_csrftoken"] || cookies["csrftoken"];
        if (csrfFromCookie && !this.csrfToken) {
          this.csrfToken = csrfFromCookie;
          this.initClient();
        }
      } catch (error) {
        // CSRF token not critical for heartbeat
      }

      const response = await this.client!.get("/api/heartbeat");
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);

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
        await this.client!.post("/api/logout");
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
      const response = await this.client![method](endpoint, options);
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

  async fetchRoms(options: RomOptions & { search?: string; platform_id?: number } = {}): Promise<ApiResponse<RomsResponse>> {
    const params = {
      limit: options.limit || 15,
      offset: options.offset || 0,
      order_by: options.orderBy || "id",
      order_dir: options.orderDir || "desc",
      with_char_index: false,
      ...options,
    };
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

  async searchRoms(query: string, options: RomOptions = {}): Promise<ApiResponse<RomsResponse>> {
    return this.fetchRoms({ search: query, ...options });
  }

  async getRomsByPlatform(platformId: number, options: RomOptions = {}): Promise<ApiResponse<RomsResponse>> {
    return this.fetchRoms({
      platform_id: platformId,
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
      if (rom.has_simple_single_file) {
        toDownload.set(rom.id, { endpoint: `/api/roms/${rom.id}/content/${encodeURIComponent(rom.fs_name)}`, dest_path: path + "/" + rom.fs_name, rom });
        totalToDownload += rom.fs_size_bytes;
      }
      if (rom.has_multiple_files) {
        for (let file of rom.files) {
          toDownload.set(file.id, { endpoint: `/api/roms/${rom.id}/content/${encodeURIComponent(rom.fs_name)}?file_ids=${file.id}`, dest_path: path + "/" + file.file_name, rom });
          totalToDownload += file.file_size_bytes;
        }
      }

      console.log(
        `Downloading ROM: ${rom.id}, File: ${rom.fs_name}, url: ${Array.from(toDownload.values())
          .map((item) => item.endpoint)
          .join(", ")}`
      );

      let fileCount = 0;
      let totalFiles = toDownload.size;
      for (let [id, { endpoint, dest_path, rom }] of toDownload) {
        fileCount++;
        const response = await this.client!.get(endpoint, {
          responseType: "arraybuffer",
          onDownloadProgress: (progressEvent) => {
            if (onProgress && progressEvent.total) {
              const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              const downloadedMB = (progressEvent.loaded / 1024 / 1024).toFixed(2);
              const totalMB = (progressEvent.total / 1024 / 1024).toFixed(2);
              onProgress({
                percent,
                downloaded: downloadedMB,
                total: totalMB,
                loaded: progressEvent.loaded,
                totalBytes: progressEvent.total,
                totalFilesNumber: totalFiles,
                currentFileNumber: fileCount,
              });
            }
          },
        });

        if (response.status == 200) {
          await fs.promises.writeFile(dest_path, Buffer.from(response.data));
          console.log(`Downloaded ROM file ID: ${id} to ${dest_path}`);
        }
      }

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
        const heartbeatResponse = await this.client!.get("/api/heartbeat");
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

      const response = await this.client!.post(`/api/saves`, formData, {
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
      });

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
      const response = await this.client!.get(downloadPath, { responseType: "arraybuffer" });
      console.log(`[ROMM API] Save file download completed:`, {
        status: response.status,
        contentLength: response.data ? response.data.length : "unknown",
        contentType: response.headers["content-type"],
      });

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
}
