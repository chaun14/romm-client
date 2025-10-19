import { RommClient } from "../RomMClient";
import { Rom } from "../types/RommApi";
import { EmulatorManager } from "./EmulatorManager";

export class SaveManager {
  rommClient: RommClient;
  emulatorManager: EmulatorManager;

  constructor(rommClient: RommClient, emulatorManager: EmulatorManager) {
    this.rommClient = rommClient;
    this.emulatorManager = emulatorManager;
  }

  async checkSaves(rom: Rom) {
    try {
      const platform = rom.platform_slug;
      const fs = require("fs");
      const path = require("path");

      // Check local saves
      const saveDir = path.join(process.env.APPDATA || process.env.HOME, "romm-client", "saves", platform, `rom_${rom.id}`);

      let hasLocal = false;
      if (fs.existsSync(saveDir)) {
        const files = fs.readdirSync(saveDir, { recursive: true });
        hasLocal = files.some((file: string) => {
          const filePath = path.join(saveDir, file);
          const stats = fs.statSync(filePath);
          return stats.isFile();
        });
      }

      // Check cloud saves
      let hasCloud = false;
      if (!this.rommClient.rommApi) throw new Error("RomM API is not initialized");
      const cloudResult = await this.rommClient.rommApi.downloadSave(rom.id);
      if (cloudResult.success && cloudResult.data && cloudResult.data.length > 0) {
        hasCloud = true;
      }

      return {
        success: true,
        hasSaves: hasLocal || hasCloud,
        hasLocal,
        hasCloud,
      };
    } catch (error: any) {
      return {
        success: false,
        hasSaves: false,
        error: error.message,
      };
    }
  }
}
