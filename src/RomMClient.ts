import { BrowserWindow } from "electron";
import { RommApi } from "./api/RommApi";
import { AppSettings, AppSettingsManager } from "./managers/AppSettingsManager";
import path from "path";
import { IPCManager } from "./managers/IPCManager";

export class RommClient extends BrowserWindow {
  public settings: AppSettings;
  public appSettingsManager: AppSettingsManager = new AppSettingsManager();
  public rommApi: RommApi | null;
  private ipcManager: IPCManager | null = null;

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
      icon: path.join(__dirname, "../assets/imgs/icon.png"),
      show: false, // Don't show until ready
      ...options,
    };

    super(defaultOptions);

    console.log("Initializing RommClient");

    this.appSettingsManager = new AppSettingsManager();

    this.ipcManager = new IPCManager(this);
    this.ipcManager.init();

    this.rommApi = null;
    this.settings = this.appSettingsManager.getSettings();

    this.initWindow();
  }

  private async initWindow() {
    await this.appSettingsManager.loadSettings();
    this.settings = this.appSettingsManager.getSettings();

    // load loading page
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

        if (!heartbeat) {
          console.error("RomM API is not responding");
          return this.loadFile(path.join(__dirname, "renderer/login.html"));
        } else {
          console.log("RomM API is responding and running version " + heartbeat.data?.SYSTEM.VERSION);
          this.webContents.send("init-status", { step: "url", status: "success", message: "RomM version " + heartbeat.data?.SYSTEM.VERSION + " found" });
        }
        await this.sleep(2000);

        // we can proceed with login
        if (this.settings.username && this.settings.password) {
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

        await this.sleep(2000);

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
        const sessionCookies = "ah"; // rommAPI.sessionCookie;
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

    // Load the RomM page
    rommWindow.loadURL(url);

    // Open DevTools in development mode
    if (process.argv.includes("--dev")) {
      rommWindow.webContents.openDevTools();
    }

    return { success: true };
  }

  public async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
