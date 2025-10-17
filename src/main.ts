import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "path";
import { autoUpdater } from "electron-updater";
import RommAPI from "./api/romm-api";
import EmulatorManager from "./managers/emulator-manager";
import SaveManager from "./managers/save-manager";

let mainWindow;
let rommAPI;
let emulatorManager;
let saveManager;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "./assets/imgs/icon.png"),
  });

  mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));

  // Open DevTools in development mode
  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createRommWebWindow(romId = null) {
  // Get the base URL from RomM API
  const baseUrl = rommAPI.getBaseUrl();
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
      const sessionCookies = rommAPI.sessionCookie;
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

      // Also inject basic auth if available
      if (rommAPI.username && rommAPI.password) {
        const auth = Buffer.from(`${rommAPI.username}:${rommAPI.password}`).toString("base64");
        // Inject basic auth via JavaScript
        await rommWindow.webContents.executeJavaScript(`
                    // Override XMLHttpRequest to include basic auth
                    (function() {
                        const originalOpen = XMLHttpRequest.prototype.open;
                        XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
                            originalOpen.call(this, method, url, async, user, password);
                            if (url.startsWith('${baseUrl}')) {
                                this.setRequestHeader('Authorization', 'Basic ${auth}');
                            }
                        };
                    })();
                `);
        console.log("Basic auth injected for RomM requests");
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

app.whenReady().then(() => {
  // Initialize managers
  rommAPI = new RommAPI();
  emulatorManager = new EmulatorManager();
  saveManager = new SaveManager();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
