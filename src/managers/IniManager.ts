import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import ini from "ini";

/**
 * IniManager - Handles INI file operations for emulators
 * Provides clean API for loading, modifying, and saving INI configurations
 */
export class IniManager {
  /**
   * Load an INI file and parse it into a JavaScript object
   */
  public static async loadIni(filePath: string): Promise<Record<string, any>> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return ini.parse(content);
    } catch (error: any) {
      console.warn(`[IniManager] Failed to load INI file: ${filePath}`, error.message);
      return {};
    }
  }

  /**
   * Save a JavaScript object to an INI file
   */
  public static async saveIni(filePath: string, config: Record<string, any>): Promise<void> {
    try {
      const content = ini.stringify(config);
      await fs.writeFile(filePath, content, "utf-8");
      console.log(`[IniManager] Saved INI file: ${filePath}`);
    } catch (error: any) {
      console.error(`[IniManager] Failed to save INI file: ${filePath}`, error.message);
      throw error;
    }
  }

  /**
   * Load an INI template and substitute values
   * Useful for creating session-specific configs from templates
   */
  public static async loadTemplateAndSubstitute(templatePath: string, substitutions: Record<string, string>): Promise<Record<string, any>> {
    try {
      const config = await this.loadIni(templatePath);

      // Perform substitutions in all sections and values
      for (const sectionKey in config) {
        if (typeof config[sectionKey] === "object" && config[sectionKey] !== null) {
          for (const key in config[sectionKey]) {
            const value = config[sectionKey][key];
            if (typeof value === "string") {
              // Replace all substitution patterns
              let newValue = value;
              for (const [placeholder, replacement] of Object.entries(substitutions)) {
                const regex = new RegExp(placeholder, "g");
                newValue = newValue.replace(regex, replacement);
              }
              config[sectionKey][key] = newValue;
            }
          }
        }
      }

      return config;
    } catch (error: any) {
      console.error(`[IniManager] Failed to load template: ${templatePath}`, error.message);
      throw error;
    }
  }

  /**
   * Get a specific value from an INI config
   */
  public static getConfigValue(config: Record<string, any>, section: string, key: string, defaultValue?: any): any {
    try {
      if (config[section] && config[section][key] !== undefined) {
        return config[section][key];
      }
      return defaultValue;
    } catch (error) {
      return defaultValue;
    }
  }

  /**
   * Set a specific value in an INI config
   */
  public static setConfigValue(config: Record<string, any>, section: string, key: string, value: any): void {
    if (!config[section]) {
      config[section] = {};
    }
    config[section][key] = value;
  }

  /**
   * Read template file as raw string (for when you need the exact original format)
   * Useful for templates that need precise formatting
   */
  public static async readTemplateAsString(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (error: any) {
      console.warn(`[IniManager] Failed to read template: ${filePath}`, error.message);
      return "";
    }
  }

  /**
   * Read template, substitute specific values with regex, and save
   * Useful when you need to preserve exact INI formatting while changing specific values
   */
  public static async readTemplateSubstituteAndSave(templatePath: string, outputPath: string, substitutions: Array<{ pattern: RegExp | string; replacement: string }>): Promise<void> {
    try {
      let content = await this.readTemplateAsString(templatePath);

      // Apply substitutions in order
      for (const { pattern, replacement } of substitutions) {
        const regex = typeof pattern === "string" ? new RegExp(pattern, "g") : pattern;
        content = content.replace(regex, replacement);
      }

      await fs.writeFile(outputPath, content, "utf-8");
      console.log(`[IniManager] Created INI file with substitutions: ${outputPath}`);
    } catch (error: any) {
      console.error(`[IniManager] Failed to process template: ${error.message}`);
      throw error;
    }
  }
}
