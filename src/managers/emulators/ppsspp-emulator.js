const Emulator = require('./emulator');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

/**
 * PPSSPP (PSP) Emulator implementation
 */
class PPSSPPEmulator extends Emulator {
    constructor(config) {
        super({
            ...config,
            platform: 'psp',
            name: 'PPSSPP',
            extensions: ['.iso', '.cso', '.pbp', '.elf'],
            args: ['{rom}']
        });
    }

    /**
     * Extract PSP game code from ISO file
     * PSP game codes are stored at offset 0x8000-0x8009 in the ISO
     */
    async extractPSPGameCode(romPath) {
        try {
            const fd = fsSync.openSync(romPath, 'r');
            const buffer = Buffer.alloc(10);
            fsSync.readSync(fd, buffer, 0, 10, 0x8000);
            fsSync.closeSync(fd);

            // Convert buffer to string, filtering out non-printable characters
            let gameCode = '';
            for (let i = 0; i < buffer.length; i++) {
                const charCode = buffer[i];
                if (charCode >= 32 && charCode <= 126) { // Printable ASCII characters
                    gameCode += String.fromCharCode(charCode);
                }
            }
            gameCode = gameCode.trim();

            // Validate the game code format (should be like ULUS-XXXXX, ULES-XXXXX, etc.)
            if (gameCode.match(/^[A-Z]{4}[-\s]\d{5}$/)) {
                gameCode = gameCode.replace(/[-\s]/, '-'); // Normalize separator
                console.log(`[PSP] Extracted game code: ${gameCode} from ${romPath}`);
                return gameCode;
            } else {
                console.warn(`[PSP] Invalid game code format: ${gameCode}, trying alternative extraction`);
            }
        } catch (error) {
            console.warn(`[PSP] Failed to extract game code from ${romPath}: ${error.message}`);
        }

        // Fallback: try to extract from filename
        const fileName = path.basename(romPath, path.extname(romPath));
        const codeMatch = fileName.match(/([A-Z]{4}[-\s]?\d{5})/i);
        if (codeMatch) {
            const extractedCode = codeMatch[1].toUpperCase().replace(/[-\s]/, '-');
            console.log(`[PSP] Using game code from filename: ${extractedCode}`);
            return extractedCode;
        }

        // Final fallback
        console.warn(`[PSP] Could not extract valid game code, using fallback`);
        return 'GAME';
    }

    async setupEnvironment(rom, saveDir, rommAPI, saveManager) {
        try {
            const ppssppDir = path.dirname(this.getExecutablePath());

            // 1. Create portable.txt to enable portable mode
            const portableTxtPath = path.join(ppssppDir, 'portable.txt');
            if (!fsSync.existsSync(portableTxtPath)) {
                await fs.writeFile(portableTxtPath, '');
                console.log(`Created portable.txt in PPSSPP directory`);
            }

            // 2. Setup ROM-specific memstick directory
            const romMemstickDir = path.join(saveDir, 'memstick');
            await fs.mkdir(romMemstickDir, { recursive: true });

            // 3. Create installed.txt pointing to ROM memstick
            const installedTxtPath = path.join(ppssppDir, 'installed.txt');
            const memstickPathForInstalled = romMemstickDir.replace(/\\/g, '/');
            await fs.writeFile(installedTxtPath, memstickPathForInstalled);
            console.log(`Created installed.txt pointing to: ${memstickPathForInstalled}`);

            // 4. Copy emulator's default memstick to ROM memstick (for configs)
            const defaultMemstickDir = path.join(ppssppDir, 'memstick');
            if (fsSync.existsSync(defaultMemstickDir)) {
                console.log(`Syncing emulator configs from: ${defaultMemstickDir}`);

                // Copy all folders except SAVEDATA
                const copyDir = async (src, dest) => {
                    try {
                        await fs.mkdir(dest, { recursive: true });
                        const entries = await fs.readdir(src, { withFileTypes: true });

                        for (const entry of entries) {
                            try {
                                const srcPath = path.join(src, entry.name);
                                const destPath = path.join(dest, entry.name);

                                if (entry.isDirectory()) {
                                    // Skip SAVEDATA directory - this is per-ROM
                                    if (entry.name === 'SAVEDATA') {
                                        console.log(`Skipping SAVEDATA - using ROM-specific directory`);
                                        continue;
                                    }
                                    await copyDir(srcPath, destPath);
                                } else {
                                    // Copy file if it doesn't exist or is newer
                                    let shouldCopy = !fsSync.existsSync(destPath);

                                    if (!shouldCopy) {
                                        const srcStat = await fs.stat(srcPath);
                                        const destStat = await fs.stat(destPath);
                                        shouldCopy = srcStat.mtime > destStat.mtime;
                                    }

                                    if (shouldCopy) {
                                        await fs.copyFile(srcPath, destPath);
                                        console.log(`Copied: ${entry.name}`);
                                    }
                                }
                            } catch (entryError) {
                                console.warn(`Failed to copy ${entry.name}: ${entryError.message}`);
                            }
                        }
                    } catch (dirError) {
                        console.warn(`Failed to process directory ${src}: ${dirError.message}`);
                    }
                };

                await copyDir(defaultMemstickDir, romMemstickDir);
                console.log(`Synced emulator configs to ROM memstick`);
            }

            // 5. Create a simple SAVEDATA directory (no game code extraction)
            const pspSaveDir = path.join(romMemstickDir, 'PSP', 'SAVEDATA');
            await fs.mkdir(pspSaveDir, { recursive: true });
            console.log(`ROM save directory: ${pspSaveDir} (Simple extraction - no game code)`);

            return { success: true, pspSaveDir, gameSaveDir: pspSaveDir, gameCode: 'GAME' };
        } catch (error) {
            console.error(`Failed to setup PPSSPP portable mode: ${error.message}`);
            return {
                success: false,
                error: `PPSSPP setup failed: ${error.message}`
            };
        }
    }

    async handleSaveSync(rom, saveDir, rommAPI, saveManager) {
        try {
            // Use simple SAVEDATA directory
            const pspSaveDir = path.join(saveDir, 'memstick', 'PSP', 'SAVEDATA');
            console.log(`Uploading saves from ${pspSaveDir} to RomM...`);

            const uploadResult = await saveManager.uploadSaveFromDirectory(rom.id, pspSaveDir, rommAPI, rom.name);
            if (uploadResult.success) {
                console.log(`Saves uploaded successfully: ${uploadResult.message}`);
            } else {
                console.warn(`Failed to upload saves: ${uploadResult.error}`);
            }

            return uploadResult;
        } catch (saveError) {
            console.error(`Error uploading saves: ${saveError.message}`);
            return {
                success: false,
                error: saveError.message
            };
        }
    }

    async getSaveComparison(rom, saveDir, rommAPI, saveManager) {
        try {
            // Use simple SAVEDATA directory (no game code subfolder)
            const pspSaveDir = path.join(saveDir, 'memstick', 'PSP', 'SAVEDATA');
            console.log(`Comparing local and cloud saves for ROM ${rom.id}...`);

            const compareResult = await saveManager.compareSaves(rom.id, pspSaveDir, rommAPI);

            if (compareResult.success) {
                const saveInfo = compareResult.data;
                console.log(`Save comparison:`, saveInfo.recommendation);

                return compareResult;
            }

            return compareResult;
        } catch (error) {
            console.error(`Error comparing saves for ROM ${rom.id}:`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async handleSaveChoice(romData, saveChoice, saveManager, rommAPI, saveId = null) {
        try {
            const { rom, emulatorPath, finalRomPath, saveDir, pspSaveDir, gameSaveDir, args, platform } = romData;

            // Use simple SAVEDATA directory (no game code subfolder)
            const targetSaveDir = path.join(saveDir, 'memstick', 'PSP', 'SAVEDATA');

            console.log(`User chose save: ${saveChoice}${saveId ? ` (ID: ${saveId})` : ''}`);
            console.log(`Target save directory: ${targetSaveDir}`);

            // Ensure the target directory exists
            await fs.mkdir(targetSaveDir, { recursive: true });

            // Handle save loading based on choice
            if (saveChoice === 'cloud') {
                console.log(`Loading cloud save${saveId ? ` #${saveId}` : ''}...`);
                const downloadResult = await saveManager.downloadSaveToDirectory(rom.id, targetSaveDir, rommAPI, saveId);
                if (downloadResult.success) {
                    console.log(`Cloud save loaded successfully`);
                } else {
                    console.warn(`Failed to load cloud save: ${downloadResult.error}`);
                }
            } else if (saveChoice === 'local') {
                console.log(`Using existing local save`);
            } else if (saveChoice === 'none') {
                console.log(`Starting with no save (fresh start)`);
                // Clear local save directory
                if (fsSync.existsSync(targetSaveDir)) {
                    const files = await fs.readdir(targetSaveDir, { recursive: true });
                    for (const file of files) {
                        const filePath = path.join(targetSaveDir, file);
                        try {
                            const stat = await fs.stat(filePath);
                            if (stat.isFile()) {
                                await fs.unlink(filePath);
                            }
                        } catch (err) {
                            console.warn(`Failed to delete ${filePath}: ${err.message}`);
                        }
                    }
                }
            }

            // Prepare emulator arguments
            const preparedArgs = this.prepareArgs(finalRomPath, saveDir);

            // Launch emulator
            console.log(`Launching emulator: ${emulatorPath} ${preparedArgs.join(' ')}`);
            const emulatorProcess = spawn(emulatorPath, preparedArgs, {
                detached: false,
                stdio: 'ignore'
            });

            // Monitor process to upload saves when it closes
            let saveUploaded = false; // Prevent duplicate uploads
            emulatorProcess.on('exit', async (code) => {
                console.log(`Emulator closed with code ${code}`);
                if (!saveUploaded) {
                    saveUploaded = true;
                    // Upload saves back to RomM
                    await this.handleSaveSync(rom, saveDir, rommAPI, saveManager);
                }
            });

            return {
                success: true,
                message: `ROM launched: ${rom.name}`,
                pid: emulatorProcess.pid,
                romPath: finalRomPath,
                saveDir: saveDir
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = PPSSPPEmulator;