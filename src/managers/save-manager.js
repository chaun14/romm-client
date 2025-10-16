const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

class SaveManager {
    constructor() {
        this.savesPath = path.join(
            process.env.APPDATA || process.env.HOME,
            'romm-client',
            'saves'
        );

        // Emulator-specific save directories (organized by emulator, not platform)
        this.emulatorSavePaths = {
            'ppsspp': [
                path.join(process.env.APPDATA || process.env.HOME, 'PPSSPP', 'PSP', 'SAVEDATA'),
                'memstick/PSP/SAVEDATA'  // Relative to PPSSPP folder
            ],
            'dolphin': [
                path.join(process.env.APPDATA || process.env.HOME, 'Dolphin Emulator', 'User', 'Wii', 'shared2', 'menu', 'F000'),
                path.join(process.env.APPDATA || process.env.HOME, 'Dolphin Emulator', 'User', 'GC')
            ]
        };

        this.initSavesDirectory();
    }

    async initSavesDirectory() {
        try {
            await fs.mkdir(this.savesPath, { recursive: true });
        } catch (error) {
            console.error('Error creating saves directory:', error);
        }
    }

    /**
     * Find save files for a specific ROM based on game code/ID
     * For PPSSPP: looks for folders matching the game code (e.g., UCUS98612)
     */
    async findEmulatorSaves(platform, gameCode) {
        try {
            // Map platform to emulator key for save directory lookup
            const emulatorKey = this.getEmulatorKeyForPlatform(platform);
            const saveDirs = this.emulatorSavePaths[emulatorKey] || [];
            const foundSaves = [];

            for (const saveDir of saveDirs) {
                if (!fsSync.existsSync(saveDir)) continue;

                const files = await fs.readdir(saveDir);

                // For PPSSPP, look for folders matching game code
                if (emulatorKey === 'ppsspp') {
                    for (const file of files) {
                        const filePath = path.join(saveDir, file);
                        const stats = await fs.stat(filePath);

                        if (stats.isDirectory() && file.includes(gameCode)) {
                            foundSaves.push({
                                path: filePath,
                                type: 'directory',
                                modified: stats.mtime
                            });
                        }
                    }
                } else {
                    // For other emulators, look for save files with matching name
                    for (const file of files) {
                        if (file.includes(gameCode)) {
                            const filePath = path.join(saveDir, file);
                            const stats = await fs.stat(filePath);
                            foundSaves.push({
                                path: filePath,
                                type: 'file',
                                modified: stats.mtime
                            });
                        }
                    }
                }
            }

            return foundSaves;
        } catch (error) {
            console.error('Error finding emulator saves:', error);
            return [];
        }
    }

    /**
     * Map platform to emulator key for save operations
     */
    getEmulatorKeyForPlatform(platform) {
        const platformToEmulator = {
            'psp': 'ppsspp',
            'wii': 'dolphin',
            'gamecube': 'dolphin'
        };
        return platformToEmulator[platform] || platform;
    }

    async downloadSave(romId, rommAPI) {
        try {
            // Get the list of saves for this ROM
            const result = await rommAPI.downloadSave(romId);

            if (!result.success) {
                return result;
            }

            const saves = result.data;
            if (!saves || saves.length === 0) {
                return {
                    success: false,
                    error: 'No saves found on server'
                };
            }

            // Take the most recent save
            const latestSave = saves[0];

            // Download the save file
            const saveFileResult = await rommAPI.downloadSaveFile(latestSave.id);

            if (!saveFileResult.success) {
                return saveFileResult;
            }

            const savePath = path.join(this.savesPath, `${romId}_${latestSave.file_name}`);
            await fs.writeFile(savePath, Buffer.from(saveFileResult.data));

            return {
                success: true,
                message: 'Save downloaded successfully',
                path: savePath,
                saveInfo: latestSave
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Download saves from RomM and extract to the emulator's SAVEDATA directory
     * For PSP: the targetDir should be the PSP/SAVEDATA directory
     * @param {number} saveId - Optional: specific save ID to download. If not provided, downloads most recent save.
     */
    async downloadSaveToDirectory(romId, targetDir, rommAPI, saveId = null) {
        try {
            console.log(`Downloading saves for ROM ${romId} to ${targetDir}${saveId ? ` (save ID: ${saveId})` : ''}`);

            // Always get the list of saves first to get full save information
            const result = await rommAPI.downloadSave(romId);

            if (!result.success) {
                return result;
            }

            const saves = result.data;
            if (!saves || saves.length === 0) {
                return {
                    success: false,
                    error: 'No saves found on server'
                };
            }

            let saveToDownload;

            if (saveId) {
                // Find the specific save by ID
                saveToDownload = saves.find(save => save.id === saveId);
                if (!saveToDownload) {
                    console.error(`Save ID ${saveId} not found in list of ${saves.length} saves`);
                    console.error('Available save IDs:', saves.map(s => s.id).join(', '));
                    return {
                        success: false,
                        error: `Save ID ${saveId} not found`
                    };
                }
                console.log(`Found specified save: ${saveToDownload.file_name} (${saveToDownload.emulator || 'unknown emulator'})`);
            } else {
                // Get the most recent save (first in the list)
                saveToDownload = saves[0];
                console.log(`Using most recent save: ${saveToDownload.file_name} (${saveToDownload.emulator || 'unknown emulator'})`);
            }

            // Download the save file - pass the entire save object which contains download_path
            const saveFileResult = await rommAPI.downloadSaveFile(saveToDownload);

            if (!saveFileResult.success) {
                return saveFileResult;
            }

            // Save file should be a ZIP containing the SAVEDATA folder structure
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(Buffer.from(saveFileResult.data));

            // Extract all files to the target directory
            zip.extractAllTo(targetDir, true);
            console.log(`Extracted save files to ${targetDir}`);

            return {
                success: true,
                message: `Save downloaded and extracted${saveToDownload.file_name ? `: ${saveToDownload.file_name}` : ''}`,
                saveInfo: saveToDownload
            };
        } catch (error) {
            console.error('Download save error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async uploadSave(romId, savePath, rommAPI, emulator = null) {
        try {
            console.log(`Uploading save: ${savePath}`);

            // API now handles the file upload directly
            const result = await rommAPI.uploadSave(romId, savePath, emulator);

            if (!result.success) {
                return result;
            }

            return {
                success: true,
                message: 'Save uploaded successfully',
                data: result.data
            };
        } catch (error) {
            console.error('Upload save error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Upload saves from emulator's SAVEDATA directory to RomM
     * For PSP: the sourceDir should be the PSP/SAVEDATA directory
     * Creates a ZIP of all save files before uploading
     */
    async uploadSaveFromDirectory(romId, sourceDir, rommAPI, romName = null) {
        try {
            console.log(`Uploading saves for ROM ${romId} from ${sourceDir}`);

            // Check if directory exists and has files
            if (!fsSync.existsSync(sourceDir)) {
                return {
                    success: false,
                    error: 'Save directory does not exist'
                };
            }

            const files = await fs.readdir(sourceDir, { recursive: true });
            const saveFiles = [];

            // Find all actual files (not directories)
            for (const file of files) {
                const filePath = path.join(sourceDir, file);
                const stat = await fs.stat(filePath);
                if (stat.isFile()) {
                    saveFiles.push(file);
                }
            }

            if (saveFiles.length === 0) {
                return {
                    success: false,
                    error: 'No save files found in directory'
                };
            }

            console.log(`Found ${saveFiles.length} save files to upload`);

            // Create a ZIP file with all saves
            const AdmZip = require('adm-zip');
            const zip = new AdmZip();

            for (const file of saveFiles) {
                const filePath = path.join(sourceDir, file);
                zip.addLocalFile(filePath, path.dirname(file));
            }

            // Create user-friendly ZIP filename with date and ROM name
            const now = new Date();
            const dateStr = now.toISOString().slice(0, 10); // 2025-10-14
            const timeStr = now.toTimeString().slice(0, 5).replace(':', 'h'); // 09h44

            // Sanitize ROM name for filename (remove invalid characters)
            const safeName = romName
                ? romName.replace(/[<>:"/\\|?*]/g, '').substring(0, 50)
                : `ROM_${romId}`;

            const zipFileName = `${dateStr} ${timeStr} - ${safeName}.zip`;
            const tempZipPath = path.join(this.savesPath, zipFileName);

            await fs.mkdir(this.savesPath, { recursive: true });
            zip.writeZip(tempZipPath);

            console.log(`Created save ZIP: ${zipFileName}`);

            // Upload the ZIP file
            const result = await rommAPI.uploadSave(romId, tempZipPath, 'ppsspp');

            // Clean up temp file
            try {
                await fs.unlink(tempZipPath);
            } catch (unlinkError) {
                console.warn(`Failed to delete temp ZIP: ${unlinkError.message}`);
            }

            if (!result.success) {
                return result;
            }

            return {
                success: true,
                message: `Uploaded ${saveFiles.length} save files`,
                data: result.data
            };
        } catch (error) {
            console.error('Upload save from directory error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async syncSave(romId, rommAPI) {
        try {
            // Find all local saves for this ROM
            const files = await fs.readdir(this.savesPath);
            const localSaves = files.filter(f => f.startsWith(`${romId}_`));

            let localSaveExists = false;
            let localSavePath = null;
            let localSaveTime = null;

            if (localSaves.length > 0) {
                // Take the most recent one
                localSavePath = path.join(this.savesPath, localSaves[0]);
                const stats = await fs.stat(localSavePath);
                localSaveExists = true;
                localSaveTime = stats.mtime;
            }

            // Get the list of saves from RomM
            const listResult = await rommAPI.downloadSave(romId);

            if (!listResult.success || !listResult.data || listResult.data.length === 0) {
                // No saves on the server
                if (localSaveExists) {
                    // Upload the local save
                    return this.uploadSave(romId, localSavePath, rommAPI);
                } else {
                    return {
                        success: false,
                        error: 'No saves found (local or remote)'
                    };
                }
            }

            const remoteSave = listResult.data[0]; // The most recent
            const remoteSaveTime = new Date(remoteSave.updated_at || remoteSave.created_at);

            // Compare dates if both exist
            if (localSaveExists && localSaveTime > remoteSaveTime) {
                // Local save is more recent, upload
                return this.uploadSave(romId, localSavePath, rommAPI, remoteSave.emulator);
            } else {
                // Remote save is more recent (or no local), download
                return this.downloadSave(romId, rommAPI);
            }
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getLocalSaves() {
        try {
            const files = await fs.readdir(this.savesPath);
            const saves = [];

            for (const file of files) {
                if (file.endsWith('.sav')) {
                    const filePath = path.join(this.savesPath, file);
                    const stats = await fs.stat(filePath);
                    saves.push({
                        romId: path.basename(file, '.sav'),
                        path: filePath,
                        size: stats.size,
                        modified: stats.mtime
                    });
                }
            }

            return { success: true, data: saves };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Compare local and cloud saves and return information about both
     * Returns object with local and cloud save info for user to choose
     */
    async compareSaves(romId, sourceDir, rommAPI) {
        try {
            const result = {
                hasLocal: false,
                hasCloud: false,
                localSave: null,
                cloudSaves: [],
                recommendation: null
            };

            // Check for local save files
            if (fsSync.existsSync(sourceDir)) {
                const files = await fs.readdir(sourceDir, { recursive: true });
                const saveFiles = [];
                let newestLocalTime = null;

                for (const file of files) {
                    const filePath = path.join(sourceDir, file);
                    try {
                        const stat = await fs.stat(filePath);
                        if (stat.isFile()) {
                            saveFiles.push(file);
                            if (!newestLocalTime || stat.mtime > newestLocalTime) {
                                newestLocalTime = stat.mtime;
                            }
                        }
                    } catch (statError) {
                        console.warn(`Failed to stat file ${filePath}: ${statError.message}`);
                    }
                }

                if (saveFiles.length > 0) {
                    result.hasLocal = true;
                    result.localSave = {
                        fileCount: saveFiles.length,
                        modified: newestLocalTime,
                        modifiedStr: newestLocalTime.toLocaleString()
                    };
                }
            }

            // Check for cloud saves
            const cloudResult = await rommAPI.downloadSave(romId);
            if (cloudResult.success && cloudResult.data && cloudResult.data.length > 0) {
                result.hasCloud = true;
                result.cloudSaves = cloudResult.data.map(save => ({
                    id: save.id,
                    fileName: save.file_name,
                    emulator: save.emulator,
                    size: save.file_size_bytes,
                    created: new Date(save.created_at),
                    updated: new Date(save.updated_at || save.created_at),
                    updatedStr: new Date(save.updated_at || save.created_at).toLocaleString()
                }));

                // Sort by date (most recent first)
                result.cloudSaves.sort((a, b) => b.updated - a.updated);
            }

            // Make recommendation
            if (result.hasLocal && result.hasCloud) {
                const newestCloud = result.cloudSaves[0].updated;
                const newestLocal = result.localSave.modified;

                if (newestLocal > newestCloud) {
                    result.recommendation = 'local';
                } else if (newestCloud > newestLocal) {
                    result.recommendation = 'cloud';
                } else {
                    result.recommendation = 'same';
                }
            } else if (result.hasLocal) {
                result.recommendation = 'local-only';
            } else if (result.hasCloud) {
                result.recommendation = 'cloud-only';
            } else {
                result.recommendation = 'none';
            }

            return {
                success: true,
                data: result
            };
        } catch (error) {
            console.error('Compare saves error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = SaveManager;
