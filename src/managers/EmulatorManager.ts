import fs from "fs";
import path from "path";
import { spawn } from "child_process";

import { RommClient } from "../RomMClient";
import { Emulator, DolphinEmulator, PPSSPPEmulator, EmulatorConfig } from "./emulators";

type EmulatorClass = new (config: EmulatorConfig) => Emulator;

interface EmulatorSpec {
  name: string;
  class: EmulatorClass;
  platforms: string[];
  rommSlug: string;
  defaultArgs: string[];
  extensions: string[];
  supportsSaves: boolean;
  path: string;
}

interface PublicEmulatorSpec {
  name: string;
  platforms: string[];
  rommSlug: string;
  defaultArgs: string[];
  extensions: string[];
  supportsSaves: boolean;
  path: string;
}

let EMULATORS: Record<string, EmulatorSpec> = {
  ppsspp: {
    name: "PPSSPP",
    class: PPSSPPEmulator,
    platforms: PPSSPPEmulator.getPlatforms(),
    rommSlug: PPSSPPEmulator.getRommSlug(),
    defaultArgs: PPSSPPEmulator.getDefaultArgs(),
    extensions: PPSSPPEmulator.getExtensions(),
    supportsSaves: PPSSPPEmulator.getSupportsSaves(),
    path: "",
  },
  dolphin: {
    name: "Dolphin",
    class: DolphinEmulator,
    platforms: DolphinEmulator.getPlatforms(),
    rommSlug: DolphinEmulator.getRommSlug(),
    defaultArgs: DolphinEmulator.getDefaultArgs(),
    extensions: DolphinEmulator.getExtensions(),
    supportsSaves: DolphinEmulator.getSupportsSaves(),
    path: "",
  },
};

export class EmulatorManager {
  private supportedEmulators: Record<string, EmulatorSpec> = EMULATORS;
  private rommClient: RommClient;
  private emulatorInstances: Record<string, Emulator> = {};

  constructor(rommClient: RommClient) {
    this.rommClient = rommClient;
  }

  /**
   * Return complete supported emulators info (without class references for IPC compatibility)
   */
  getSupportedEmulators(): Record<string, PublicEmulatorSpec> {
    //  console.log("EmulatorManager: getSupportedEmulators returning:", this.supportedEmulators);
    const publicEmulators: Record<string, PublicEmulatorSpec> = {};

    for (const [key, emulator] of Object.entries(this.supportedEmulators)) {
      publicEmulators[key] = {
        name: emulator.name,
        platforms: emulator.platforms,
        rommSlug: emulator.rommSlug,
        defaultArgs: emulator.defaultArgs,
        extensions: emulator.extensions,
        supportsSaves: emulator.supportsSaves,
        path: emulator.path,
      };
    }

    return publicEmulators;
  }

  getConfigurations(): Record<string, any> {
    // Return configurations with default paths from supported emulators
    const configs: Record<string, any> = {};

    for (const [key, emulator] of Object.entries(this.supportedEmulators)) {
      configs[key] = {
        name: emulator.name,
        path: emulator.path || "",
        platforms: emulator.platforms,
        defaultArgs: emulator.defaultArgs,
        extensions: emulator.extensions,
        supportsSaves: emulator.supportsSaves,
      };
    }

    // Override with saved settings if they exist
    if (this.rommClient.settings && this.rommClient.settings.emulators) {
      for (const savedEmulator of this.rommClient.settings.emulators) {
        if (configs[savedEmulator.name]) {
          configs[savedEmulator.name].path = savedEmulator.path;
        }
      }
    } else {
      console.log("EmulatorManager: no saved settings found");
    }

    return configs;
  }

  saveConfiguration(emulatorKey: string, path: string): void {
    if (!this.rommClient.settings.emulators) {
      this.rommClient.settings.emulators = [];
    }

    // Find existing emulator config or create new one
    const existingIndex = this.rommClient.settings.emulators.findIndex((e) => e.name === emulatorKey);
    if (existingIndex >= 0) {
      this.rommClient.settings.emulators[existingIndex].path = path;
    } else {
      this.rommClient.settings.emulators.push({ name: emulatorKey, path: path });
    }

    // Save to settings manager
    this.rommClient.appSettingsManager.setSetting("emulators", this.rommClient.settings.emulators);
    this.rommClient.appSettingsManager.saveSettings();

    console.log("EmulatorManager: saved configuration for", emulatorKey, "path:", path);
  }

  /**
   * Get or create an emulator instance
   */
  private getEmulatorInstance(emulatorKey: string): Emulator | null {
    if (this.emulatorInstances[emulatorKey]) {
      return this.emulatorInstances[emulatorKey];
    }

    const spec = this.supportedEmulators[emulatorKey];
    if (!spec) {
      return null;
    }

    // Get the configured path
    let emulatorPath = spec.path;
    if (this.rommClient.settings?.emulators) {
      const savedConfig = this.rommClient.settings.emulators.find(e => e.name === emulatorKey);
      if (savedConfig) {
        emulatorPath = savedConfig.path;
      }
    }

    if (!emulatorPath) {
      return null;
    }

    // Create emulator instance
    const config: EmulatorConfig = {
      path: emulatorPath,
      platform: spec.rommSlug,
      name: spec.name,
      extensions: spec.extensions,
      args: spec.defaultArgs
    };

    const emulator = new spec.class(config);
    this.emulatorInstances[emulatorKey] = emulator;
    return emulator;
  }

  /**
   * Get emulator instance for advanced operations
   */
  getEmulator(emulatorKey: string): Emulator | null {
    return this.getEmulatorInstance(emulatorKey);
  }

  /**
   * Setup emulator environment for a ROM
   */
  async setupEmulatorEnvironment(emulatorKey: string, rom: any, saveDir: string): Promise<{ success: boolean; error?: string; [key: string]: any }> {
    const emulator = this.getEmulatorInstance(emulatorKey);
    if (!emulator) {
      return { success: false, error: `Emulator ${emulatorKey} not configured` };
    }

    if (!this.rommClient.saveManager) {
      return { success: false, error: 'SaveManager not available' };
    }

    try {
      return await emulator.setupEnvironment(rom, saveDir, this.rommClient.rommApi, this.rommClient.saveManager);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get save comparison for an emulator and ROM
   */
  async getSaveComparison(emulatorKey: string, rom: any, saveDir: string): Promise<any> {
    const emulator = this.getEmulatorInstance(emulatorKey);
    if (!emulator) {
      return { success: false, error: `Emulator ${emulatorKey} not configured` };
    }

    if (!this.rommClient.saveManager) {
      return { success: false, error: 'SaveManager not available' };
    }

    try {
      return await emulator.getSaveComparison(rom, saveDir, this.rommClient.rommApi, this.rommClient.saveManager);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle save synchronization for an emulator and ROM
   */
  async handleSaveSync(emulatorKey: string, rom: any, saveDir: string): Promise<any> {
    const emulator = this.getEmulatorInstance(emulatorKey);
    if (!emulator) {
      return { success: false, error: `Emulator ${emulatorKey} not configured` };
    }

    if (!this.rommClient.saveManager) {
      return { success: false, error: 'SaveManager not available' };
    }

    try {
      return await emulator.handleSaveSync(rom, saveDir, this.rommClient.rommApi, this.rommClient.saveManager);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Configure an emulator in configuration mode (without ROM)
   */
  async configureEmulatorInConfigMode(emulatorKey: string, emulatorPath?: string): Promise<{ success: boolean; error?: string }> {
    const emulator = this.getEmulatorInstance(emulatorKey);
    if (!emulator) {
      return { success: false, error: `Emulator ${emulatorKey} not configured` };
    }

    // If a specific path is provided, temporarily override the configured path
    if (emulatorPath) {
      emulator.setExecutablePath(emulatorPath);
    }

    try {
      // Use the new emulator class method
      const result = await emulator.configureEmulatorInConfigMode();
      return {
        success: result.success,
        error: result.error
      };
    } catch (error: any) {
      console.error(`[EmulatorManager] Failed to start ${emulatorKey} in configuration mode:`, error);
      return { success: false, error: error.message };
    }
  }
}
