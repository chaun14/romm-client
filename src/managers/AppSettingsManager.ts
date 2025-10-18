import * as fs from "fs/promises";
import * as path from "path";

/**
 * Type for application settings
 */
export interface AppSettings {
  baseUrl: string;
  sessionToken?: string | null;
  csrfToken?: string | null;
  username?: string | null;
  password?: string | null;
}

/**
 * Application settings manager
 * Loads and saves settings from/to JSON with in-memory storage
 */
export class AppSettingsManager {
  private settings: AppSettings;
  private configPath: string;

  constructor() {
    this.settings = {
      baseUrl: "",
      sessionToken: null,
      csrfToken: null,
      username: null,
      password: null,
    };
    this.configPath = path.join(process.env.APPDATA || process.env.HOME || "", "romm-client", "config.json");
  }

  /**
   * Loads configuration from JSON file
   */
  async loadSettings(): Promise<void> {
    try {
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });

      const data = await fs.readFile(this.configPath, "utf8");
      const config = JSON.parse(data);

      // Merge with default settings
      this.settings = { ...this.settings, ...config };

      //  console.log("Loaded settings:", this.settings);
    } catch (error) {
      // Config file doesn't exist yet, use default values
      console.log("No existing config found, starting fresh");
    }
  }

  /**
   * Saves in-memory configuration to JSON file
   */
  async saveSettings(): Promise<void> {
    console.log("Saving config to:", this.configPath);
    try {
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });

      const configToSave: Partial<AppSettings> = {
        baseUrl: this.settings.baseUrl,
      };

      // Save session token if it exists
      if (this.settings.sessionToken) {
        configToSave.sessionToken = this.settings.sessionToken;
      }

      // Save CSRF token if it exists
      if (this.settings.csrfToken) {
        configToSave.csrfToken = this.settings.csrfToken;
      }

      // Save credentials only if both exist
      if (this.settings.username && this.settings.password) {
        configToSave.username = this.settings.username;
        configToSave.password = this.settings.password;
      }

      await fs.writeFile(this.configPath, JSON.stringify(configToSave, null, 2));
    } catch (error) {
      console.error("Error saving config:", error);
      throw error;
    }
  }

  /**
   * Returns in-memory settings
   */
  getSettings(): AppSettings {
    return this.settings;
  }

  /**
   * Updates in-memory settings
   */
  updateSettings(newSettings: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
  }

  /**
   * Gets a specific settings value
   */
  getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key];
  }

  /**
   * Sets a specific settings value
   */
  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.settings[key] = value;

    // trigger save
    this.saveSettings().catch((error) => {
      console.error("Error saving settings:", error);
    });
  }

  /**
   * Resets settings to default values
   */
  resetSettings(): void {
    this.settings = {
      baseUrl: "",
      sessionToken: null,
      csrfToken: null,
      username: null,
      password: null,
    };
  }
  /**
   * Checks if there are saved credentials
   * @returns True if saved credentials exist, false otherwise
   */
  hasSavedCredentials(): boolean {
    return !!(this.settings.username && this.settings.password);
  }
}
