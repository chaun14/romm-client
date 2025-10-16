const Emulator = require('./emulator');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

/**
 * Dolphin (Wii/GameCube) Emulator implementation
 */
class DolphinEmulator extends Emulator {
    constructor(config) {
        super({
            ...config,
            platform: 'wii',
            name: 'Dolphin',
            extensions: ['.iso', '.gcm', '.wbfs', '.ciso', '.gcz'],
            args: ['-u', '{userDir}', '-e', '{rom}']
        });
    }

    /**
     * Prepare emulator arguments by replacing placeholders
     * Override to handle custom user directory
     */
    prepareArgs(romPath, userDir) {
        return this.defaultArgs.map(arg =>
            arg.replace('{rom}', romPath)
                .replace('{userDir}', userDir)
                .replace('{save}', userDir) // For compatibility
        );
    }

    /**
     * Determine if a game is Wii or GameCube based on ROM metadata
     */
    isWiiGame(rom) {
        // Wii games typically have different region codes and metadata
        // For now, we'll use a simple heuristic based on file size and platform info
        // Wii games are generally larger and have different characteristics

        // Check platform info first
        if (rom.platform && rom.platform.toLowerCase().includes('wii')) {
            return true;
        }
        if (rom.platform && rom.platform.toLowerCase().includes('gamecube')) {
            return false;
        }

        // Check file size - Wii games are typically larger than GameCube games
        // Wii games are usually 4.7GB+, GameCube games are usually 1.4GB or less
        const fileSize = rom.file_size_bytes || rom.files?.[0]?.file_size_bytes || rom.file_size;
        if (fileSize && fileSize > 2000000000) { // 2GB threshold
            return true;
        }

        // Default to Wii for Dolphin (most common)
        return true;
    }

    async setupEnvironment(rom, saveDir, rommAPI, saveManager) {
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
        } catch (error) {
            console.error(`Failed to setup Dolphin environment: ${error.message}`);
            return {
                success: false,
                error: `Dolphin setup failed: ${error.message}`
            };
        }
    }

    async copySavesToRomDir(dolphinSaveDir, romSaveDir) {
        try {
            // Ensure ROM save directory exists
            await fs.mkdir(romSaveDir, { recursive: true });

            // Copy all files from Dolphin save directory to ROM save directory
            const copyDirRecursive = async (src, dest) => {
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
        } catch (error) {
            console.warn(`Failed to copy saves: ${error.message}`);
        }
    }

    async getSaveComparison(rom, saveDir, rommAPI, saveManager) {
        try {
            // Determine if this is a Wii or GameCube game
            const isWiiGame = this.isWiiGame(rom);

            // Compare saves in the entire Wii or GC directory
            const dolphinSaveDir = isWiiGame ?
                path.join(saveDir, 'Wii') :
                path.join(saveDir, 'GC');

            console.log(`Comparing local and cloud saves for ROM ${rom.id}...`);

            const compareResult = await saveManager.compareSaves(rom.id, dolphinSaveDir, rommAPI);

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

    async handleSaveSync(rom, saveDir, rommAPI, saveManager) {
        try {
            // Determine if this is a Wii or GameCube game
            const isWiiGame = this.isWiiGame(rom);

            // Upload the entire Wii or GC directory
            const dolphinSaveDir = isWiiGame ?
                path.join(saveDir, 'Wii') :
                path.join(saveDir, 'GC');

            console.log(`Uploading saves from ${dolphinSaveDir} to RomM...`);

            const uploadResult = await saveManager.uploadSaveFromDirectory(rom.id, dolphinSaveDir, rommAPI, rom.name);
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

    async handleSaveChoice(romData, saveChoice, saveManager, rommAPI, saveId = null) {
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
                const downloadResult = await saveManager.downloadSaveToDirectory(rom.id, dolphinSaveDir, rommAPI, saveId);
                if (downloadResult.success) {
                    console.log(`Cloud save loaded successfully`);
                } else {
                    console.warn(`Failed to load cloud save: ${downloadResult.error}`);
                }
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
                    await this.handleSaveSync(rom, saveDir, rommAPI, saveManager);
                });
            }

            return {
                success: true,
                message: `ROM launched: ${rom.name}`,
                pid: launchResult.process ? launchResult.process.pid : null,
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

    async clearSaveDirectories(directories) {
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
                        } catch (err) {
                            console.warn(`Failed to delete ${filePath}: ${err.message}`);
                        }
                    }
                } catch (error) {
                    console.warn(`Failed to clear directory ${dir}: ${error.message}`);
                }
            }
        }
    }
}

module.exports = DolphinEmulator;