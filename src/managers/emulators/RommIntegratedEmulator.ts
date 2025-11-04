import { Emulator, EmulatorConfig, SaveChoiceResult } from "./Emulator";
import { SaveManager } from "../SaveManager";
import { RommApi } from "../../api/RommApi";

export class RommIntegratedEmulator extends Emulator {
  public static getExtensions(): string[] {
    return [".gb", ".gbc", ".gba", ".nds"];
  }

  public static getPlatforms(): string[] {
    return ["gb", "gba", "gbc", "nds"];
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