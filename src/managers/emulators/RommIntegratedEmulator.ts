import { Emulator, EmulatorConfig, SaveChoiceResult } from "./Emulator";
import { SaveManager } from "../SaveManager";
import { RommApi } from "../../api/RommApi";

export class RommIntegratedEmulator extends Emulator {
  public static getExtensions(): string[] {
    return [];
  }

  public static getPlatforms(): string[] {
    return [
      "3do",
      "acpc",
      "amiga",
      "amiga-cd32",
      "arcade",
      "neogeoaes",
      "neogeomvs",
      "atari2600",
      "atari-2600-plus",
      "atari5200",
      "atari7800",
      "c-plus-4",
      "c64",
      "cpet",
      "commodore-64c",
      "c128",
      "commmodore-128",
      "colecovision",
      "doom",
      "dos",
      "jaguar",
      "lynx",
      "atari-lynx-mkii",
      "neo-geo-pocket",
      "neo-geo-pocket-color",
      "nes",
      "famicom",
      "fds",
      "game-televisison",
      "new-style-nes",
      "n64",
      "ique-player",
      "nds",
      "nintendo-ds-lite",
      "nintendo-dsi",
      "nintendo-dsi-xl",
      "gb",
      "game-boy-pocket",
      "game-boy-light",
      "gba",
      "game-boy-adavance-sp",
      "game-boy-micro",
      "gbc",
      "pc-fx",
      "psx",
      "philips-cd-i",
      "segacd",
      "sega32",
      "gamegear",
      "sms",
      "sega-mark-iii",
      "sega-game-box-9",
      "sega-master-system-ii",
      "master-system-super-compact",
      "master-system-girl",
      "genesis",
      "sega-mega-drive-2-slash-genesis",
      "sega-mega-jet",
      "mega-pc",
      "tera-drive",
      "sega-nomad",
      "saturn",
      "snes",
      "sfam",
      "super-nintendo-original-european-version",
      "super-famicom-shvc-001",
      "super-famicom-jr-model-shvc-101",
      "new-style-super-nes-model-sns-101",
      "tg16",
      "vic-20",
      "virtualboy",
      "wonderswan",
      "swancrystal",
      "wonderswan-color",
      "zsx",
    ];
  }

  public static getRommSlug(): string {
    return "romm-integrated";
  }

  public static getDefaultArgs(): string[] {
    return ["{rom}"];
  }

  public static getSupportsSaves(): boolean {
    return false; // L'émulateur intégré ne gère pas les saves localement
  }

  /**
   * Check if emulator is configured - always true for integrated emulator
   */
  public isConfigured(): boolean {
    return true;
  }

  /**
   * Launch ROM using the integrated Romm emulator (EmulatorJS)
   * This will send a message to the frontend to open the ROM in EmulatorJS
   */
  public async launch(romPath: string, saveDir: string): Promise<any> {
    // Instead of spawning a process, we send a message to the frontend
    // to open the ROM in the integrated emulator
    console.log(`[RommIntegratedEmulator] Launching ROM: ${romPath}`);

    // This would need to be implemented in the main process to communicate with the frontend
    // For now, we'll return a placeholder response
    return {
      success: true,
      message: "ROM launched in integrated emulator",
      integrated: true,
      romPath: romPath,
    };
  }

  /**
   * Handle save choice selection - for integrated emulator, just open the URL
   */
  public async handleSaveChoice(romData: any, saveChoice: string, saveManager: SaveManager, rommAPI: RommApi | null, saveId?: number): Promise<SaveChoiceResult> {
    // For integrated emulator, we don't need to handle saves like external emulators
    // Just return success - the actual URL opening is handled in IPCManager
    return {
      success: true,
      message: "Integrated emulator ready to launch",
    };
  }

  /**
   * Configure emulator in config mode - not needed for integrated emulator
   */
  public async startInConfigMode(configFolder: string): Promise<{ success: boolean; error?: string; pid?: number }> {
    return {
      success: true,
    };
  }
}
