import { spawn, ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";

import { Rom } from "../../types/RommApi";
import { RommApi } from "../../api/RommApi";
import { SaveManager } from "../SaveManager";

export interface EmulatorConfig {
  path?: string;
  platform: string;
  name: string;
  extensions: string[];
  args: string[];
}

export interface EnvironmentSetupResult {
  success: boolean;
  error?: string;
  [key: string]: any;
}

export interface LaunchResult {
  success: boolean;
  process?: ChildProcess;
  message?: string;
  error?: string;
  pid?: number;
  romPath?: string;
  saveDir?: string;
}

export interface SaveComparisonResult {
  success: boolean;
  data?: {
    hasLocal: boolean;
    hasCloud: boolean;
    localSave: any;
    cloudSaves: any[];
    recommendation: string;
  };
  error?: string;
}

export interface SaveSyncResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface SaveChoiceResult {
  success: boolean;
  message?: string;
  error?: string;
  pid?: number;
  romPath?: string;
  saveDir?: string;
}

/**
 * Base class for all emulators
 * Defines the common interface and functionality
 */
export abstract class Emulator {
  protected config: EmulatorConfig;
  protected platform: string;
  protected name: string;
  protected extensions: string[];
  protected defaultArgs: string[];

  constructor(config: EmulatorConfig) {
    this.config = config;
    this.platform = config.platform;
    this.name = config.name;
    this.extensions = config.extensions || [];
    this.defaultArgs = config.args || ["{rom}"];
  }

  /**
   * Get supported file extensions for this emulator
   */
  public static getExtensions(): string[] {
    // Default implementation - should be overridden by subclasses
    return [];
  }

  /**
   * Get supported platforms for this emulator
   */
  public static getPlatforms(): string[] {
    // Default implementation - should be overridden by subclasses
    return [];
  }

  /**
   * Get the RomM slug for this emulator
   */
  public static getRommSlug(): string {
    // Default implementation - should be overridden by subclasses
    return "";
  }

  /**
   * Get default arguments for this emulator
   */
  public static getDefaultArgs(): string[] {
    // Default implementation - should be overridden by subclasses
    return ["{rom}"];
  }

  /**
   * Check if this emulator supports saves
   */
  public static getSupportsSaves(): boolean {
    // Default implementation - should be overridden by subclasses
    return false;
  }

  /**
   * Get the emulator executable path
   */
  public getExecutablePath(): string | undefined {
    return this.config.path;
  }

  /**
   * Set the emulator executable path
   */
  public setExecutablePath(path: string): void {
    this.config.path = path;
  }

  /**
   * Check if emulator is configured
   */
  public isConfigured(): boolean {
    return !!(this.config.path && fsSync.existsSync(this.config.path));
  }

  /**
   * Prepare emulator arguments by replacing placeholders
   */
  public prepareArgs(romPath: string, saveDir: string): string[] {
    return this.defaultArgs.map((arg) => arg.replace("{rom}", romPath).replace("{save}", saveDir));
  }

  /**
   * Setup emulator environment before launch
   * Override in subclasses for platform-specific setup
   */
  public async setupEnvironment(rom: Rom, saveDir: string, rommAPI: RommApi | null, saveManager: SaveManager, configFolder: string): Promise<EnvironmentSetupResult> {
    // Default implementation - no special setup needed
    return { success: true };
  }

  /**
   * Handle save synchronization after emulator closes
   * Override in subclasses for platform-specific save handling
   */
  public async handleSaveSync(rom: Rom, saveDir: string, rommAPI: RommApi | null, saveManager: SaveManager): Promise<SaveSyncResult> {
    // Default implementation - no save sync needed
    return { success: true };
  }

  /**
   * Launch the emulator
   */
  public async launch(romPath: string, saveDir: string): Promise<LaunchResult> {
    const emulatorPath = this.getExecutablePath();

    if (!emulatorPath) {
      return {
        success: false,
        error: `Emulator path not configured for ${this.name}`,
      };
    }

    // Prepare arguments
    const args = this.prepareArgs(romPath, saveDir);

    console.log(`Launching ${this.name}: ${emulatorPath} ${args.join(" ")}`);

    // Launch emulator
    const emulatorProcess = spawn(emulatorPath, args, {
      detached: false,
      stdio: "ignore",
    });

    return {
      success: true,
      process: emulatorProcess,
      message: "ROM launched",
      pid: emulatorProcess.pid,
    };
  }

  /**
   * Get save comparison info for user choice
   * Override in subclasses that support save choice
   */
  public async getSaveComparison(rom: Rom, saveDir: string, rommAPI: RommApi | null, saveManager: SaveManager): Promise<SaveComparisonResult> {
    return {
      success: true,
      data: {
        hasLocal: false,
        hasCloud: false,
        localSave: null,
        cloudSaves: [],
        recommendation: "none",
      },
    };
  }

  /**
   * Handle save choice selection
   * Override in subclasses that support save choice
   */
  public async handleSaveChoice(romData: any, saveChoice: string, saveManager: SaveManager, rommAPI: RommApi | null, saveId?: number): Promise<SaveChoiceResult> {
    // Default implementation - just launch normally
    return this.launch(romData.rom, romData.saveDir);
  }

  /**
   * Configure emulator in config mode (without ROM)
   * Override in subclasses that support configuration mode
   */
  public async configureEmulatorInConfigMode(): Promise<{ success: boolean; error?: string; pid?: number }> {
    const emulatorPath = this.getExecutablePath();

    if (!emulatorPath) {
      return {
        success: false,
        error: `Emulator path not configured for ${this.name}`,
      };
    }

    console.log(`Launching ${this.name} in configuration mode: ${emulatorPath}`);

    // Launch emulator without ROM for configuration
    const emulatorProcess = spawn(emulatorPath, [], {
      detached: false,
      stdio: "ignore",
    });

    return {
      success: true,
      pid: emulatorProcess.pid,
    };
  }

  /**
   * Start emulator in configuration mode with proper environment setup
   * Each emulator can override this to setup their specific config environment
   */
  public async startInConfigMode(configFolder: string): Promise<{ success: boolean; error?: string; pid?: number }> {
    // Default implementation - just call configureEmulatorInConfigMode
    return this.configureEmulatorInConfigMode();
  }
}
