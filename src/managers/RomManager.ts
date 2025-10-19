import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

import { RommClient } from "../RomMClient";
import { LocalRom, Rom } from "../types/RommApi";
import { HashCalculator } from "../utils/HashCalculator";
import { on } from "events";

export class RomManager {
  private roms: Rom[] = [];
  private rommClient: RommClient;
  private localRoms: LocalRom[] = [];

  constructor(rommClient: RommClient) {
    this.rommClient = rommClient;
  }

  public getRoms(): Rom[] {
    return this.roms;
  }

  public getLocalRoms(): LocalRom[] {
    return this.localRoms;
  }

  public getLocalRomById(id: number): LocalRom | undefined {
    return this.localRoms.find((rom) => rom.id === id);
  }

  async loadRemoteRoms(): Promise<number> {
    if (!this.rommClient.rommApi) {
      throw new Error("Romm API is not available");
    }

    // Load ROMs from the remote API
    const response = await this.rommClient.rommApi.fetchAllRoms();
    if (!response.success) {
      throw new Error("Failed to load remote ROMs");
    }

    if (Array.isArray(response.data) && response.data.length > 0) {
      this.roms = response.data;
    }

    return this.roms.length;
  }

  async deleteLocalRom(id: number): Promise<{ success: boolean }> {
    const localRom = this.getLocalRomById(id);
    if (localRom) {
      try {
        await fs.promises.unlink(localRom.localPath);
        console.log(`[ROM MANAGER] Deleted local ROM file: ${localRom.localPath}`);
      } catch (error) {
        console.error(`[ROM MANAGER] Failed to delete local ROM file: ${localRom.localPath}`, error);
      }
      this.localRoms = this.localRoms.filter((rom) => rom.id !== id);
      return { success: true };
    }
    return { success: false };
  }

  async loadLocalRoms(): Promise<number> {
    // ROMs are stored in folders named rom_<id> inside each platform subfolder
    const romFolder = this.rommClient.getRomFolder();
    if (!romFolder) throw new Error("ROM folder not set");
    this.localRoms = [];
    const platformFolders = await fs.promises.readdir(romFolder, { withFileTypes: true });
    for (const dirent of platformFolders) {
      if (dirent.isDirectory()) {
        const platformPath = path.join(romFolder, dirent.name);
        const romDirs = await fs.promises.readdir(platformPath, { withFileTypes: true });
        for (const romDirent of romDirs) {
          if (romDirent.isDirectory() && romDirent.name.startsWith("rom_")) {
            const romId = romDirent.name.replace("rom_", "");
            const rom = this.roms.find((r) => r.id.toString() === romId);
            if (rom) {
              const romPath = path.join(platformPath, romDirent.name);
              const files = await fs.promises.readdir(romPath);
              const localRom: LocalRom = {
                ...rom,
                localPath: romPath,
                localFiles: files.map((f) => path.join(romPath, f)),
              };
              this.localRoms.push(localRom);
            }
          }
        }
      }
    }
    return this.localRoms.length;
  }

  private saveRoms(): void {
    // Save ROMs to storage (e.g., file system, database)
  }

  private async checkRomIntegrity(rom: LocalRom): Promise<boolean> {
    // Check integrity for all files in the localPath folder
    let ignoredExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".txt", ".nfo", ".md", ".7z", ".rar", ".pdf"];
    if (!rom.localFiles || rom.localFiles.length === 0) return false;

    // Check if there's a zip file in the ROM's files list
    const zipFile = Array.isArray(rom.files) ? rom.files.find((f) => f.file_name.endsWith(".zip")) : undefined;
    let useZipHash = false;
    let zipHashParams;

    if (zipFile) {
      // Use the zip file's hash for integrity checking of extracted files
      zipHashParams = {
        crc_hash: zipFile.crc_hash,
        md5_hash: zipFile.md5_hash,
        sha1_hash: zipFile.sha1_hash,
      };
      useZipHash = true;
      console.log(`[ROM INTEGRITY] Found zip file ${zipFile.file_name}, using its hash for integrity checking`);
    }

    let allValid = true;
    for (const filePath of rom.localFiles) {
      if (ignoredExtensions.some((ext) => filePath.endsWith(ext))) {
        console.log(`[ROM INTEGRITY] Ignoring integrity check for file: ${filePath}`);
        continue;
      }

      // Skip zip files themselves if we're using zip hash
      if (useZipHash && filePath.endsWith(".zip")) {
        console.log(`[ROM INTEGRITY] Skipping zip file integrity check (using zip hash for others): ${filePath}`);
        continue;
      }

      let hashParams;
      if (useZipHash && zipHashParams) {
        // Use zip file's hash for all extracted files
        hashParams = zipHashParams;
        console.log(`[ROM INTEGRITY] Using zip hash for file: ${filePath}`);
      } else {
        // Find the file object in rom.files that matches this filePath
        const fileName = path.basename(filePath);
        const fileObj = Array.isArray(rom.files) ? rom.files.find((f) => f.file_name === fileName) : undefined;
        if (fileObj) {
          hashParams = {
            crc_hash: fileObj.crc_hash,
            md5_hash: fileObj.md5_hash,
            sha1_hash: fileObj.sha1_hash,
          };
        } else {
          // fallback to ROM-level hash if not found
          hashParams = {
            crc_hash: rom.crc_hash,
            md5_hash: rom.md5_hash,
            sha1_hash: rom.sha1_hash,
          };
        }
      }

      let result = await HashCalculator.verifyFileIntegrity(filePath, hashParams);
      if (!result.isValid) {
        allValid = false;
        console.log(`[ROM INTEGRITY] Invalid file: ${filePath}`);
      }
    }
    return allValid;
  }

  async launchRom(rom: Rom, onProgress: (progress: any) => void, onSaveUploadSuccess: (rom: any) => void, onDownloadComplete?: (rom: any) => void): Promise<any> {
    // first we need to check if we already have the file downloaded
    console.log("[LAUNCH]" + `Launching ROM: ${rom.name} (ID: ${rom.id})`);

    let localRom;
    let isRomOkay = false;
    if (rom && rom.id) {
      localRom = this.localRoms.find((r) => r.id === rom.id);
    }
    if (localRom && localRom.localPath) {
      console.log("[LAUNCH]" + `Found local ROM: ${localRom.name} (ID: ${localRom.id})`);
      // Check integrity for all files in the folder
      const isValid = await this.checkRomIntegrity(localRom);
      if (!isValid) {
        console.log("[LAUNCH]" + `Local ROM is invalid: ${localRom.name} (ID: ${localRom.id})`);
        // If integrity fails, redownload
      } else {
        console.log("[LAUNCH]" + `Local ROM is valid: ${localRom.name} (ID: ${localRom.id})`);
        isRomOkay = true;
        onProgress({ step: "download", percent: 100, downloaded: "0.00", total: "0.00", message: "ROM already available" });
        if (onDownloadComplete) {
          onDownloadComplete(rom);
        }
      }
    }

    // If we don't have the local ROM, we need to download it
    if (!isRomOkay) {
      console.log("[LAUNCH]" + `Local ROM is missing or invalid: ${rom.name} (ID: ${rom.id})`);

      let romFolder = this.rommClient.getRomFolder();
      if (!romFolder) throw new Error("ROM folder not set");
      let romEmulatorSlug = rom.platform_slug || "unknown";
      let romEmulatorPath = path.join(romFolder, romEmulatorSlug, "rom_" + rom.id);
      if (!fs.existsSync(romEmulatorPath)) {
        fs.mkdirSync(romEmulatorPath, { recursive: true });
      }
      if (!fs.existsSync(path.join(romFolder, romEmulatorSlug))) {
        fs.mkdirSync(path.join(romFolder, romEmulatorSlug), { recursive: true });
      }
      if (!this.rommClient.rommApi) throw new Error("RomM API is not initialized");
      onProgress({ step: "download", percent: 0, downloaded: "0.00", total: "0.00", message: "Starting download..." });
      let dlres = await this.rommClient.rommApi.downloadRom(rom, romEmulatorPath, onProgress);
      if (!dlres || !dlres.success || dlres.error) throw new Error("Failed to download ROM: " + (dlres?.error || "Unknown error"));
      onProgress({ step: "download", percent: 100, downloaded: "100.00", total: "100.00", message: "Download complete" });
      // Add the folder and files to localRoms
      const files = await fs.promises.readdir(romEmulatorPath);
      localRom = this.localRoms.find((r) => r.id === rom.id);
      if (!localRom) {
        (rom as LocalRom).localPath = romEmulatorPath;
        (rom as LocalRom).localFiles = files.map((f) => path.join(romEmulatorPath, f));
        this.localRoms.push(rom as LocalRom);
        localRom = rom as LocalRom;
      } else {
        localRom.localPath = romEmulatorPath;
        localRom.localFiles = files.map((f) => path.join(romEmulatorPath, f));
      }

      // if we've downloaded a zip file among the files, we need to extract it
      const zipFiles = localRom.files.filter((f) => f.file_name.endsWith(".zip"));
      for (const zipFile of zipFiles) {
        const zipFilePath = path.join(localRom.localPath, zipFile.file_name);
        const zip = new AdmZip(zipFilePath);
        let zipEntries = await zip.getEntries();
        console.log("[LAUNCH]" + `Extracting zip file: ${zipFilePath} with ${zipEntries.length} entries`);

        // extract all entries in the root of the localRom folder
        await zip.extractAllTo(localRom.localPath, true);

        for (const entry of zipEntries) {
          console.log("[LAUNCH]" + `Extracted entry: ${entry.entryName} to ${localRom.localPath}`);
          if (!localRom.localFiles) localRom.localFiles = [];
          localRom.localFiles.push(path.join(localRom.localPath, entry.entryName));
        }

        // delete the zip file after extraction
        // await fs.promises.unlink(zipFilePath);
        // console.log("[LAUNCH]" + `Extracted and deleted zip file: ${zipFilePath}`);
      }

      let isValid = await this.checkRomIntegrity(localRom);
      if (!isValid) {
        console.log("[LAUNCH]" + `Downloaded ROM is invalid: ${localRom.name} (ID: ${localRom.id})`);
        throw new Error("Downloaded ROM is invalid");
      } else {
        console.log("[LAUNCH]" + `Downloaded ROM is valid: ${localRom.name} (ID: ${localRom.id})`);
        if (onDownloadComplete) {
          onDownloadComplete(rom);
        }
      }
    }

    // then we need to setup the working directory for the emulator
    // then we check what saves are available for this ROM and prompt the user to select one if needed
    // once we have the save file we need to launch the emulator with the ROM and the save file
  }
}
