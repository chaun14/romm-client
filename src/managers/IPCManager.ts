import { app, ipcMain, BrowserWindow } from "electron";
import { RommClient } from "../RomMClient";
import { ProgressInfo, UpdateInfo } from "electron-updater/out/types";
const { autoUpdater } = require("electron-updater");
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
        const { RommApi } = await import("../api/RommApi");
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
      if (this.rommClient.rommApi) return this.rommClient.rommApi.logout();
      else throw new Error("RomM API is not initialized");
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

    ipcMain.handle("config:start-oauth", async (event, url) => {
      // OAuth not implemented yet
      return { success: false, error: "OAuth authentication is not yet implemented" };
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

    ipcMain.handle("roms:search", async (event, query) => {
      console.log("[IPC]" + `Searching ROMs with query: ${query}`);
      if (this.rommClient.rommApi) return this.rommClient.rommApi.searchRoms(query);
      else throw new Error("RomM API is not initialized");
    });

    ipcMain.handle("roms:get-by-platform", async (event, platform) => {
      console.log("[IPC]" + `Fetching ROMs for platform: ${platform}`);
      let platformRoms;
      if (this.rommClient.romManager) platformRoms = this.rommClient.romManager.getRoms().filter((rom) => rom.platform_id === platform || rom.platform_slug === platform);
      else throw new Error("RomM API is not initialized");

      return { success: true, data: platformRoms };
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
    // Emulator Launch
    ipcMain.handle("roms:launch", async (event, { rom, emulatorPath }) => {
      console.log("[IPC]" + `Launching ROM: ${rom.name} (ID: ${rom.id})`);
      // Create progress callback to send updates to renderer
      // Use event.sender instead of getAllWindows to ensure we send to the correct window
      const onProgress = (progress: any) => {
        console.log("[IPC]" + `Launch progress for ROM: ${rom.name} (ID: ${rom.id}): ${JSON.stringify(progress)}`);
        console.log("[IPC] Sending rom:download-progress event to frontend");
        event.sender.send("rom:download-progress", progress);
      };

      // Create save upload success callback
      const onSaveUploadSuccess = (rom: any) => {
        event.sender.send("save:upload-success", { romId: rom.id, romName: rom.name });
      };

      // Create download completion callback
      const onDownloadComplete = (rom: any) => {
        event.sender.send("rom:download-complete", { romId: rom.id, romName: rom.name });
      };

      if (this.rommClient && this.rommClient.romManager) {
        // Start the launch process asynchronously
        this.rommClient.romManager.launchRom(rom, onProgress, onSaveUploadSuccess, onDownloadComplete);
        // Return immediately to not block the UI
        return { success: true };
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

    // Auto-updater configuration
    autoUpdater.autoDownload = false; // Don't auto-download, wait for user confirmation
    autoUpdater.autoInstallOnAppQuit = true;

    // Check for updates on app ready (skip in dev mode)
    app.whenReady().then(() => {
      if (!process.argv.includes("--dev")) {
        setTimeout(() => {
          autoUpdater.checkForUpdates();
        }, 3000); // Check 3 seconds after startup
      }
    });

    // Auto-updater events
    autoUpdater.on("update-available", (info: UpdateInfo) => {
      console.log("Update available:", info.version);
      if (this.rommClient) {
        this.rommClient.webContents.send("update-available", {
          version: info.version,
          releaseDate: info.releaseDate,
          releaseNotes: info.releaseNotes,
        });
      }
    });

    autoUpdater.on("update-not-available", (info: UpdateInfo) => {
      console.log("No updates available");
    });

    autoUpdater.on("download-progress", (progressObj: ProgressInfo) => {
      if (this.rommClient) {
        this.rommClient.webContents.send("update-download-progress", {
          percent: progressObj.percent,
          transferred: progressObj.transferred,
          total: progressObj.total,
        });
      }
    });

    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      console.log("Update downloaded:", info.version);
      if (this.rommClient) {
        this.rommClient.webContents.send("update-downloaded", {
          version: info.version,
        });
      }
    });

    autoUpdater.on("error", (error: Error) => {
      console.error("Update error:", error);
      if (this.rommClient) {
        this.rommClient.webContents.send("update-error", {
          message: error.message,
        });
      }
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
