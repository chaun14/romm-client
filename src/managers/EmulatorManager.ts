import { RommClient } from "../RomMClient";

type EmulatorClass = new (...args: any[]) => any;

interface EmulatorSpec {
  name: string;
  //  class: EmulatorClass;
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
    //   class: PPSSPPEmulator,
    platforms: ["psp"],
    rommSlug: "psp",
    defaultArgs: ["{rom}"],
    extensions: [".iso", ".cso", ".pbp", ".elf"],
    supportsSaves: true,
    path: "",
  },
  dolphin: {
    name: "Dolphin",
    // class: DolphinEmulator,
    platforms: ["wii", "gamecube"],
    rommSlug: "wii", // Dolphin peut gérer Wii et GameCube, mais on utilise 'wii' comme slug principal
    defaultArgs: ["-e", "{rom}"],
    extensions: [".iso", ".gcm", ".wbfs", ".ciso", ".gcz"],
    supportsSaves: true,
    path: "",
  },
};

export class EmulatorManager {
  private supportedEmulators: Record<string, EmulatorSpec> = EMULATORS;
  private rommClient: RommClient;

  constructor(rommClient: RommClient) {
    this.rommClient = rommClient;
  }

  /**
   * Return complete supported emulators info
   */
  getSupportedEmulators() {
    //  console.log("EmulatorManager: getSupportedEmulators returning:", this.supportedEmulators);
    return this.supportedEmulators;
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
   * Get internal key from RomM slug or platform
   */
  getInternalKey(platform: string) {
    // If already an internal key, return it
    if (platform in this.supportedEmulators) {
      return platform;
    }
    // Otherwise search by rommSlug
    for (const [key, emulator] of Object.entries(this.supportedEmulators)) {
      if (emulator.rommSlug === platform) {
        return key;
      }
      // Or search in supported platforms
      if (emulator.platforms.includes(platform)) {
        return key;
      }
    }
    return null;
  }
}
