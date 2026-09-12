import { app, dialog } from "electron";
import { RommClient } from "./RomMClient";
import { migrateAppStorage } from "./utils/MigrateAppStorage";

let rommClient: RommClient;

async function initApp() {
  try {
    const conflicts = await migrateAppStorage();
    if (conflicts.length > 0) {
      dialog.showMessageBoxSync({
        type: "warning",
        title: "Storage migration",
        message: "Some old files were kept in their original location because the new location already contains data.",
        detail: `The client will use the new location. You can recover the old data manually from:\n${conflicts.join("\n")}`,
      });
    }
  } catch (error: any) {
    dialog.showErrorBox("Storage migration failed", `The client could not migrate its existing data. Resolve the error and restart to retry.\n\n${error.message}`);
    app.quit();
    return;
  }

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
