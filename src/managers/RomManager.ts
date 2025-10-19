import fs from "fs";
import path from "path";

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

  public addRom(rom: Rom): void {
    this.roms.push(rom);
    this.saveRoms();
  }

  public removeRom(rom: Rom): void {
    this.roms = this.roms.filter((r) => r.id !== rom.id);
    this.saveRoms();
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

  async loadLocalRoms(): Promise<number> {
    // the roms are stored in a folder with rom_idoftherom
    // so we just need to match this.roms with what we found
    const romFolder = this.rommClient.getRomFolder();

    if (!romFolder) throw new Error("ROM folder not set");

    // scan local folder
    const localRoms = await fs.promises.readdir(romFolder);
    for (const folderName of localRoms) {
      const rom = this.roms.find((r) => "rom_" + r.id.toString() === folderName);
      if (rom) {
        let localRom = rom as LocalRom;
        localRom.localPath = path.join(romFolder, folderName);
      }
    }
    return this.localRoms.length;
  }

  private saveRoms(): void {
    // Save ROMs to storage (e.g., file system, database)
  }

  private async checkRomIntegrity(rom: LocalRom): Promise<boolean> {
    // for the moment we ignore zip files
    let ignoredExtensions = [".zip", ".7z", ".rar", ".tar", ".gz", ".bz2"];

    if (ignoredExtensions.some((ext) => rom.localPath.endsWith(ext))) {
      return Promise.resolve(true);
    }

    let result = await HashCalculator.verifyFileIntegrity(rom.localPath, { crc_hash: rom.crc_hash, md5_hash: rom.md5_hash, sha1_hash: rom.sha1_hash });

    return Promise.resolve(result.isValid);
  }

  async launchRom(rom: Rom, onProgress: (progress: any) => void, onSaveUploadSuccess: (rom: any) => void): Promise<any> {
    // first we need to check if we already have the file downloaded
    console.log("[LAUNCH]" + `Launching ROM: ${rom.name} (ID: ${rom.id})`);

    let localRom;
    let isRomOkay = false;
    if (rom && rom.id) {
      localRom = this.localRoms.find((r) => r.id === rom.id);
    }
    if (localRom && localRom.localPath) {
      console.log("[LAUNCH]" + `Found local ROM: ${localRom.name} (ID: ${localRom.id})`);
      // If we have the local ROM, we need to check its integrity
      const isValid = await this.checkRomIntegrity(localRom);
      if (!isValid) {
        console.log("[LAUNCH]" + `Local ROM is invalid: ${localRom.name} (ID: ${localRom.id})`);
        // If the integrity check fails, we need to redownload the ROM
      } else {
        console.log("[LAUNCH]" + `Local ROM is valid: ${localRom.name} (ID: ${localRom.id})`);
        isRomOkay = true;
      }
    }

    // If we don't have the local ROM, we need to download it
    if (!isRomOkay) {
      console.log("[LAUNCH]" + `Local ROM is missing or invalid: ${rom.name} (ID: ${rom.id})`);

      let fileName = "rom_" + rom.id + "." + rom.fs_extension;
      let romFolder = this.rommClient.getRomFolder();
      if (!romFolder) throw new Error("ROM folder not set");

      let romEmulatorSlug = rom.platform_slug || "unknown";

      let fullRomPath = path.join(romFolder, romEmulatorSlug, fileName);

      if (!fs.existsSync(path.join(romFolder, romEmulatorSlug))) {
        fs.mkdirSync(path.join(romFolder, romEmulatorSlug), { recursive: true });
      }

      if (!this.rommClient.rommApi) throw new Error("RomM API is not initialized");
      let dlres = await this.rommClient.rommApi.downloadRom(rom.id, rom.fs_name, onProgress);

      if (!dlres || !dlres.success || dlres.error) throw new Error("Failed to download ROM: " + (dlres?.error || "Unknown error"));

      // Save the file to cache with correct extension
      if (!dlres.data) {
        throw new Error("Downloaded ROM data is undefined");
      }
      fs.writeFileSync(fullRomPath, Buffer.from(dlres.data));
      console.log(`[CACHE] File saved to cache: ${fullRomPath}`);

      // if the dl is okay, we can add our rom to our localroms, but first we need to check if it has been already added
      localRom = this.localRoms.find((r) => r.id === rom.id);
      if (!localRom) {
        (rom as LocalRom).localPath = path.join(romFolder, fileName);
        this.localRoms.push(rom as LocalRom);
        localRom = rom as LocalRom;
      } else {
        // local rom found, update its path
        localRom.localPath = path.join(romFolder, fileName);
      }

      let isValid = await this.checkRomIntegrity(localRom);
      if (!isValid) {
        console.log("[LAUNCH]" + `Downloaded ROM is invalid: ${localRom.name} (ID: ${localRom.id})`);
        throw new Error("Downloaded ROM is invalid");
      } else {
        console.log("[LAUNCH]" + `Downloaded ROM is valid: ${localRom.name} (ID: ${localRom.id})`);
      }
    }

    // then we need to setup the working directory for the emulator
    // then we check what saves are available for this ROM and prompt the user to select one if needed
    // once we have the save file we need to launch the emulator with the ROM and the save file
  }
}
