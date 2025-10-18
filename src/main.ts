import { app } from "electron";
import { RommClient } from "./RomMClient";

let rommClient: RommClient;

async function initApp() {
  // Create the main RommClient window
  rommClient = new RommClient();

  app.on("activate", () => {
    if (rommClient.isDestroyed()) {
      rommClient = new RommClient();
    }
  });
}

// Handle app ready
app.whenReady().then(initApp);

// Handle all windows closed
app.on("window-all-closed", () => {
  // On macOS, keep the app running even when all windows are closed
  if (process.platform !== "darwin") {
    app.quit();
  }
});
