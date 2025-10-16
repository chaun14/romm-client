const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const FormData = require('form-data');

class RommAPI {
    constructor() {
        this.baseUrl = '';
        this.sessionCookie = null;
        this.username = null;
        this.password = null;
        this.csrfToken = null;
        this.client = null;
        this.configPath = path.join(process.env.APPDATA || process.env.HOME, 'romm-client', 'config.json');
        this.loadConfig();
    }

    async loadConfig() {
        try {
            const configDir = path.dirname(this.configPath);
            await fs.mkdir(configDir, { recursive: true });
            const data = await fs.readFile(this.configPath, 'utf8');
            const config = JSON.parse(data);
            this.baseUrl = config.baseUrl || '';
            this.sessionCookie = config.sessionCookie || null;
            this.csrfToken = config.csrfToken || null;
            this.username = config.username || null;
            this.password = config.password || null;
            this.initClient();
        } catch (error) {
            // Config doesn't exist yet
            console.log('No existing config found, starting fresh');
        }
    }

    async saveConfig() {
        const config = {
            baseUrl: this.baseUrl,
            // Save sessionCookie if it exists (for session-only mode)
            ...(this.sessionCookie && { sessionCookie: this.sessionCookie }),
            // Save CSRF token if it exists
            ...(this.csrfToken && { csrfToken: this.csrfToken }),
            // Only save credentials if they exist (user consented)
            ...(this.username && this.password && {
                username: this.username,
                password: this.password
            })
        };
        await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
    }

    initClient() {
        const headers = {};

        if (this.sessionCookie) {
            headers['Cookie'] = this.sessionCookie;
        }

        // Add CSRF token if available
        if (this.csrfToken) {
            headers['X-CSRFToken'] = this.csrfToken;
        }

        // Add Basic Auth if credentials are available (only if user consented to save them)
        if (this.username && this.password) {
            const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
            headers['Authorization'] = `Basic ${auth}`;
        }

        this.client = axios.create({
            baseURL: this.baseUrl,
            withCredentials: true,
            headers: headers
        });
    }

    extractCsrfToken(cookies) {
        if (!cookies) return null;

        for (const cookie of cookies) {
            const cookieStr = cookie.split(';')[0];
            const [name, value] = cookieStr.split('=');
            if (name.trim() === 'romm_csrftoken' || name.trim() === 'csrftoken') {
                return value;
            }
        }
        return null;
    }

    async refreshCsrfToken() {
        try {
            // Try to get a fresh CSRF token from the saves endpoint or main page
            const response = await this.client.get('/api/saves', {
                params: { limit: 1 } // Just get one save to trigger CSRF token generation
            });

            // Check if we got a new CSRF token in the response
            const newToken = response.headers['x-csrftoken'] || response.headers['x-csrf-token'];
            if (newToken && newToken !== this.csrfToken) {
                this.csrfToken = newToken;
                this.initClient();
                this.saveConfig();
            }

            return true;
        } catch (error) {
            console.warn('Could not refresh CSRF token from API:', error.message);

            // Fallback: try to get token from main page
            try {
                const pageResponse = await axios.get(this.baseUrl, {
                    withCredentials: true,
                    headers: this.sessionCookie ? { 'Cookie': this.sessionCookie } : {}
                });

                const htmlContent = pageResponse.data;
                const csrfMatch = htmlContent.match(/name="csrf_token"\s+value="([^"]+)"/) ||
                    htmlContent.match(/csrf_token["\s]*:\s*["']([^"']+)["']/) ||
                    htmlContent.match(/window\.csrf_token\s*=\s*["']([^"']+)["']/);

                if (csrfMatch && csrfMatch[1] && csrfMatch[1] !== this.csrfToken) {
                    this.csrfToken = csrfMatch[1];
                    this.initClient();
                    this.saveConfig();
                }
            } catch (pageError) {
                console.warn('Could not refresh CSRF token from main page either:', pageError.message);
            }

            return false;
        }
    }

    setBaseUrl(url) {
        this.baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        this.initClient();
        this.saveConfig();
        return { success: true };
    }

    async setCredentials(username, password, saveCredentials = true) {
        try {
            // Login with HTTP Basic Auth to create session
            const auth = Buffer.from(`${username}:${password}`).toString('base64');

            const response = await axios.post(`${this.baseUrl}/api/login`, {}, {
                withCredentials: true,
                headers: {
                    'Authorization': `Basic ${auth}`
                }
            });

            // Extract session cookies
            const cookies = response.headers['set-cookie'];
            if (cookies && cookies.length > 0) {
                this.sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');

                // Extract CSRF token from cookies
                this.csrfToken = this.extractCsrfToken(cookies);
            }

            // Store credentials based on user consent
            if (saveCredentials) {
                this.username = username;
                this.password = password;
                this.sessionCookie = null; // Don't save session cookie when saving credentials
            } else {
                // Only store session info, not credentials
                this.username = null;
                this.password = null;
                // Keep the sessionCookie for session-only mode
            }
            this.initClient();
            await this.saveConfig();

            return {
                success: true,
                username: username
            };
        } catch (error) {
            console.error('Authentication failed:', error.response?.data || error.message);
            console.error('Response status:', error.response?.status);
            console.error('Response headers:', error.response?.headers);
            this.clearAuth();
            return {
                success: false,
                error: error.response?.data?.detail || error.response?.data?.message || error.message
            };
        }
    }

    clearAuth() {
        this.sessionCookie = null;
        this.username = null;
        this.password = null;
        this.csrfToken = null;
        this.initClient();
        this.saveConfig();
    }

    hasSavedCredentials() {
        return !!(this.username && this.password);
    }

    hasSavedSession() {
        return !!this.sessionCookie;
    }

    async authenticateWithSavedCredentials() {
        if (!this.username || !this.password) {
            return { success: false, error: 'No saved credentials' };
        }

        // Try to authenticate with saved credentials
        return this.setCredentials(this.username, this.password, true);
    }

    async testConnection() {
        try {
            // First try to get CSRF token from the main page
            try {
                const pageResponse = await axios.get(this.baseUrl, {
                    withCredentials: true,
                    headers: this.sessionCookie ? { 'Cookie': this.sessionCookie } : {}
                });

                // Look for CSRF token in HTML content
                const htmlContent = pageResponse.data;
                const csrfMatch = htmlContent.match(/name="csrf_token"\s+value="([^"]+)"/) ||
                    htmlContent.match(/csrf_token["\s]*:\s*["']([^"']+)["']/) ||
                    htmlContent.match(/window\.csrf_token\s*=\s*["']([^"']+)["']/);

                if (csrfMatch && csrfMatch[1]) {
                    this.csrfToken = csrfMatch[1];
                    this.initClient();
                    this.saveConfig();
                }

                // Also check for CSRF token in cookies
                if (pageResponse.headers['set-cookie']) {
                    const csrfFromCookies = this.extractCsrfToken(pageResponse.headers['set-cookie']);
                    if (csrfFromCookies && !this.csrfToken) {
                        this.csrfToken = csrfFromCookies;
                        this.initClient();
                        this.saveConfig();
                    }
                }
            } catch (pageError) {
                console.warn('Could not fetch CSRF token from main page:', pageError.message);
            }

            // Then test the API connection
            const response = await this.client.get('/api/heartbeat');

            return { success: true, data: response.data };
        } catch (error) {
            console.error('Connection test failed:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.detail || error.message
            };
        }
    }

    async getCurrentUser() {
        try {
            const response = await this.client.get('/api/users/me');
            return { success: true, data: response.data };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.detail || error.message
            };
        }
    }

    async logout() {
        try {
            console.log('Logging out...');

            // For session-only mode (no saved credentials), just clear local auth
            // since the session is temporary and will expire anyway
            if (!this.hasSavedCredentials() && this.sessionCookie) {
                console.log('Session-only mode: clearing local auth without API call');
                this.clearAuth();
                return { success: true };
            }

            // For credential mode, call logout endpoint to properly invalidate session
            if (this.sessionCookie) {
                await this.client.post('/api/logout');
            }
            this.clearAuth();
            return { success: true };
        } catch (error) {
            console.error('Logout error:', error);
            // Clear auth even if logout fails
            this.clearAuth();
            return {
                success: false,
                error: error.response?.data?.detail || error.message
            };
        }
    }

    async fetchRoms() {
        try {
            console.log('Fetching ROMs...');
            const response = await this.client.get('/api/roms');
            console.log(`Fetched ${response.data.items?.length || 0} ROMs`);
            return { success: true, data: response.data };
        } catch (error) {
            console.error('Failed to fetch ROMs:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.detail || error.message
            };
        }
    }

    async searchRoms(query) {
        try {
            const response = await this.client.get('/api/roms', {
                params: { search: query }
            });
            return { success: true, data: response.data };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.detail || error.message
            };
        }
    }

    async getRomsByPlatform(platformId, options = {}) {
        try {
            const params = {
                platform_id: platformId,
                limit: options.limit || 72,
                offset: options.offset || 0,
                order_by: options.orderBy || 'name',
                order_dir: options.orderDir || 'asc',
                group_by_meta_id: options.groupByMetaId !== undefined ? options.groupByMetaId : true
            };

            //  console.log('Fetching ROMs for platform:', platformId, 'with params:', params);
            const response = await this.client.get('/api/roms', { params });
            // console.log(`Fetched ${response.data.items?.length || 0} ROMs for platform ${platformId}`);
            return { success: true, data: response.data };
        } catch (error) {
            console.error('Failed to fetch ROMs by platform:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.detail || error.message
            };
        }
    }

    async fetchPlatforms() {
        try {
            const response = await this.client.get('/api/platforms');
            return { success: true, data: response.data };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.detail || error.message
            };
        }
    }

    async fetchStats() {
        try {
            const response = await this.client.get('/api/stats');
            return { success: true, data: response.data };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.detail || error.message
            };
        }
    }

    async downloadRom(romId, fileName = null, onProgress = null) {
        try {
            console.log(`Downloading ROM ${romId}${fileName ? ` (${fileName})` : ''}...`);

            // If fileName is provided, download specific file: /api/roms/{id}/content/{file_name}
            // Otherwise download main ROM content: /api/roms/{id}/content
            const endpoint = fileName
                ? `/api/roms/${romId}/content/${encodeURIComponent(fileName)}`
                : `/api/roms/${romId}/content`;

            const response = await this.client.get(endpoint, {
                responseType: 'arraybuffer',
                onDownloadProgress: (progressEvent) => {
                    if (onProgress && progressEvent.total) {
                        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        const downloadedMB = (progressEvent.loaded / 1024 / 1024).toFixed(2);
                        const totalMB = (progressEvent.total / 1024 / 1024).toFixed(2);
                        onProgress({
                            percent: percentCompleted,
                            downloaded: downloadedMB,
                            total: totalMB,
                            loaded: progressEvent.loaded,
                            totalBytes: progressEvent.total
                        });
                    }
                }
            });

            console.log(`ROM downloaded successfully (${(response.data.byteLength / 1024 / 1024).toFixed(2)} MB)`);
            return { success: true, data: response.data, fileName: fileName };
        } catch (error) {
            console.error('Failed to download ROM:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.detail || error.message
            };
        }
    }

    async getRomDetails(romId) {
        try {
            const response = await this.client.get(`/api/roms/${romId}`);
            return { success: true, data: response.data };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.detail || error.message
            };
        }
    }

    async downloadSave(romId) {
        try {
            //   console.log(`Fetching saves for ROM ${romId}...`);
            // RomM API uses /api/saves with rom_id parameter
            const response = await this.client.get(`/api/saves`, {
                params: { rom_id: romId },
                responseType: 'json'
            });
            // console.log(`Found ${response.data.length || 0} saves`);
            return { success: true, data: response.data };
        } catch (error) {
            console.error('Failed to fetch saves:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.detail || error.message
            };
        }
    }

    async uploadSave(romId, savePath, emulator = null) {
        try {
            console.log(`Uploading save for ROM ${romId} from ${savePath}...`);

            // Check if file exists
            if (!fsSync.existsSync(savePath)) {
                throw new Error(`Save file not found: ${savePath}`);
            }

            // Try to get a fresh CSRF token before upload
            try {
                const csrfResponse = await this.client.get('/api/heartbeat');

                // Check for CSRF token in response cookies
                if (csrfResponse.headers['set-cookie']) {
                    const freshToken = this.extractCsrfToken(csrfResponse.headers['set-cookie']);
                    if (freshToken) {
                        this.csrfToken = freshToken;
                    }
                }
            } catch (csrfError) {
                console.warn('Could not fetch fresh CSRF token:', csrfError.message);
            }

            const formData = new FormData();

            // Read the file and append it to formData
            const fileBuffer = fsSync.readFileSync(savePath);
            const fileName = path.basename(savePath);

            // Add CSRF token to form data if available
            if (this.csrfToken) {
                formData.append('csrf_token', this.csrfToken);
            }

            // Append the file with proper field name 'saveFile' (as per RomM API)
            formData.append('saveFile', fileBuffer, {
                filename: fileName,
                contentType: 'application/x-zip-compressed'
            });

            if (emulator) {
                formData.append('emulator', emulator);
            }

            // Create a new axios instance for this request to avoid CSRF header conflicts
            let cookieHeader = this.sessionCookie || '';
            if (this.csrfToken) {
                // Add CSRF token to cookies
                cookieHeader += (cookieHeader ? '; ' : '') + `romm_csrftoken=${this.csrfToken}`;
            }

            const uploadClient = axios.create({
                baseURL: this.baseUrl,
                withCredentials: true,
                headers: {
                    ...(cookieHeader && { 'Cookie': cookieHeader }),
                    ...(this.csrfToken && { 'X-CSRFToken': this.csrfToken }),
                    ...this.username && this.password && {
                        'Authorization': `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`
                    }
                }
            });

            const response = await uploadClient.post(`/api/saves`, formData, {
                params: { rom_id: romId },
                headers: {
                    ...formData.getHeaders(),
                    ...(this.csrfToken && { 'X-CSRFToken': this.csrfToken }),
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            return { success: true, data: response.data };
        } catch (error) {
            console.error('Failed to upload save:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.detail || error.message
            };
        }
    }

    async downloadSaveFile(saveOrPath) {
        try {
            // Accept either a save object with download_path, or a direct path string
            const downloadPath = typeof saveOrPath === 'string' ? saveOrPath : saveOrPath.download_path;

            if (!downloadPath) {
                throw new Error('No download_path provided for save file');
            }

            console.log(`Downloading save file from: ${downloadPath}`);

            // Download save file using the download_path from the save object
            const response = await this.client.get(downloadPath, {
                responseType: 'arraybuffer'
            });
            console.log('Save file downloaded successfully');
            return { success: true, data: response.data };
        } catch (error) {
            console.error('Failed to download save file:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.detail || error.message
            };
        }
    }

    // Get the full URL for platform assets
    getPlatformImageUrl(slug) {
        if (!this.baseUrl || !slug) return null;
        return `${this.baseUrl}/assets/platforms/${slug}.svg`;
    }

    // Get the base URL for authenticated asset requests
    getBaseUrl() {
        return this.baseUrl;
    }

    // Get authentication headers for asset requests
    getAuthHeaders() {
        const headers = {};

        if (this.sessionCookie) {
            headers['Cookie'] = this.sessionCookie;
        }

        if (this.username && this.password) {
            const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
            headers['Authorization'] = `Basic ${auth}`;
        }

        return headers;
    }
}

module.exports = RommAPI;
