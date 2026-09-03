import { execFile, spawn } from "child_process";
import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";

import { RommApi } from "../../api/RommApi";
import { Rom } from "../../types/RommApi";
import { SaveManager } from "../SaveManager";
import {
  Emulator,
  EmulatorConfig,
  EnvironmentSetupResult,
  ProgressCallback,
  SaveChoiceResult,
  SaveComparisonResult,
  SaveSyncResult,
} from "./Emulator";

interface ConfigTransaction {
  configPath: string;
  originalSettings: Record<string, string | null>;
}

interface AzaharDirectories {
  data: string;
  config: string;
}

/**
 * Azahar (Nintendo 3DS) emulator implementation.
 *
 * Azahar has no command-line option for selecting a user directory. Instead,
 * RomM Client temporarily points Azahar's built-in custom SDMC setting at a
 * ROM-specific session directory. The user's normal SDMC is never moved or
 * overwritten, and the four changed settings are restored when Azahar exits.
 */
export class AzaharEmulator extends Emulator {
  private static readonly TRANSACTION_DIRECTORY = ".romm-client";
  private static readonly TRANSACTION_FILE = "azahar-config-transaction.json";
  private static readonly CONFIG_BACKUP_FILE = "qt-config.ini.bak";
  private activeSession = false;

  constructor(config: EmulatorConfig) {
    super({
      ...config,
      platform: "3ds",
      name: "Azahar",
      extensions: AzaharEmulator.getExtensions(),
      args: AzaharEmulator.getDefaultArgs(),
    });
  }

  /** Formats that Azahar can boot directly (CIA/ZCIA are install-only). */
  public static getExtensions(): string[] {
    return [".3ds", ".3dsx", ".app", ".axf", ".cci", ".cxi", ".elf", ".z3dsx", ".zcci", ".zcxi"];
  }

  public static getPlatforms(): string[] {
    return ["3ds", "new-nintendo-3ds"];
  }

  public static getRommSlug(): string {
    return "3ds";
  }

  public static getDefaultArgs(): string[] {
    // The Windows build parses the short getopt form correctly.
    return ["-f", "{rom}"];
  }

  public static getSupportsSaves(): boolean {
    return true;
  }

  public async setupEnvironment(rom: Rom, saveDir: string, _rommAPI: RommApi | null, saveManager: SaveManager, _configFolder: string): Promise<EnvironmentSetupResult> {
    try {
      if (this.activeSession) return { success: false, error: "An Azahar session is already running" };

      // Preserve a session left behind by a previous client crash before reuse.
      if (fsSync.existsSync(saveDir)) {
        const recovered = await this.extractSavesFromSession(saveDir, saveManager.getLocalSaveDir(rom));
        if (recovered.length > 0) console.log(`[AZAHAR] Recovered ${recovered.length} files from a stale session for ROM ${rom.id}`);
        await fs.rm(saveDir, { recursive: true, force: true });
      }

      const sdmcDir = this.getSessionSdmcPath(saveDir);
      await fs.mkdir(sdmcDir, { recursive: true });
      console.log(`[AZAHAR] Prepared isolated SDMC directory: ${sdmcDir}`);
      return { success: true, sdmcDir };
    } catch (error: any) {
      console.error(`[AZAHAR] Failed to prepare the save environment: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  public async getSaveComparison(rom: Rom, _saveDir: string, rommAPI: RommApi | null, saveManager: SaveManager, romPath?: string): Promise<SaveComparisonResult> {
    try {
      const programId = romPath ? await this.readProgramId(romPath) : null;
      const persistentSaveDir = saveManager.getLocalSaveDir(rom);
      const personalSdmcDir = await this.getPersonalSdmcPath();
      const persistentHasFiles = await this.directoryHasFiles(persistentSaveDir);
      const personalHasFiles =
        !persistentHasFiles &&
        (programId ? await this.hasTitleSaveData(personalSdmcDir, programId) : await this.directoryHasFiles(personalSdmcDir));
      const localSave = persistentHasFiles ? persistentSaveDir : personalHasFiles ? personalSdmcDir : null;

      if (programId) console.log(`[AZAHAR] Detected Program ID ${programId} for ROM ${rom.id}`);
      else console.warn(`[AZAHAR] Could not detect a Program ID for ${romPath || rom.name}; save filtering will use the compatibility fallback`);

      let cloudSaves: any[] = [];
      if (rommAPI) {
        const result = await rommAPI.downloadSave(rom.id);
        if (result.success && Array.isArray(result.data)) cloudSaves = result.data;
      }

      return {
        success: true,
        data: {
          hasLocal: Boolean(localSave),
          hasCloud: cloudSaves.length > 0,
          localSave,
          cloudSaves,
          recommendation: localSave ? "local" : cloudSaves.length > 0 ? "cloud" : "none",
        },
      };
    } catch (error: any) {
      console.error(`[AZAHAR] Failed to compare saves for ROM ${rom.id}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  public async handleSavePreparation(
    _rom: Rom,
    saveDir: string,
    localSaveDir: string,
    _saveManager: SaveManager,
    programId?: string | null,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const sdmcDir = this.getSessionSdmcPath(saveDir);
      await this.resetDirectory(sdmcDir);
      if (await this.directoryHasFiles(localSaveDir)) {
        if (programId) {
          const copiedFiles = await this.copyRelevantSdmcData(localSaveDir, sdmcDir, programId);
          console.log(`[AZAHAR] Copied ${copiedFiles} relevant SDMC files for Program ID ${programId}`);
        } else {
          // Homebrew and compressed formats may not expose an NCCH header. Keep
          // older saves usable instead of silently discarding them.
          await fs.cp(localSaveDir, sdmcDir, { recursive: true });
          console.warn(`[AZAHAR] Program ID unavailable; copied the complete local SDMC as a compatibility fallback`);
        }
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  public async handleSaveSync(rom: Rom, saveDir: string, rommAPI: RommApi | null, saveManager: SaveManager): Promise<SaveSyncResult> {
    const sdmcDir = this.getSessionSdmcPath(saveDir);
    if (!(await this.directoryHasFiles(sdmcDir))) return { success: true, message: "No Azahar saves to sync" };

    try {
      // Persist locally first: a server outage must not lose the new save.
      await this.replaceDirectoryAtomically(sdmcDir, saveManager.getLocalSaveDir(rom));
      console.log(`[AZAHAR] Saved local SDMC snapshot for ROM ${rom.id}`);

      if (!rommAPI) return { success: true, message: "Azahar save stored locally" };

      const tempZipPath = path.join(os.tmpdir(), `azahar_save_${rom.id}_${Date.now()}.zip`);
      try {
        const zip = new AdmZip();
        zip.addLocalFolder(sdmcDir);
        zip.writeZip(tempZipPath);
        console.log(`[AZAHAR] Uploading SDMC snapshot for ROM ${rom.id}`);
        const result = await rommAPI.uploadSave(rom.id, tempZipPath, "azahar");
        if (!result.success) return { success: false, error: result.error || "Azahar save upload failed" };
      } finally {
        await fs.rm(tempZipPath, { force: true }).catch((error: any) => console.warn(`[AZAHAR] Could not remove temporary save archive: ${error.message}`));
      }

      return { success: true, message: "Azahar save synced" };
    } catch (error: any) {
      console.error(`[AZAHAR] Save sync failed for ROM ${rom.id}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  public async handleSaveChoice(
    romData: any,
    saveChoice: string,
    saveManager: SaveManager,
    rommAPI: RommApi | null,
    saveId?: number,
    onProgress?: ProgressCallback,
  ): Promise<SaveChoiceResult> {
    const { rom, finalRomPath, saveDir } = romData;
    const sdmcDir = this.getSessionSdmcPath(saveDir);

    try {
      if (this.activeSession) throw new Error("An Azahar session is already running");
      if (await this.isAzaharAlreadyRunning()) {
        throw new Error("Azahar is already running. Close it before launching a managed game so saves can be isolated safely.");
      }
      await this.resetDirectory(sdmcDir);
      const programId = await this.readProgramId(finalRomPath);
      if (programId) console.log(`[AZAHAR] Preparing saves for Program ID ${programId}`);
      else console.warn(`[AZAHAR] Program ID unavailable for ${finalRomPath}; using the compatibility fallback`);

      if (saveChoice === "cloud") {
        if (!rommAPI || !saveId) throw new Error("A RomM connection and save ID are required for a cloud save");
        const listResult = await rommAPI.downloadSave(rom.id);
        if (!listResult.success || !Array.isArray(listResult.data)) throw new Error("Failed to get the save list from RomM");
        const selectedSave = listResult.data.find((save: any) => Number(save.id) === Number(saveId));
        if (!selectedSave) throw new Error(`Save ${saveId} was not found`);

        onProgress?.({ step: "save-download", percent: 25, message: "Downloading Azahar save..." });
        const downloadResult = await rommAPI.downloadSaveFile(selectedSave);
        if (!downloadResult.success || !downloadResult.data) throw new Error(downloadResult.error || "Failed to download the Azahar save");

        if (programId) {
          const extractedDir = path.join(saveDir, ".cloud-extract");
          await this.resetDirectory(extractedDir);
          try {
            new AdmZip(downloadResult.data).extractAllTo(extractedDir, true);
            const extractedSdmc = fsSync.existsSync(path.join(extractedDir, "sdmc")) ? path.join(extractedDir, "sdmc") : extractedDir;
            const copiedFiles = await this.copyRelevantSdmcData(extractedSdmc, sdmcDir, programId);
            if (copiedFiles === 0) throw new Error(`Cloud save ${saveId} does not contain data for Program ID ${programId}`);
            console.log(`[AZAHAR] Extracted ${copiedFiles} relevant cloud save files for Program ID ${programId}`);
          } finally {
            await fs.rm(extractedDir, { recursive: true, force: true });
          }
        } else {
          new AdmZip(downloadResult.data).extractAllTo(sdmcDir, true);
          console.warn(`[AZAHAR] Extracted the complete cloud SDMC because no Program ID was available`);
        }
      } else if (saveChoice === "local") {
        const persistentSaveDir = saveManager.getLocalSaveDir(rom);
        const localSaveDir = (await this.directoryHasFiles(persistentSaveDir)) ? persistentSaveDir : await this.getPersonalSdmcPath();
        const result = await this.handleSavePreparation(rom, saveDir, localSaveDir, saveManager, programId);
        if (!result.success) throw new Error(result.error || "Failed to prepare the local Azahar save");
      }

      await this.beginConfigTransaction(saveDir, sdmcDir);
      this.activeSession = true;

      const preparedArgs = this.prepareArgs(finalRomPath, saveDir);
      console.log(`Launching Azahar: ${this.getExecutablePath()} ${preparedArgs.join(" ")}`);
      const emulatorProcess = spawn(this.getExecutablePath()!, preparedArgs, { detached: false, stdio: "ignore" });

      let started = false;
      let finalized = false;
      const finalizeSession = async () => {
        if (finalized) return;
        finalized = true;
        onProgress?.({ step: "save-sync", percent: 60, message: "Azahar closed, syncing saves..." });
        try {
          if (!(await this.restoreConfigTransaction(saveDir))) throw new Error("Azahar configuration could not be restored");
          onProgress?.({ step: "save-sync", percent: 75, message: "Backing up Azahar saves..." });
          const syncResult = await this.handleSaveSync(rom, saveDir, rommAPI, saveManager);
          if (!syncResult.success) throw new Error(syncResult.error || "Azahar save sync failed");
          await fs.rm(saveDir, { recursive: true, force: true });
          onProgress?.({ step: "complete", percent: 100, message: "Azahar saves synced", complete: true });
        } catch (error: any) {
          console.warn(`[AZAHAR] Session finalization failed: ${error.message}`);
          onProgress?.({ step: "error", percent: 100, message: error.message, complete: true, error: error.message });
        } finally {
          this.activeSession = false;
        }
      };

      emulatorProcess.once("close", async (code, signal) => {
        console.log(`[AZAHAR] Process closed with code ${code}${signal ? ` (signal: ${signal})` : ""}`);
        await finalizeSession();
      });

      return await new Promise<SaveChoiceResult>((resolve) => {
        emulatorProcess.once("spawn", () => {
          started = true;
          console.log(`[AZAHAR] Process started with PID ${emulatorProcess.pid}`);
          onProgress?.({ step: "launch", percent: 100, message: "Game launched" });
          resolve({ success: true, message: `ROM launched: ${rom.name}`, pid: emulatorProcess.pid, romPath: finalRomPath, saveDir });
        });
        emulatorProcess.once("error", async (error) => {
          console.error(`[AZAHAR] Process error: ${error.message}`);
          if (!started) {
            // A failed spawn is normally followed by "close". Mark it handled
            // so the close listener cannot race the configuration rollback.
            finalized = true;
            await this.restoreConfigTransaction(saveDir);
            this.activeSession = false;
            resolve({ success: false, error: `Failed to start Azahar: ${error.message}` });
          } else {
            await finalizeSession();
          }
        });
      });
    } catch (error: any) {
      await this.restoreConfigTransaction(saveDir).catch(() => false);
      this.activeSession = false;
      return { success: false, error: error.message };
    }
  }

  /** Recover only SDMC data; transaction metadata never becomes save data. */
  public async extractSavesFromSession(sessionPath: string, persistentSaveDir: string): Promise<string[]> {
    if (!(await this.restoreConfigTransaction(sessionPath))) {
      throw new Error("Cannot recover the Azahar session until its configuration has been restored");
    }
    const sdmcDir = this.getSessionSdmcPath(sessionPath);
    if (!(await this.directoryHasFiles(sdmcDir))) return [];
    await this.replaceDirectoryAtomically(sdmcDir, persistentSaveDir);
    return this.listRelativeFiles(sdmcDir);
  }

  /**
   * Read the unencrypted NCCH Program ID. A CXI/NCCH starts at offset zero;
   * a 3DS/CCI first points to its main NCCH partition in the NCSD table.
   */
  private async readProgramId(romPath: string): Promise<string | null> {
    let file: fs.FileHandle | null = null;
    try {
      file = await fs.open(romPath, "r");
      const readHeader = async (offset: number): Promise<Buffer | null> => {
        const header = Buffer.alloc(0x200);
        const { bytesRead } = await file!.read(header, 0, header.length, offset);
        return bytesRead >= 0x120 ? header : null;
      };

      let header = await readHeader(0);
      if (!header) return null;
      if (header.toString("ascii", 0, 4) === "Z3DS") {
        return this.readZ3dsMetadataProgramId(file, header);
      }
      const containerMagic = header.toString("ascii", 0x100, 0x104);

      if (containerMagic === "NCSD") {
        const mainPartitionOffset = header.readUInt32LE(0x120) * 0x200;
        if (!mainPartitionOffset) return null;
        header = await readHeader(mainPartitionOffset);
        if (!header || header.toString("ascii", 0x100, 0x104) !== "NCCH") return null;
      } else if (containerMagic !== "NCCH") {
        return null;
      }

      const programId = header.readBigUInt64LE(0x118);
      if (programId === 0n) return null;
      return programId.toString(16).padStart(16, "0").toLowerCase();
    } catch (error: any) {
      console.warn(`[AZAHAR] Failed to read Program ID from ${romPath}: ${error.message}`);
      return null;
    } finally {
      await file?.close().catch(() => undefined);
    }
  }

  /** Azahar stores titleinfo, including the Title ID, uncompressed in Z3DS metadata. */
  private async readZ3dsMetadataProgramId(file: fs.FileHandle, header: Buffer): Promise<string | null> {
    const headerSize = header.readUInt16LE(0x0a);
    const metadataSize = header.readUInt32LE(0x0c);
    if (headerSize < 0x20 || metadataSize === 0 || metadataSize > 1024 * 1024) return null;

    const metadata = Buffer.alloc(metadataSize);
    const { bytesRead } = await file.read(metadata, 0, metadata.length, headerSize);
    if (bytesRead !== metadataSize || metadata[0] !== 1) return null;

    let offset = 1;
    while (offset + 4 <= metadata.length) {
      const type = metadata[offset];
      const nameLength = metadata[offset + 1];
      const dataLength = metadata.readUInt16LE(offset + 2);
      offset += 4;
      if (type === 0) break;
      if (offset + nameLength + dataLength > metadata.length) return null;

      const name = metadata.toString("utf8", offset, offset + nameLength);
      offset += nameLength;
      if (type === 1 && name === "titleinfo" && dataLength >= 8) {
        const programId = metadata.readBigUInt64LE(offset);
        return programId === 0n ? null : programId.toString(16).padStart(16, "0").toLowerCase();
      }
      offset += dataLength;
    }
    return null;
  }

  private async hasTitleSaveData(sdmcDir: string, programId: string): Promise<boolean> {
    const { high, low } = this.splitProgramId(programId);
    for (const identityRoot of await this.getIdentityRoots(sdmcDir)) {
      const highDir = await this.findDirectoryIgnoringCase(path.join(identityRoot, "title"), high);
      const lowDir = highDir ? await this.findDirectoryIgnoringCase(highDir, low) : null;
      if (lowDir && (await this.directoryHasFiles(path.join(lowDir, "data")))) return true;
    }
    return false;
  }

  /** Copy this title's normal save and every extdata directory, preserving SDMC paths. */
  private async copyRelevantSdmcData(sourceSdmc: string, destinationSdmc: string, programId: string): Promise<number> {
    const { high, low } = this.splitProgramId(programId);
    const identityRoots = await this.getIdentityRoots(sourceSdmc);

    for (const identityRoot of identityRoots) {
      const relativeIdentityRoot = path.relative(sourceSdmc, identityRoot);
      const highDir = await this.findDirectoryIgnoringCase(path.join(identityRoot, "title"), high);
      const lowDir = highDir ? await this.findDirectoryIgnoringCase(highDir, low) : null;
      const titleDataDir = lowDir ? path.join(lowDir, "data") : null;

      if (titleDataDir && fsSync.existsSync(titleDataDir)) {
        const relativeTitleData = path.relative(sourceSdmc, titleDataDir);
        await fs.mkdir(path.dirname(path.join(destinationSdmc, relativeTitleData)), { recursive: true });
        await fs.cp(titleDataDir, path.join(destinationSdmc, relativeTitleData), { recursive: true });
      }

      // Extdata IDs are independent from the Program ID. Keep all extdata as
      // requested, but never copy other games' title/data or installed content.
      const extdataDir = path.join(identityRoot, "extdata");
      if (fsSync.existsSync(extdataDir)) {
        const destinationExtdata = path.join(destinationSdmc, relativeIdentityRoot, "extdata");
        await fs.mkdir(path.dirname(destinationExtdata), { recursive: true });
        await fs.cp(extdataDir, destinationExtdata, { recursive: true });
      }
    }

    return (await this.listRelativeFiles(destinationSdmc)).length;
  }

  private splitProgramId(programId: string): { high: string; low: string } {
    const normalized = programId.toLowerCase().padStart(16, "0");
    if (!/^[0-9a-f]{16}$/.test(normalized)) throw new Error(`Invalid 3DS Program ID: ${programId}`);
    return { high: normalized.slice(0, 8), low: normalized.slice(8) };
  }

  private async getIdentityRoots(sdmcDir: string): Promise<string[]> {
    const nintendo3dsDir = path.join(sdmcDir, "Nintendo 3DS");
    if (!fsSync.existsSync(nintendo3dsDir)) return [];

    const identityRoots: string[] = [];
    const id0Entries = await fs.readdir(nintendo3dsDir, { withFileTypes: true });
    for (const id0 of id0Entries) {
      if (!id0.isDirectory() || !/^[0-9a-f]{32}$/i.test(id0.name)) continue;
      const id0Path = path.join(nintendo3dsDir, id0.name);
      const id1Entries = await fs.readdir(id0Path, { withFileTypes: true });
      for (const id1 of id1Entries) {
        if (id1.isDirectory() && /^[0-9a-f]{32}$/i.test(id1.name)) identityRoots.push(path.join(id0Path, id1.name));
      }
    }
    return identityRoots;
  }

  private async findDirectoryIgnoringCase(parentDir: string, expectedName: string): Promise<string | null> {
    if (!fsSync.existsSync(parentDir)) return null;
    const entries = await fs.readdir(parentDir, { withFileTypes: true });
    const match = entries.find((entry) => entry.isDirectory() && entry.name.toLowerCase() === expectedName.toLowerCase());
    return match ? path.join(parentDir, match.name) : null;
  }

  /**
   * Mirror Azahar's platform-specific directory layout. On Linux, data and
   * configuration deliberately live under different XDG roots.
   */
  private getAzaharDirectories(platform: NodeJS.Platform = process.platform): AzaharDirectories {
    const executablePath = this.getExecutablePath();
    const portableRoot = platform === "win32" && executablePath ? path.dirname(executablePath) : process.cwd();
    const portableUserDir = path.join(portableRoot, "user");
    if (fsSync.existsSync(portableUserDir)) {
      return { data: portableUserDir, config: path.join(portableUserDir, "config") };
    }

    if (platform === "win32") {
      const userDir = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Azahar");
      return { data: userDir, config: path.join(userDir, "config") };
    }

    if (platform === "darwin") {
      const userDir = path.join(os.homedir(), "Library", "Application Support", "Azahar");
      return { data: userDir, config: path.join(userDir, "config") };
    }

    return {
      data: path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "azahar-emu"),
      config: path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "azahar-emu"),
    };
  }

  private getAzaharUserDirectory(): string {
    return this.getAzaharDirectories().data;
  }

  private getConfigPath(): string {
    return path.join(this.getAzaharDirectories().config, "qt-config.ini");
  }

  private getSessionSdmcPath(saveDir: string): string {
    return path.join(saveDir, "sdmc");
  }

  private async getPersonalSdmcPath(): Promise<string> {
    const defaultPath = path.join(this.getAzaharUserDirectory(), "sdmc");
    const configPath = this.getConfigPath();
    if (!fsSync.existsSync(configPath)) return defaultPath;
    const config = await fs.readFile(configPath, "utf8");
    const usesDefault = this.readDataStorageSetting(config, "use_custom_storage\\default") === "true";
    const useCustom = !usesDefault && this.readDataStorageSetting(config, "use_custom_storage") === "true";
    const configuredPath = this.readDataStorageSetting(config, "sdmc_directory");
    if (!useCustom || !configuredPath) return defaultPath;
    return configuredPath.replace(/^"|"$/g, "").replace(/\\\\/g, "\\");
  }

  private getTransactionDirectory(saveDir: string): string {
    return path.join(saveDir, AzaharEmulator.TRANSACTION_DIRECTORY);
  }

  private async beginConfigTransaction(saveDir: string, sdmcDir: string): Promise<void> {
    const configPath = this.getConfigPath();
    if (!fsSync.existsSync(configPath)) throw new Error(`Azahar configuration was not found at ${configPath}. Start Azahar once before launching a game.`);

    const originalConfig = await fs.readFile(configPath, "utf8");
    const keys = ["use_custom_storage\\default", "use_custom_storage", "sdmc_directory\\default", "sdmc_directory"];
    const originalSettings: Record<string, string | null> = {};
    for (const key of keys) originalSettings[key] = this.readDataStorageSetting(originalConfig, key);

    const transactionDir = this.getTransactionDirectory(saveDir);
    await fs.mkdir(transactionDir, { recursive: true });
    await fs.writeFile(path.join(transactionDir, AzaharEmulator.CONFIG_BACKUP_FILE), originalConfig, "utf8");
    await fs.writeFile(path.join(transactionDir, AzaharEmulator.TRANSACTION_FILE), JSON.stringify({ configPath, originalSettings } satisfies ConfigTransaction, null, 2), "utf8");

    let sessionConfig = originalConfig;
    sessionConfig = this.writeDataStorageSetting(sessionConfig, "use_custom_storage\\default", "false");
    sessionConfig = this.writeDataStorageSetting(sessionConfig, "use_custom_storage", "true");
    sessionConfig = this.writeDataStorageSetting(sessionConfig, "sdmc_directory\\default", "false");
    const qtSdmcPath = `${sdmcDir.replace(/\\/g, "/").replace(/\/$/, "")}/`;
    sessionConfig = this.writeDataStorageSetting(sessionConfig, "sdmc_directory", qtSdmcPath);
    await fs.writeFile(configPath, sessionConfig, "utf8");
    console.log(`[AZAHAR] Redirected SDMC to: ${qtSdmcPath}`);
  }

  private async restoreConfigTransaction(saveDir: string): Promise<boolean> {
    const transactionDir = this.getTransactionDirectory(saveDir);
    const transactionPath = path.join(transactionDir, AzaharEmulator.TRANSACTION_FILE);
    if (!fsSync.existsSync(transactionPath)) return true;

    try {
      const transaction = JSON.parse(await fs.readFile(transactionPath, "utf8")) as ConfigTransaction;
      let currentConfig: string;
      try {
        currentConfig = await fs.readFile(transaction.configPath, "utf8");
      } catch {
        currentConfig = await fs.readFile(path.join(transactionDir, AzaharEmulator.CONFIG_BACKUP_FILE), "utf8");
      }
      for (const [key, value] of Object.entries(transaction.originalSettings)) currentConfig = this.writeDataStorageSetting(currentConfig, key, value);
      await fs.writeFile(transaction.configPath, currentConfig, "utf8");
      await fs.rm(transactionDir, { recursive: true, force: true });
      console.log(`[AZAHAR] Restored the original SDMC configuration`);
      return true;
    } catch (error: any) {
      console.error(`[AZAHAR] Failed to restore the original configuration: ${error.message}`);
      return false;
    }
  }

  private readDataStorageSetting(config: string, key: string): string | null {
    const section = this.getDataStorageSection(config);
    if (!section) return null;
    const match = section.body.match(new RegExp(`^${this.escapeRegExp(key)}=(.*)$`, "m"));
    return match ? match[1].trim() : null;
  }

  private writeDataStorageSetting(config: string, key: string, value: string | null): string {
    const section = this.getDataStorageSection(config);
    if (!section) {
      if (value === null) return config;
      const eol = config.includes("\r\n") ? "\r\n" : "\n";
      const separator = config.length > 0 && !config.endsWith(eol) ? eol : "";
      return `${config}${separator}[Data%20Storage]${eol}${key}=${value}${eol}`;
    }

    const pattern = new RegExp(`^${this.escapeRegExp(key)}=.*(?:\\r?\\n|$)`, "m");
    let body = section.body;
    if (value === null) body = body.replace(pattern, "");
    else if (pattern.test(body)) {
      const matched = body.match(pattern)?.[0] || "";
      const eol = matched.endsWith("\r\n") ? "\r\n" : "\n";
      body = body.replace(pattern, `${key}=${value}${eol}`);
    } else {
      const eol = config.includes("\r\n") ? "\r\n" : "\n";
      body = `${body}${body.length > 0 && !body.endsWith(eol) ? eol : ""}${key}=${value}${eol}`;
    }
    return `${config.slice(0, section.bodyStart)}${body}${config.slice(section.bodyEnd)}`;
  }

  private getDataStorageSection(config: string): { body: string; bodyStart: number; bodyEnd: number } | null {
    const header = /^\[(?:Data%20Storage|Data Storage)\]\s*\r?\n/m.exec(config);
    if (!header || header.index === undefined) return null;
    const bodyStart = header.index + header[0].length;
    const next = /^\[.+\]\s*\r?\n/m.exec(config.slice(bodyStart));
    const bodyEnd = next?.index === undefined ? config.length : bodyStart + next.index;
    return { body: config.slice(bodyStart, bodyEnd), bodyStart, bodyEnd };
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private async directoryHasFiles(directory: string): Promise<boolean> {
    if (!directory || !fsSync.existsSync(directory)) return false;
    const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true });
    return entries.some((entry) => entry.isFile());
  }

  private async isAzaharAlreadyRunning(): Promise<boolean> {
    const executablePath = this.getExecutablePath();
    if (!executablePath) return false;
    const executableName = path.basename(executablePath).toLowerCase();

    return new Promise((resolve) => {
      if (process.platform === "win32") {
        execFile("tasklist", ["/FI", `IMAGENAME eq ${path.basename(executablePath)}`, "/FO", "CSV", "/NH", "/V"], { windowsHide: true }, (error, stdout) => {
          if (error) {
            console.warn(`[AZAHAR] Could not check for an existing process: ${error.message}`);
            resolve(false);
            return;
          }

          const matchingProcesses = stdout
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => this.parseCsvRow(line))
            .filter((columns) => columns[0]?.toLowerCase() === executableName);
          const visibleProcesses = matchingProcesses.filter((columns) => {
            const windowTitle = columns.at(-1)?.trim();
            return Boolean(windowTitle && windowTitle.toUpperCase() !== "N/A");
          });

          if (matchingProcesses.length > visibleProcesses.length) {
            console.log(`[AZAHAR] Ignoring ${matchingProcesses.length - visibleProcesses.length} headless Azahar process(es)`);
          }
          resolve(visibleProcesses.length > 0);
        });
        return;
      }

      execFile("ps", ["-A", "-o", "comm="], (error, stdout) => {
        if (error) {
          console.warn(`[AZAHAR] Could not check for an existing process: ${error.message}`);
          resolve(false);
          return;
        }
        resolve(stdout.split(/\r?\n/).some((processName) => path.basename(processName.trim()).toLowerCase() === executableName));
      });
    });
  }

  private parseCsvRow(row: string): string[] {
    const columns: string[] = [];
    let current = "";
    let quoted = false;

    for (let index = 0; index < row.length; index++) {
      const character = row[index];
      if (character === '"') {
        if (quoted && row[index + 1] === '"') {
          current += '"';
          index++;
        } else {
          quoted = !quoted;
        }
      } else if (character === "," && !quoted) {
        columns.push(current);
        current = "";
      } else {
        current += character;
      }
    }
    columns.push(current);
    return columns;
  }

  private async listRelativeFiles(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry: any) => path.relative(directory, path.join(entry.parentPath || entry.path, entry.name)));
  }

  private async resetDirectory(directory: string): Promise<void> {
    await fs.rm(directory, { recursive: true, force: true });
    await fs.mkdir(directory, { recursive: true });
  }

  private async replaceDirectoryAtomically(source: string, destination: string): Promise<void> {
    const suffix = Date.now();
    const staging = `${destination}.staging-${suffix}`;
    const previous = `${destination}.previous-${suffix}`;
    await fs.rm(staging, { recursive: true, force: true });
    await fs.cp(source, staging, { recursive: true });
    let movedPrevious = false;
    try {
      if (fsSync.existsSync(destination)) {
        await fs.rename(destination, previous);
        movedPrevious = true;
      }
      await fs.rename(staging, destination);
      if (movedPrevious) {
        await fs.rm(previous, { recursive: true, force: true }).catch((error: any) => {
          console.warn(`[AZAHAR] Could not remove the previous local snapshot: ${error.message}`);
        });
      }
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      if (movedPrevious && !fsSync.existsSync(destination) && fsSync.existsSync(previous)) await fs.rename(previous, destination).catch(() => undefined);
      throw error;
    }
  }
}
