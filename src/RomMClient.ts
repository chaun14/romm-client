import { app, BrowserWindow } from "electron";
import fs from "fs";
import path from "path";

import { RommApi } from "./api/RommApi";
import { AppSettings, AppSettingsManager } from "./managers/AppSettingsManager";
import { IPCManager } from "./managers/IPCManager";
import { EmulatorManager } from "./managers/EmulatorManager";
import { SaveManager } from "./managers/SaveManager";
import { RomManager } from "./managers/RomManager";
import { autoUpdater } from "electron-updater";
import { UpdateInfo, ProgressInfo } from "electron-updater";

export class RommClient extends BrowserWindow {
  public settings: AppSettings;
  public appSettingsManager: AppSettingsManager = new AppSettingsManager();
  public rommApi: RommApi | null;
  private ipcManager: IPCManager | null = null;
  private emulatorManager: EmulatorManager | null = null;
  public saveManager: SaveManager | null = null;
  public romManager: RomManager | null = null;
  private romsFolder: string | null = null;
  private savesFolder: string | null = null;
  private emulatorConfigsFolder: string | null = null;

  constructor(options?: Electron.BrowserWindowConstructorOptions) {
    // Default options for the main window
    const defaultOptions: Electron.BrowserWindowConstructorOptions = {
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "preload.js"),
      },
      icon: path.join(__dirname, "./renderer/assets/imgs/icon.png"),
      show: false, // Don't show until ready
      ...options,
    };

    super(defaultOptions);

    console.log("Initializing RommClient version " + app.getVersion());

    this.setMenu(null);
    this.setMenuBarVisibility(false);

    this.appSettingsManager = new AppSettingsManager();

    this.emulatorManager = new EmulatorManager(this);

    this.ipcManager = new IPCManager(this, this.emulatorManager);
    this.ipcManager.init();

    this.saveManager = new SaveManager(this, this.emulatorManager);

    this.rommApi = null;

    this.romManager = new RomManager(this);

    this.settings = this.appSettingsManager.getSettings();

    this.initAutoUpdater();

    this.initWindow();
  }

  public async initWindow() {
    await this.appSettingsManager.loadSettings();
    this.settings = this.appSettingsManager.getSettings();

    this.setupFolders();

    // Prevent browser navigation (including back button) from navigating away from the app
    this.webContents.on("will-navigate", (event, url) => {
      // Only allow navigation within the app's local files
      if (!url.startsWith("file://")) {
        event.preventDefault();
        console.log("Blocked navigation attempt to:", url);
      }
    });

    // Disable mouse back/forward buttons
    this.webContents.on("dom-ready", () => {
      this.disableMouseNavigation();
    });

    // Recover any lost saves from previous sessions
    if (this.saveManager) {
      console.log("Checking for lost saves from previous sessions...");
      const recoveryResult = await this.saveManager.recoverLostSaves();
      if (recoveryResult.success) {
        if (recoveryResult.recoveredCount > 0) {
          console.log(`Recovered ${recoveryResult.recoveredCount} lost save sessions`);
        } else {
          console.log("No lost saves found");
        }
      } else {
        console.warn(`Lost save recovery failed: ${recoveryResult.error}`);
      }
    }

    this.loadFile(path.join(__dirname, "renderer/index.html"));

    // Show window when ready
    this.once("ready-to-show", async () => {
      this.show();

      await this.authenticateSavedSession();

      if (!process.argv.includes("--dev")) {
        setTimeout(() => {
          console.log("Checking for updates now...");
          autoUpdater.checkForUpdates();
        }, 1000);
      }

      // Open DevTools in development mode
      if (process.argv.includes("--dev")) {
        this.webContents.openDevTools();
      }
    });

    // Handle window closed
    this.on("closed", () => {
      // Cleanup if needed
    });
  }

  private initAutoUpdater() {
    // Auto-updater configuration
    autoUpdater.autoDownload = false; // Don't auto-download, wait for user confirmation
    autoUpdater.autoInstallOnAppQuit = true;

    // Auto-updater events
    autoUpdater.on("update-available", (info: UpdateInfo) => {
      console.log("[AUTO-UPDATER] Update available:", info.version);
      this.webContents.send("update-available", {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });
    });

    autoUpdater.on("update-not-available", (info: UpdateInfo) => {
      console.log("[AUTO-UPDATER] No updates available");
    });

    autoUpdater.on("download-progress", (progressObj: ProgressInfo) => {
      this.webContents.send("update-download-progress", {
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
      });
    });

    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      console.log("[AUTO-UPDATER] Update downloaded:", info.version);
      this.webContents.send("update-downloaded", {
        version: info.version,
      });
    });

    autoUpdater.on("error", (error: Error) => {
      console.error("[AUTO-UPDATER] Update error:", error.message);
      this.webContents.send("update-error", {
        message: error.message,
      });
    });
  }

  private async authenticateSavedSession(): Promise<boolean> {
    if (!this.settings.baseUrl || !this.settings.sessionToken) {
      return false;
    }

    try {
      this.rommApi = new RommApi(this.settings.baseUrl);
      console.log("Logging in with saved session");
      const result = await this.rommApi.loginWithSession(this.settings.sessionToken, this.settings.csrfToken || undefined);

      if (!result.success) {
        this.appSettingsManager.setSetting("sessionToken", null);
        this.appSettingsManager.setSetting("csrfToken", null);
        this.settings = this.appSettingsManager.getSettings();
        return false;
      }

      await this.initializeAuthenticatedData();
      return true;
    } catch (error: any) {
      console.warn("Saved session authentication failed:", error.message);
      return false;
    }
  }

  public async initializeAuthenticatedData(): Promise<void> {
    if (!this.rommApi || !this.romManager) return;

    const stats = await this.rommApi.fetchStats();
    const remoteRomCount = stats.success ? stats.data!.ROMS : 0;

    if (remoteRomCount < 1000) {
      const romCount = await this.romManager.loadRemoteRoms();
      console.log(`Fetched ${romCount} ROMs from remote`);
    } else {
      this.romManager.noCacheMode = true;
      console.log(`Too many ROMs for caching: ${remoteRomCount}`);
    }

    const localRomCount = await this.romManager.loadLocalRoms();
    console.log(`Fetched ${localRomCount} local ROMs successfully`);
  }

  public setRommApi(rommApi: RommApi) {
    this.rommApi = rommApi;
  }

  private setupLoginHandler() {
    // Listen for login completion from renderer
    this.webContents.on("ipc-message", (event, channel) => {
      if (channel === "login-complete") {
        console.log("Login completed, switching to loading screen...");

        this.initWindow();
      }
    });
  }

  public createRommWebWindow(romId = null) {
    // Get the base URL from RomM API
    const baseUrl = this.settings.baseUrl;
    if (!baseUrl) {
      return { success: false, error: "RomM URL not configured" };
    }

    // Create URL for specific ROM or main page
    const url = romId ? `${baseUrl}/rom/${romId}` : baseUrl;

    // Create new window
    const rommWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: "persist:romm-session", // Use persistent session for cookies
      },
      icon: path.join(__dirname, "../assets/icon.png"),
      title: "RomM Web Interface",
    });

    // Inject cookies before loading the page
    rommWindow.webContents.once("dom-ready", async () => {
      try {
        // Get session cookies from RomM API
        const sessionCookies = this.rommApi?.sessionToken + ";";
        if (sessionCookies) {
          // Parse and inject cookies
          const cookieStrings = sessionCookies.split("; ");
          for (const cookieStr of cookieStrings) {
            const [nameValue] = cookieStr.split(";");
            const [name, value] = nameValue.split("=");

            if (name && value) {
              // Get domain from base URL
              const urlObj = new URL(baseUrl);
              const domain = urlObj.hostname;

              await rommWindow.webContents.session.cookies.set({
                url: baseUrl,
                name: name,
                value: value,
                domain: domain,
                path: "/",
                httpOnly: false,
                secure: urlObj.protocol === "https:",
              });
            }
          }
          console.log("RomM session cookies injected successfully");
        }

        // Refresh the page to apply cookies
        rommWindow.webContents.reload();
      } catch (error) {
        console.error("Failed to inject cookies:", error);
      }
    });

    // cancel going back to previous page
    this.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });

    // Load the RomM page
    rommWindow.loadURL(url);

    // Open DevTools in development mode
    if (process.argv.includes("--dev")) {
      rommWindow.webContents.openDevTools();
    }

    return { success: true };
  }

  async setupFolders() {
    // for better multi instance management, we use separate folders per instance by adding a suffix based on the domain from the baseUrl
    let instanceSuffix = "";
    if (this.settings.baseUrl) {
      try {
        const urlObj = new URL(this.settings.baseUrl);
        instanceSuffix = `_${urlObj.hostname}`;
      } catch {
        instanceSuffix = "";
      }
    }

    // Create cache directory for ROMs (use emulator name for better organization)
    let romPath = process.env.APPDATA || process.env.HOME || __dirname;
    const romDir = path.join(romPath, "romm-client", "roms" + instanceSuffix);
    // check if directory exists
    if (!fs.existsSync(romDir)) {
      await fs.mkdirSync(romDir, { recursive: true });
    }
    this.romsFolder = romDir;

    // same for the saves folder
    const savesDir = path.join(romPath, "romm-client", "saves" + instanceSuffix);
    if (!fs.existsSync(savesDir)) {
      await fs.mkdirSync(savesDir, { recursive: true });
    }
    this.savesFolder = savesDir;

    // same for the emulator configs folder
    const emulatorConfigsDir = path.join(romPath, "romm-client", "emulatorsConfig" + instanceSuffix);
    if (!fs.existsSync(emulatorConfigsDir)) {
      await fs.mkdirSync(emulatorConfigsDir, { recursive: true });
    }
    this.emulatorConfigsFolder = emulatorConfigsDir;
  }

  getRomFolder() {
    return this.romsFolder;
  }

  getSavesFolder() {
    return this.savesFolder;
  }

  getEmulatorConfigsFolder() {
    return this.emulatorConfigsFolder;
  }

  public async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private disableMouseNavigation(): void {
    const disableNavigationScript = `
      document.addEventListener('mouseup', (event) => {
        if (event.button === 3 || event.button === 4) {
          event.preventDefault();
          event.stopPropagation();
        }
      });
    `;
    this.webContents.executeJavaScript(disableNavigationScript);
  }
}
