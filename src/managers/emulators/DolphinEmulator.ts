import { Emulator, EmulatorConfig, EnvironmentSetupResult, SaveComparisonResult, SaveSyncResult, SaveChoiceResult } from './Emulator';
import { Rom } from '../../types/RommApi';
import { RommApi } from '../../api/RommApi';
import { SaveManager } from '../SaveManager';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

/**
 * Dolphin (Wii/GameCube) Emulator implementation
 */
export class DolphinEmulator extends Emulator {
  constructor(config: EmulatorConfig) {
    super({
      ...config,
      platform: 'wii',
      name: 'Dolphin',
      extensions: DolphinEmulator.getExtensions(),
      args: ['-u', '{userDir}', '-e', '{rom}']
    });
  }

  /**
   * Get supported file extensions for Dolphin
   */
  public static getExtensions(): string[] {
    return ['.iso', '.gcm', '.wbfs', '.ciso', '.gcz'];
  }

  /**
   * Get supported platforms for Dolphin
   */
  public static getPlatforms(): string[] {
    return ['wii', 'gamecube'];
  }

  /**
   * Get the RomM slug for Dolphin
   */
  public static getRommSlug(): string {
    return 'wii';
  }

  /**
   * Get default arguments for Dolphin
   */
  public static getDefaultArgs(): string[] {
    return ['-u', '{userDir}', '-e', '{rom}'];
  }

  /**
   * Check if Dolphin supports saves
   */
  public static getSupportsSaves(): boolean {
    return true;
  }

  /**
   * Prepare emulator arguments by replacing placeholders
   * Override to handle custom user directory
   */
  public prepareArgs(romPath: string, userDir: string): string[] {
    return this.defaultArgs.map(arg =>
      arg.replace('{rom}', romPath)
        .replace('{userDir}', userDir)
        .replace('{save}', userDir) // For compatibility
    );
  }

  /**
   * Determine if a game is Wii or GameCube based on ROM metadata
   */
  private isWiiGame(rom: Rom): boolean {
    // Wii games typically have different region codes and metadata
    // For now, we'll use a simple heuristic based on file size and platform info
    // Wii games are generally larger and have different characteristics

    // Check platform info first
    if (rom.platform_slug && rom.platform_slug.toLowerCase().includes('wii')) {
      return true;
    }
    if (rom.platform_slug && rom.platform_slug.toLowerCase().includes('gamecube')) {
      return false;
    }

    // Check file size - Wii games are typically larger than GameCube games
    // Wii games are usually 4.7GB+, GameCube games are usually 1.4GB or less
    const fileSize = rom.fs_size_bytes;
    if (fileSize && fileSize > 2000000000) { // 2GB threshold
      return true;
    }

    // Default to Wii for Dolphin (most common)
    return true;
  }

  public async setupEnvironment(
    rom: Rom,
    saveDir: string,
    rommAPI: RommApi | null,
    saveManager: SaveManager
  ): Promise<EnvironmentSetupResult> {
    try {
      // Use saveDir directly as the user directory for this ROM session
      const tempUserDir = saveDir;
      console.log(`Using ROM save directory as Dolphin user directory: ${tempUserDir}`);

      // Determine if this is a Wii or GameCube game
      const isWiiGame = this.isWiiGame(rom);
      console.log(`Game type: ${isWiiGame ? 'Wii' : 'GameCube'}`);

      if (isWiiGame) {
        // Wii games use title-based save directories
        const wiiSaveDir = path.join(tempUserDir, 'Wii');
        const titleSaveDir = path.join(wiiSaveDir, 'title', '00000001', 'data');
        await fs.mkdir(titleSaveDir, { recursive: true });

        console.log(`Wii save directory: ${titleSaveDir}`);

        return {
          success: true,
          userDir: tempUserDir,
          saveDir: wiiSaveDir,
          gameType: 'wii'
        };
      } else {
        // GameCube games use memory card saves
        const gcSaveDir = path.join(tempUserDir, 'GC');
        const memoryCardDir = path.join(gcSaveDir, 'USA'); // Assume USA region for now
        await fs.mkdir(memoryCardDir, { recursive: true });

        console.log(`GC save directory: ${memoryCardDir}`);

        return {
          success: true,
          userDir: tempUserDir,
          saveDir: gcSaveDir,
          gameType: 'gamecube'
        };
      }
    } catch (error: any) {
      console.error(`Failed to setup Dolphin environment: ${error.message}`);
      return {
        success: false,
        error: `Dolphin setup failed: ${error.message}`
      };
    }
  }

  private async copySavesToRomDir(dolphinSaveDir: string, romSaveDir: string): Promise<void> {
    try {
      // Ensure ROM save directory exists
      await fs.mkdir(romSaveDir, { recursive: true });

      // Copy all files from Dolphin save directory to ROM save directory
      const copyDirRecursive = async (src: string, dest: string): Promise<void> => {
        const entries = await fs.readdir(src, { withFileTypes: true });

        for (const entry of entries) {
          const srcPath = path.join(src, entry.name);
          const destPath = path.join(dest, entry.name);

          if (entry.isDirectory()) {
            await fs.mkdir(destPath, { recursive: true });
            await copyDirRecursive(srcPath, destPath);
          } else {
            // Only copy if source is newer or destination doesn't exist
            let shouldCopy = true;
            if (fsSync.existsSync(destPath)) {
              const srcStat = await fs.stat(srcPath);
              const destStat = await fs.stat(destPath);
              shouldCopy = srcStat.mtime > destStat.mtime;
            }

            if (shouldCopy) {
              await fs.copyFile(srcPath, destPath);
              console.log(`Copied save file: ${entry.name}`);
            }
          }
        }
      };

      await copyDirRecursive(dolphinSaveDir, romSaveDir);
      console.log(`Saves copied from ${dolphinSaveDir} to ${romSaveDir}`);
    } catch (error: any) {
      console.warn(`Failed to copy saves: ${error.message}`);
    }
  }

  public async getSaveComparison(
    rom: Rom,
    saveDir: string,
    rommAPI: RommApi | null,
    saveManager: SaveManager
  ): Promise<SaveComparisonResult> {
    try {
      // Determine if this is a Wii or GameCube game
      const isWiiGame = this.isWiiGame(rom);

      // Compare saves in the entire Wii or GC directory
      const dolphinSaveDir = isWiiGame ?
        path.join(saveDir, 'Wii') :
        path.join(saveDir, 'GC');

      console.log(`Comparing local and cloud saves for ROM ${rom.id}...`);

      if (!rommAPI) {
        throw new Error('RomM API is not available');
      }

      // Check for local saves
      let hasLocal = false;
      if (fsSync.existsSync(dolphinSaveDir)) {
        const files = await fs.readdir(dolphinSaveDir, { recursive: true });
        hasLocal = files.some((file: string) => {
          const filePath = path.join(dolphinSaveDir, file);
          const stat = fsSync.statSync(filePath);
          return stat.isFile();
        });
      }

      // Check for cloud saves
      const cloudResult = await rommAPI.downloadSave(rom.id);
      const hasCloud = cloudResult.success && cloudResult.data && Array.isArray(cloudResult.data) && cloudResult.data.length > 0;

      return {
        success: true,
        data: {
          hasLocal,
          hasCloud,
          localSave: hasLocal ? dolphinSaveDir : null,
          cloudSaves: hasCloud ? cloudResult.data : [],
          recommendation: hasLocal ? 'local' : (hasCloud ? 'cloud' : 'none')
        }
      };
    } catch (error: any) {
      console.error(`Error comparing saves for ROM ${rom.id}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  public async handleSaveSync(
    rom: Rom,
    saveDir: string,
    rommAPI: RommApi | null,
    saveManager: SaveManager
  ): Promise<SaveSyncResult> {
    try {
      // Determine if this is a Wii or GameCube game
      const isWiiGame = this.isWiiGame(rom);

      // Upload the entire Wii or GC directory
      const dolphinSaveDir = isWiiGame ?
        path.join(saveDir, 'Wii') :
        path.join(saveDir, 'GC');

      console.log(`Uploading saves from ${dolphinSaveDir} to RomM...`);

      if (!rommAPI) {
        throw new Error('RomM API is not available');
      }

      // For now, just log that we would upload saves
      // TODO: Implement proper save directory upload
      console.log(`Save upload not yet implemented for Dolphin emulator`);

      return {
        success: true,
        message: 'Save sync completed (placeholder)'
      };
    } catch (saveError: any) {
      console.error(`Error uploading saves: ${saveError.message}`);
      return {
        success: false,
        error: saveError.message
      };
    }
  }

  public async handleSaveChoice(
    romData: any,
    saveChoice: string,
    saveManager: SaveManager,
    rommAPI: RommApi | null,
    saveId?: number
  ): Promise<SaveChoiceResult> {
    try {
      const { rom, finalRomPath, saveDir, gameType, userDir } = romData;

      console.log(`User chose save: ${saveChoice}${saveId ? ` (ID: ${saveId})` : ''}`);

      // Determine Dolphin save directory (same as ROM save directory now)
      const dolphinSaveDir = gameType === 'wii' ?
        path.join(userDir, 'Wii') :
        path.join(userDir, 'GC');

      // Handle save loading based on choice
      if (saveChoice === 'cloud') {
        console.log(`Loading cloud save${saveId ? ` #${saveId}` : ''}...`);
        if (!rommAPI) {
          throw new Error('RomM API is not available');
        }
        // For now, just log that we would download saves
        // TODO: Implement proper cloud save download
        console.log(`Cloud save download not yet implemented for Dolphin emulator`);
      } else if (saveChoice === 'local') {
        console.log(`Using existing local save`);
        // Local saves should already be in the Dolphin directory
      } else if (saveChoice === 'none') {
        console.log(`Starting with no save (fresh start)`);
        // Clear the Dolphin save directory
        await this.clearSaveDirectories([dolphinSaveDir]);
      }

      // Launch emulator with custom user directory
      console.log(`Launching Dolphin: ${this.getExecutablePath()} -u "${userDir}" -e "${finalRomPath}"`);
      const args = this.prepareArgs(finalRomPath, userDir);
      const launchResult = await this.launch(finalRomPath, userDir);

      // Monitor process to upload saves when it closes
      if (launchResult.process) {
        launchResult.process.on('exit', async (code) => {
          console.log(`Dolphin closed with code ${code}`);

          // Sync saves back to ROM directory and upload to RomM
          if (rommAPI) {
            await this.handleSaveSync(rom, saveDir, rommAPI, saveManager);
          }
        });
      }

      return {
        success: true,
        message: `ROM launched: ${rom.name}`,
        pid: launchResult.process ? launchResult.process.pid : undefined,
        romPath: finalRomPath,
        saveDir: saveDir
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async clearSaveDirectories(directories: string[]): Promise<void> {
    for (const dir of directories) {
      if (fsSync.existsSync(dir)) {
        try {
          const files = await fs.readdir(dir, { recursive: true });
          for (const file of files) {
            const filePath = path.join(dir, file);
            try {
              const stat = await fs.stat(filePath);
              if (stat.isFile()) {
                await fs.unlink(filePath);
              }
            } catch (err: any) {
              console.warn(`Failed to delete ${filePath}: ${err.message}`);
            }
          }
        } catch (error: any) {
          console.warn(`Failed to clear directory ${dir}: ${error.message}`);
        }
      }
    }
  }
}