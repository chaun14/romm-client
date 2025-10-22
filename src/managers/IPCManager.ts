import { app, ipcMain, BrowserWindow } from "electron";
import path from "path";
import { RommClient } from "../RomMClient";
import { autoUpdater } from "electron-updater";
import { RommApi } from "../api/RommApi";
import { EmulatorManager } from "./EmulatorManager";

export class IPCManager {
  private rommClient: RommClient;
  private emulatorManager: EmulatorManager;

  constructor(rommClient: RommClient, emulatorManager: EmulatorManager) {
    this.rommClient = rommClient;
    this.emulatorManager = emulatorManager;

    console.log("Initializing IPC early communication");

    // load config related IPC handlers
    ipcMain.handle("config:get-version", async () => {
      return { success: true, data: app.getVersion() };
    });

    // Console logging from renderer process
    ipcMain.on("console-log", (event, { level, args }) => {
      const message = `[RENDERER ${level.toUpperCase()}] ${args.join(" ")}`;

      switch (level) {
        case "error":
          console.error(message);
          break;
        case "warn":
          console.warn(message);
          break;
        case "info":
          console.info(message);
          break;
        case "debug":
          console.debug(message);
          break;
        default:
          console.log(message);
      }
    });

    // RomM API Configuration
    ipcMain.handle("config:set-romm-url", async (event, url) => {
      // Update settings using AppSettingsManager
      this.rommClient.appSettingsManager.setSetting("baseUrl", url);
      await this.rommClient.appSettingsManager.saveSettings();

      // Update RommClient's settings reference
      this.rommClient.settings = this.rommClient.appSettingsManager.getSettings();

      // Create RommApi instance if it doesn't exist
      if (!this.rommClient.rommApi) {
        const { RommApi } = await import("../api/RommApi");
        this.rommClient.rommApi = new RommApi(url);
      } else {
        // Update existing API base URL
        this.rommClient.rommApi.setBaseUrl(url);
      }

      return { success: true };
    });

    ipcMain.handle("config:set-credentials", async (event, { username, password, saveCredentials = true }) => {
      // Update settings using AppSettingsManager
      this.rommClient.appSettingsManager.setSetting("username", saveCredentials ? username : null);
      this.rommClient.appSettingsManager.setSetting("password", saveCredentials ? password : null);
      await this.rommClient.appSettingsManager.saveSettings();

      // Update RommClient's settings reference
      this.rommClient.settings = this.rommClient.appSettingsManager.getSettings();

      // Ensure RommApi exists
      if (!this.rommClient.rommApi && this.rommClient.settings.baseUrl) {
        this.rommClient.rommApi = new RommApi(this.rommClient.settings.baseUrl);
      }

      if (!this.rommClient.rommApi) {
        throw new Error("RomM API not initialized - set URL first");
      }

      // Attempt login
      const loginResult = await this.rommClient.rommApi.loginWithCredentials(username, password);

      // If login successful, save session tokens
      if (loginResult.success) {
        this.rommClient.appSettingsManager.setSetting("sessionToken", this.rommClient.rommApi.sessionTokenValue);
        this.rommClient.appSettingsManager.setSetting("csrfToken", this.rommClient.rommApi.csrfTokenValue);
        await this.rommClient.appSettingsManager.saveSettings();

        // Update RommClient's settings reference again
        this.rommClient.settings = this.rommClient.appSettingsManager.getSettings();
      }

      return loginResult;
    });

    ipcMain.handle("config:test-connection", async () => {
      // Use existing RommApi or create temporary one for testing
      let apiToTest = this.rommClient.rommApi;

      if (!apiToTest && this.rommClient.settings.baseUrl) {
        const { RommApi } = await import("../api/RommApi");
        apiToTest = new RommApi(this.rommClient.settings.baseUrl);
      }

      if (!apiToTest) {
        throw new Error("No RomM URL configured");
      }

      return apiToTest.testConnection();
    });

    ipcMain.handle("config:logout", async () => {
      // Clear authentication data from settings
      this.rommClient.appSettingsManager.setSetting("sessionToken", null);
      this.rommClient.appSettingsManager.setSetting("csrfToken", null);
      this.rommClient.appSettingsManager.setSetting("username", null);
      this.rommClient.appSettingsManager.setSetting("password", null);
      await this.rommClient.appSettingsManager.saveSettings();

      // Clear authentication in RommApi
      if (this.rommClient.rommApi) {
        this.rommClient.rommApi.clearAuth();
      }

      // Update RommClient's settings reference
      this.rommClient.settings = this.rommClient.appSettingsManager.getSettings();

      // Reset RommClient to initial state instead of just loading login page
      // This ensures proper cleanup and initialization like on app startup
      await this.rommClient.initWindow();

      return { success: true };
    });

    ipcMain.handle("config:get-current-user", async () => {
      if (this.rommClient.rommApi) return this.rommClient.rommApi.getCurrentUser();
      else throw new Error("RomM API is not initialized");
    });

    ipcMain.handle("config:get-base-url", async () => {
      return this.rommClient.settings.baseUrl || null;
    });

    ipcMain.handle("config:get-platform-image-url", async (event, slug) => {
      if (this.rommClient.rommApi) return this.rommClient.rommApi.getPlatformImageUrl(slug);
      else throw new Error("RomM API is not initialized");
    });

    ipcMain.handle("config:has-saved-credentials", async () => {
      return !!(this.rommClient.settings.username && this.rommClient.settings.password);
    });
    ipcMain.handle("config:authenticate-with-saved-credentials", async () => {
      if (!this.rommClient.rommApi) {
        return { success: false, error: "RomM API not initialized" };
      }
      return this.rommClient.rommApi.loginWithCredentials(this.rommClient.settings.username!, this.rommClient.settings.password!);
    });

    ipcMain.handle("config:has-saved-session", async () => {
      return !!this.rommClient.settings.sessionToken;
    });

    ipcMain.handle("config:authenticate-with-saved-session", async () => {
      if (!this.rommClient.rommApi) {
        return { success: false, error: "RomM API not initialized" };
      }
      return this.rommClient.rommApi.loginWithSession(this.rommClient.settings.sessionToken!, this.rommClient.settings.csrfToken || undefined);
    });

    ipcMain.handle("config:start-oauth", async (event, serverUrl) => {
      return new Promise(async (resolve) => {
        const loginUrl = `${serverUrl}/login`;
        console.log("[IPC] Starting OAuth flow with URL:", loginUrl);

        // Create OAuth window
        const oauthWindow = new BrowserWindow({
          width: 600,
          height: 700,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
          show: true,
          title: "RomM OAuth Login",
          modal: false,
          parent: this.rommClient as any, // Make it a child window
        });

        // Load the login page
        oauthWindow.loadURL(loginUrl);

        let completed = false;

        // Monitor navigation and check for session cookie
        const checkCookies = async () => {
          if (completed) return;

          try {
            // Wait a bit for cookies to be set
            await new Promise((resolve) => setTimeout(resolve, 500));

            const currentUrl = oauthWindow.webContents.getURL();
            console.log("[IPC] OAuth window navigated to:", currentUrl);
            if (currentUrl && currentUrl.startsWith(serverUrl) && !currentUrl.includes("/login")) {
              // Check if we have the session cookie
              const cookies = await oauthWindow.webContents.session.cookies.get({ name: "romm_session" });

              if (cookies && cookies.length > 0 && cookies[0].value) {
                const token = cookies[0].value;
                console.log("[IPC] OAuth session token found in cookies, processing authentication");

                completed = true;
                oauthWindow.close();

                try {
                  // Ensure RommApi exists
                  if (!this.rommClient.rommApi && this.rommClient.settings.baseUrl) {
                    this.rommClient.rommApi = new RommApi(this.rommClient.settings.baseUrl);
                  }

                  if (!this.rommClient.rommApi) {
                    resolve({ success: false, error: "RomM API not initialized - set URL first" });
                    return;
                  }

                  // Set the token in RommApi
                  this.rommClient.rommApi.setOAuthToken(token);

                  // Test authentication
                  const authResult = await this.rommClient.rommApi.testAuthentication();

                  if (authResult.success) {
                    // Save session tokens
                    this.rommClient.appSettingsManager.setSetting("sessionToken", this.rommClient.rommApi.sessionTokenValue);
                    this.rommClient.appSettingsManager.setSetting("csrfToken", this.rommClient.rommApi.csrfTokenValue);
                    await this.rommClient.appSettingsManager.saveSettings();

                    // Update RommClient's settings reference
                    this.rommClient.settings = this.rommClient.appSettingsManager.getSettings();

                    console.log("[IPC] OAuth authentication successful");
                    resolve({ success: true });
                  } else {
                    console.log("[IPC] OAuth authentication failed");
                    resolve({ success: false, error: authResult.error || "Authentication failed" });
                  }
                } catch (error: any) {
                  console.error("[IPC] OAuth processing error:", error);
                  resolve({ success: false, error: error.message || "Authentication processing failed" });
                }

                return;
              }
            }
          } catch (error) {
            // Cookie access might fail during cross-origin navigation
            // This is normal and expected
          }
        };

        // Handle navigation events to check for token
        oauthWindow.webContents.on("did-navigate", checkCookies);
        oauthWindow.webContents.on("did-navigate-in-page", checkCookies);

        // Handle window closed without completing auth
        oauthWindow.on("closed", () => {
          if (!completed) {
            completed = true;
            resolve({ success: false, error: "OAuth window was closed without completing authentication" });
          }
        });
      });
    });
  }

  public init() {
    // Initialize IPC communication

    // IPC Handlers for renderer communication

    console.log("Initializing IPC full communication");

    // ROM Management
    ipcMain.handle("roms:fetch-all", async () => {
      console.log("[IPC]" + `Fetching all ROMs`);
      if (this.rommClient.rommApi) return this.rommClient.romManager?.getRoms();
      else throw new Error("RomM API is not initialized");
    });

    ipcMain.handle("roms:fetch-local", async () => {
      console.log("[IPC]" + `Fetching local ROMs`);
      if (this.rommClient.rommApi) return this.rommClient.romManager?.getLocalRoms();
      else throw new Error("RomM API is not initialized");
    });

    ipcMain.handle("roms:search", async (event, query, platformId, limit, offset) => {
      console.log("[IPC]" + `Searching ROMs with query: ${query}, platform: ${platformId}, limit: ${limit}, offset: ${offset}`);
      if (this.rommClient.rommApi) {
        const options: any = { search: query };
        if (platformId !== null && platformId !== undefined) {
          options.platform_id = platformId;
        }
        if (limit !== null && limit !== undefined) {
          options.limit = limit;
        }
        if (offset !== null && offset !== undefined) {
          options.offset = offset;
        }
        return this.rommClient.rommApi.fetchRoms(options);
      } else {
        throw new Error("RomM API is not initialized");
      }
    });

    ipcMain.handle("roms:get-by-platform", async (event, { platform, limit, offset }) => {
      console.log("[IPC]" + `Fetching ROMs for platform: ${platform}, limit: ${limit}, offset: ${offset}`);
      if (this.rommClient.rommApi) {
        const options: any = {};
        if (limit !== null && limit !== undefined) {
          options.limit = limit;
        }
        if (offset !== null && offset !== undefined) {
          options.offset = offset;
        }
        return this.rommClient.rommApi.getRomsByPlatform(platform, options);
      } else {
        throw new Error("RomM API is not initialized");
      }
    });

    ipcMain.handle("roms:noCachedMode", async () => {
      console.log("[IPC]" + `Checking if ROM manager is in no-cache mode`);
      return this.rommClient.romManager?.noCacheMode || false;
    });

    // Emulator Configuration
    ipcMain.handle("emulator:getConfigs", async () => {
      console.log("[IPC]" + `Fetching emulator configs`);
      return { success: true, data: this.emulatorManager.getConfigurations() };
    });

    ipcMain.handle("emulator:getSupportedEmulators", async () => {
      console.log("[IPC]" + `Fetching supported emulators`);
      return { success: true, data: this.emulatorManager.getSupportedEmulators() };
    });

    /*
    // Emulator Launch
    ipcMain.handle("emulator:launch", async (event, { rom, emulatorPath }) => {
      // Create progress callback to send updates to renderer
      const onProgress = (progress) => {
        event.sender.send("rom:download-progress", progress);
      };

      // Create save upload success callback
      const onSaveUploadSuccess = (rom) => {
        event.sender.send("save:upload-success", { romId: rom.id, romName: rom.name });
      };

      return emulatorManager.launchRom(rom, emulatorPath, rommAPI, saveManager, onProgress, onSaveUploadSuccess);
    });



    ipcMain.handle("emulator:launch-with-save-choice", async (event, { romData, saveChoice, saveId }) => {
      // Create save upload success callback
      const onSaveUploadSuccess = (rom) => {
        event.sender.send("save:upload-success", { romId: rom.id, romName: rom.name });
      };

      return emulatorManager.launchRomWithSaveChoice(romData, saveChoice, saveManager, rommAPI, saveId, onSaveUploadSuccess);
    });

    ipcMain.handle("emulator:configure", async (event, { platform, emulatorPath }) => {
      return emulatorManager.configureEmulator(platform, emulatorPath);
    });

    ipcMain.handle("emulator:is-platform-supported", async (event, platform) => {
      return { success: true, data: emulatorManager.isPlatformSupported(platform) };
    });

    ipcMain.handle("emulator:get-supported-platforms", async () => {
      return { success: true, data: emulatorManager.getSupportedPlatforms() };
    });*/

    ipcMain.handle("emulator:get-configs", async () => {
      console.log("[IPC]" + `Fetching emulator configs`);
      return { success: true, data: this.emulatorManager.getConfigurations() };
    });

    ipcMain.handle("emulator:get-supported-emulators", async () => {
      console.log("[IPC]" + `Fetching supported emulators`);
      return { success: true, data: this.emulatorManager.getSupportedEmulators() };
    });

    ipcMain.handle("emulator:saveConfig", async (event, { emulatorKey, path }) => {
      console.log("[IPC]" + `Saving config for emulator: ${emulatorKey}`);
      this.emulatorManager.saveConfiguration(emulatorKey, path);
      return { success: true };
    });

    ipcMain.handle("emulator:configure-emulator", async (event, { emulatorKey, emulatorPath }) => {
      console.log("[IPC]" + `Configuring emulator: ${emulatorKey} at path: ${emulatorPath}`);
      return this.emulatorManager.configureEmulatorInConfigMode(emulatorKey, emulatorPath);
    });

    ipcMain.handle("rom:check-cache-integrity", async (event, rom) => {
      console.log("[IPC]" + `Checking cache integrity for ROM: ${rom.name} (ID: ${rom.id})`);
      // Temporary handler - cache functionality not implemented yet
      return { success: true, cached: false };
    });

    /*
    // Save Management
    ipcMain.handle("saves:download", async (event, romId) => {
      return saveManager.downloadSave(romId, rommAPI);
    });

    ipcMain.handle("saves:upload", async (event, { romId, savePath }) => {
      return saveManager.uploadSave(romId, savePath, rommAPI);
    });

    ipcMain.handle("saves:sync", async (event, romId) => {
      return saveManager.syncSave(romId, rommAPI);
    });*/

    // Platform Management
    ipcMain.handle("platforms:fetch-all", async () => {
      console.log("[IPC]" + `Fetching all platforms`);
      if (this.rommClient.rommApi) return this.rommClient.rommApi.fetchPlatforms();
      else throw new Error("RomM API is not initialized");
    });

    // Stats
    ipcMain.handle("stats:fetch", async () => {
      console.log("[IPC]" + `Fetching stats`);
      if (this.rommClient.rommApi) return this.rommClient.rommApi.fetchStats();
      else throw new Error("RomM API is not initialized");
    });
    /*
    // Cache and Save Status
    ipcMain.handle("rom:check-cache", async (event, rom) => {
      const fs = require("fs");
      const path = require("path");

      try {
        const platform = rom.platform_slug || rom.platform;
        const internalKey = emulatorManager.getInternalKey(platform);
        const cacheDir = path.join(process.env.APPDATA || process.env.HOME, "romm-client", "roms", internalKey || platform);

        const cacheBaseName = `rom_${rom.id}`;
        const cachedZipPath = path.join(cacheDir, `${cacheBaseName}.zip`);

        return {
          success: true,
          cached: fs.existsSync(cachedZipPath),
        };
      } catch (error) {
        return {
          success: false,
          cached: false,
          error: error.message,
        };
      }
    });

    // Check ROM cache with integrity verification
    ipcMain.handle("rom:check-cache-integrity", async (event, rom) => {
      try {
        return await emulatorManager.checkRomCacheIntegrity(rom);
      } catch (error: any) {
        return {
          success: false,
          cached: false,
          integrity: null,
          error: error.message,
        };
      }
    });


    // Delete cached ROM
    ipcMain.handle("rom:delete-cache", async (event, rom) => {
      const fs = require("fs");
      const path = require("path");

      try {
        const platform = rom.platform_slug || rom.platform;
        const internalKey = emulatorManager.getInternalKey(platform);
        const cacheDir = path.join(process.env.APPDATA || process.env.HOME, "romm-client", "roms", internalKey || platform);

        const cacheBaseName = `rom_${rom.id}`;
        const cachedZipPath = path.join(cacheDir, `${cacheBaseName}.zip`);
        const extractedDirPath = path.join(cacheDir, cacheBaseName);

        // Delete the ZIP file if it exists
        if (fs.existsSync(cachedZipPath)) {
          fs.unlinkSync(cachedZipPath);
        }

        // Delete the extracted directory if it exists
        if (fs.existsSync(extractedDirPath)) {
          fs.rmSync(extractedDirPath, { recursive: true, force: true });
        }

        return {
          success: true,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Get cached ROM size on disk
    ipcMain.handle("rom:get-cache-size", async (event, rom) => {
      const fs = require("fs");
      const path = require("path");

      try {
        const platform = rom.platform_slug || rom.platform;
        const internalKey = emulatorManager.getInternalKey(platform);
        const cacheDir = path.join(process.env.APPDATA || process.env.HOME, "romm-client", "roms", internalKey || platform);

        const cacheBaseName = `rom_${rom.id}`;
        const cachedZipPath = path.join(cacheDir, `${cacheBaseName}.zip`);
        const extractedDirPath = path.join(cacheDir, cacheBaseName);

        let totalSize = 0;

        // Check if ZIP file exists (this is what takes disk space for "installed" ROMs)
        if (fs.existsSync(cachedZipPath)) {
          const stats = fs.statSync(cachedZipPath);
          totalSize = stats.size;
        }

        return {
          success: true,
          size: totalSize,
        };
      } catch (error) {
        return {
          success: false,
          size: 0,
          error: error.message,
        };
      }
    });*/

    ipcMain.handle("rom:delete-cache", async (event, rom) => {
      if (this.rommClient.romManager) {
        const result = await this.rommClient.romManager.deleteLocalRom(rom.id);
        return result;
      }
      return { success: false, error: "RomManager not initialized" };
    });

    ipcMain.handle("rom:get-cache-size", async (event, rom) => {
      let romdata;
      if (this.rommClient.romManager) romdata = this.rommClient.romManager.getLocalRomById(rom.id);

      return {
        success: true,
        data: romdata?.fs_size_bytes,
      };
    });
    // Emulator Launch with complete save flow
    ipcMain.handle("roms:launch", async (event, { rom, emulatorPath }) => {
      console.log("[IPC]" + `Launching ROM with saves flow: ${rom.name} (ID: ${rom.id})`);

      // Create progress callback to send updates to renderer
      const onProgress = (progress: any) => {
        console.log("[IPC]" + `Launch progress for ROM: ${rom.name} (ID: ${rom.id}): ${JSON.stringify(progress)}`);
        console.log("[IPC] Sending rom:download-progress event to frontend");
        event.sender.send("rom:download-progress", progress);
      };

      // Create save choice callback
      const onSaveChoice = async (saveData: any) => {
        console.log("[IPC]" + `Showing save choice modal for ROM ${rom.id}`);

        // Send modal data to renderer
        event.sender.send("save:show-choice-modal", {
          rom: saveData.rom,
          hasLocal: saveData.hasLocal,
          hasCloud: saveData.hasCloud,
          cloudSaves: saveData.cloudSaves,
          localSaveDir: saveData.localSaveDir,
          localSaveDate: saveData.localSaveDate,
        });

        // Wait for user selection
        return new Promise((resolve) => {
          const handler = (_e: any, result: any) => {
            console.log("[IPC]" + `Save choice received: ${result.choice}`);
            ipcMain.removeListener("save:choice-selected", handler);
            resolve(result);
          };
          ipcMain.once("save:choice-selected", handler);

          // Timeout after 5 minutes
          setTimeout(() => {
            ipcMain.removeListener("save:choice-selected", handler);
            resolve({ choice: "local" }); // Default to local if timeout
          }, 300000);
        });
      };

      if (this.rommClient && this.rommClient.romManager && this.rommClient.saveManager && this.emulatorManager) {
        try {
          // Start the complete launch flow with save handling
          const result = await this.rommClient.romManager.launchRomWithSavesFlow(rom, this.rommClient.saveManager, this.emulatorManager, onProgress, onSaveChoice);

          if (result.success) {
            event.sender.send("rom:launched", {
              romId: rom.id,
              romName: rom.name,
              pid: result.pid,
            });
          } else {
            event.sender.send("rom:launch-failed", {
              romId: rom.id,
              romName: rom.name,
              error: result.error,
            });
          }

          return result;
        } catch (error: any) {
          console.error("[IPC]" + `Launch error: ${error.message}`);
          event.sender.send("rom:launch-failed", {
            romId: rom.id,
            romName: rom.name,
            error: error.message,
          });
          return { success: false, error: error.message };
        }
      }
      return { success: false, error: "RomManager not initialized" };
    });

    ipcMain.handle("rom:check-saves", async (event, rom) => {
      console.log("[IPC]" + `Checking saves for ROM: ${rom.name} (ID: ${rom.id})`);
      if (this.rommClient.saveManager) return this.rommClient.saveManager.checkSaves(rom);
      else return { success: false, error: "SaveManager not initialized" };
    });

    // Open RomM Web Interface
    ipcMain.handle("romm:open-web-interface", async (event, romId) => {
      return this.rommClient.createRommWebWindow(romId);
    });

    // IPC handlers for updates
    ipcMain.handle("update:check", async () => {
      try {
        const result = await autoUpdater.checkForUpdates();
        return { success: true, data: result };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("update:download", async () => {
      try {
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("update:install", () => {
      autoUpdater.quitAndInstall(false, true);
    });
  }
}
