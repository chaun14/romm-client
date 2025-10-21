import { BrowserWindow } from "electron";
import fs from "fs";
import path from "path";

import { RommApi } from "./api/RommApi";
import { AppSettings, AppSettingsManager } from "./managers/AppSettingsManager";
import { IPCManager } from "./managers/IPCManager";
import { EmulatorManager } from "./managers/EmulatorManager";
import { SaveManager } from "./managers/SaveManager";
import { RomManager } from "./managers/RomManager";

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

    console.log("Initializing RommClient");

    this.appSettingsManager = new AppSettingsManager();

    this.emulatorManager = new EmulatorManager(this);

    this.ipcManager = new IPCManager(this, this.emulatorManager);
    this.ipcManager.init();

    this.saveManager = new SaveManager(this, this.emulatorManager);

    this.rommApi = null;

    this.romManager = new RomManager(this);

    this.settings = this.appSettingsManager.getSettings();

    this.initWindow();
  }

  public async initWindow() {
    await this.appSettingsManager.loadSettings();
    this.settings = this.appSettingsManager.getSettings();

    this.setupFolders();

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

    // load loading page, but remove the ability to go back
    this.loadFile(path.join(__dirname, "renderer/loading.html"));

    // Show window when ready
    this.once("ready-to-show", async () => {
      this.show();

      // Initialize RomM API if baseUrl is configured
      console.log("Initializing RomM API with baseUrl:", this.settings.baseUrl);
      let isAuthenticated = false;

      if (this.settings.baseUrl) {
        this.rommApi = new RommApi(this.settings.baseUrl);

        // check if the api is up and working
        console.log("Checking RomM API connection heartbeat...");
        let heartbeat = await this.rommApi.testConnection();

        if (!heartbeat || !heartbeat.success) {
          console.error("RomM API is not responding");

          await this.webContents.send("init-status", { step: "url", status: "error", message: "RomM is not responding" });
          await this.sleep(1000);

          return this.loadFile(path.join(__dirname, "renderer/login.html"));
        } else {
          console.log("RomM API is responding and running version " + heartbeat.data?.SYSTEM.VERSION);
          this.webContents.send("init-status", { step: "url", status: "success", message: "RomM version " + heartbeat.data?.SYSTEM.VERSION + " found" });
        }
        await this.sleep(1000);

        // if the hearbeat returns that oidc is enabled, we will skip user/pass login
        if (this.settings.username && this.settings.password && !heartbeat.data?.OIDC.ENABLED) {
          console.log("Logging in with saved credentials");
          let res = await this.rommApi.loginWithCredentials(this.settings.username, this.settings.password);
          isAuthenticated = res.success;
        } else if (this.settings.sessionToken) {
          console.log("Logging in with saved session");
          let res = await this.rommApi.loginWithSession(this.settings.sessionToken);
          isAuthenticated = res.success;
        }
      }

      if (isAuthenticated) {
        this.webContents.send("init-status", { step: "auth", status: "success", message: "Logged in successfully" });

        console.log("User is authenticated");

        await this.sleep(1000);

        // fetch all the roms from remote
        if (this.romManager) {
          // loading hundreds of thousands of roms might take a while
          // so we're gonna cache them only if there is a reasonable amount
          if (!this.rommApi) return;
          let stats = await this.rommApi.fetchStats();

          let remoteRomCount = stats.success ? stats.data!.ROMS : 0;

          if (remoteRomCount < 1000) {
            let romCount = await this.romManager.loadRemoteRoms();
            console.log(`Fetched ${romCount} ROMs from remote`);

            this.webContents.send("init-status", { step: "cache", status: "success", message: `Fetched ${romCount} ROMs successfully` });
          } else {
            this.webContents.send("init-status", { step: "cache", status: "warning", message: `Too many roms for caching: (${remoteRomCount})` });
          }

          await this.sleep(1000);

          let localRomCount = await this.romManager.loadLocalRoms();
          console.log(`Fetched ${localRomCount} local ROMs successfully`);

          this.webContents.send("init-status", { step: "roms", status: "success", message: `Fetched ${localRomCount} local ROMs successfully` });
        } else {
          this.webContents.send("init-status", { step: "cache", status: "error", message: "Failed to fetch ROMs" });
          this.webContents.send("init-status", { step: "roms", status: "error", message: "Failed to fetch ROMs" });
        }

        await this.sleep(1000);
        // User is authenticated, proceed to main app
        this.loadFile(path.join(__dirname, "renderer/index.html"));
      } else {
        this.webContents.send("init-status", { step: "auth", status: "error", message: "Login failed" });
        await this.sleep(1000);

        // User not authenticated, show login page
        this.loadFile(path.join(__dirname, "renderer/login.html"));

        // Setup login completion handler
        this.setupLoginHandler();
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
    // Create cache directory for ROMs (use emulator name for better organization)
    let romPath = process.env.APPDATA || process.env.HOME || __dirname;
    const romDir = path.join(romPath, "romm-client", "roms");
    // check if directory exists
    if (!fs.existsSync(romDir)) {
      await fs.mkdirSync(romDir, { recursive: true });
    }
    this.romsFolder = romDir;

    // same for the saves folder
    const savesDir = path.join(romPath, "romm-client", "saves");
    if (!fs.existsSync(savesDir)) {
      await fs.mkdirSync(savesDir, { recursive: true });
    }
    this.savesFolder = savesDir;

    // same for the emulator configs folder
    const emulatorConfigsDir = path.join(romPath, "romm-client", "emulatorsConfig");
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
}
