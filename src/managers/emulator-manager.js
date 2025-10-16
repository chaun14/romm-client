const { spawn } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const CRC32 = require('crc-32');
const AdmZip = require('adm-zip');
const PPSSPPEmulator = require('./emulators/ppsspp-emulator');
const DolphinEmulator = require('./emulators/dolphin-emulator');

/**
 * Emulator Manager - Handles multiple emulator platforms using modular architecture
 */
class EmulatorManager {
    constructor() {
        this.supportedEmulators = {
            'ppsspp': {
                name: 'PPSSPP',
                class: PPSSPPEmulator,
                platforms: ['psp'],
                rommSlug: 'psp',
                defaultArgs: ['{rom}'],
                extensions: ['.iso', '.cso', '.pbp', '.elf'],
                supportsSaves: true
            },
            'dolphin': {
                name: 'Dolphin',
                class: DolphinEmulator,
                platforms: ['wii', 'gamecube'],
                rommSlug: 'wii', // Dolphin peut gérer Wii et GameCube, mais on utilise 'wii' comme slug principal
                defaultArgs: ['-e', '{rom}'],
                extensions: ['.iso', '.gcm', '.wbfs', '.ciso', '.gcz'],
                supportsSaves: true
            }
        };

        this.configPath = path.join(
            process.env.APPDATA || process.env.HOME,
            'romm-client',
            'emulators.json'
        );
        this.emulators = {};
        this.emulatorInstances = new Map();
        this.loadConfigurations();
    }

    /**
     * Find emulator that supports given platform
     */
    getEmulatorForPlatform(platform) {
        for (const [emulatorKey, emulator] of Object.entries(this.supportedEmulators)) {
            if (emulator.platforms.includes(platform)) {
                return { key: emulatorKey, config: emulator };
            }
        }
        return null;
    }

    async loadConfigurations() {
        try {
            const data = await fs.readFile(this.configPath, 'utf8');
            this.emulators = JSON.parse(data);
        } catch (error) {
            // File doesn't exist yet, create default config
            this.emulators = {
                'ppsspp': { path: '', args: ['{rom}'] },
                'dolphin': { path: '', args: ['-e', '{rom}'] }
            };
            await this.saveConfigurations();
        }
    }

    async saveConfigurations() {
        const configDir = path.dirname(this.configPath);
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(this.configPath, JSON.stringify(this.emulators, null, 2));
    }

    async configureEmulator(platform, emulatorPath, args = null) {
        const internalKey = this.getInternalKey(platform);
        if (!internalKey) {
            return { success: false, error: `Unsupported platform: ${platform}` };
        }

        // Use default args if not provided
        if (!args) {
            args = this.getDefaultArgs(internalKey);
        }

        this.emulators[internalKey] = {
            path: emulatorPath,
            args: args
        };
        await this.saveConfigurations();
        return { success: true };
    }

    getDefaultArgs(platform) {
        const internalKey = this.getInternalKey(platform);
        const emulator = this.supportedEmulators[internalKey];
        return emulator ? emulator.defaultArgs : ['{rom}'];
    }

    getEmulatorName(platform) {
        const internalKey = this.getInternalKey(platform);
        const emulator = this.supportedEmulators[internalKey];
        return emulator ? emulator.name : 'Unknown Emulator';
    }

    getEmulatorExtensions(platform) {
        const internalKey = this.getInternalKey(platform);
        const emulator = this.supportedEmulators[internalKey];
        return emulator ? emulator.extensions : [];
    }

    /**
     * Check if platform is supported by any emulator
     */
    isPlatformSupported(platform) {
        return this.getInternalKey(platform) !== null;
    }

    /**
     * Get internal key from RomM slug or platform
     */
    getInternalKey(platform) {
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

    /**
     * Return list of supported platforms
     */
    getSupportedPlatforms() {
        const platforms = [];
        for (const emulator of Object.values(this.supportedEmulators)) {
            platforms.push(...emulator.platforms);
        }
        return [...new Set(platforms)]; // Remove duplicates
    }

    /**
     * Return complete supported emulators info (IPC-safe)
     */
    getSupportedEmulators() {
        // Return IPC-safe version without class references
        const safeEmulators = {};
        for (const [key, emulator] of Object.entries(this.supportedEmulators)) {
            safeEmulators[key] = {
                name: emulator.name,
                platforms: emulator.platforms,
                rommSlug: emulator.rommSlug,
                defaultArgs: emulator.defaultArgs,
                extensions: emulator.extensions,
                supportsSaves: emulator.supportsSaves
            };
        }
        return safeEmulators;
    }

    getConfigurations() {
        return { success: true, data: this.emulators };
    }

    /**
     * Get or create emulator instance for a platform
     */
    getEmulatorInstance(platform) {
        const internalKey = this.getInternalKey(platform);
        if (!internalKey) {
            throw new Error(`Unsupported platform: ${platform}`);
        }

        if (!this.emulatorInstances.has(internalKey)) {
            const config = this.emulators[internalKey];
            if (!config) {
                throw new Error(`No emulator configured for platform: ${platform}`);
            }

            const emulatorConfig = this.supportedEmulators[internalKey];
            if (!emulatorConfig) {
                throw new Error(`Unsupported platform: ${platform}`);
            }

            const EmulatorClass = emulatorConfig.class;

            this.emulatorInstances.set(internalKey, new EmulatorClass({
                path: config.path,
                args: config.args,
                platform: internalKey,
                name: emulatorConfig.name,
                extensions: emulatorConfig.extensions
            }));
        }

        return this.emulatorInstances.get(internalKey);
    }

    /**
     * Extract ZIP recursively to find the actual ROM file (ISO, CSO, etc.)
     * Structure: downloaded.zip -> files/ -> game.iso OR game.zip -> game.iso
     */
    async extractRomFromZip(zipPath, extractDir, onProgress = null) {
        try {
            console.log(`Extracting ZIP: ${zipPath}`);

            // Skip ZIP files with 'Copy' in their name at the top level
            if (path.basename(zipPath).toLowerCase().includes('copy')) {
                console.log(`Skipping ZIP file with 'Copy' in name: ${zipPath}`);
                throw new Error(`Skipping corrupted ZIP file: ${path.basename(zipPath)}`);
            }

            const zip = new AdmZip(zipPath);
            const zipEntries = zip.getEntries();

            if (zipEntries.length === 0) {
                throw new Error(`ZIP file is empty: ${zipPath}`);
            }

            console.log(`ZIP contains ${zipEntries.length} entries`);

            if (onProgress) {
                onProgress({ step: 'extracting', message: `Analyzing ${zipEntries.length} files...`, percent: 10 });
            }

            // Look for files in the "files/" directory or root
            for (const [index, entry] of zipEntries.entries()) {
                const entryName = entry.entryName.toLowerCase();
                console.log(`Found in ZIP: ${entry.entryName} (${entry.isDirectory ? 'directory' : 'file'})`);

                // Update progress
                const progressPercent = 10 + (index / zipEntries.length) * 40;
                if (onProgress) {
                    onProgress({ step: 'extracting', message: `Processing ${entry.entryName}...`, percent: progressPercent });
                }

                // Check if it's a ROM file (ISO, CSO, etc.) or another ZIP
                const ext = path.extname(entryName);
                const isRomFile = ['.iso', '.cso', '.pbp', '.elf', '.gcm', '.wbfs', '.ciso', '.gcz'].includes(ext);
                const isZipFile = ext === '.zip';

                if (isRomFile) {
                    // Found the ROM file, extract it
                    const targetPath = path.join(extractDir, path.basename(entry.entryName));
                    console.log(`Extracting ROM file to: ${targetPath}`);

                    if (onProgress) {
                        onProgress({ step: 'extracting', message: `Extracting ROM file...`, percent: 60 });
                    }

                    zip.extractEntryTo(entry, extractDir, false, true);
                    console.log(`Successfully extracted ROM: ${targetPath}`);

                    if (onProgress) {
                        onProgress({ step: 'extracting', message: `ROM extracted successfully`, percent: 100 });
                    }

                    return targetPath;
                } else if (isZipFile) {
                    // Skip nested ZIP files with 'Copy' in their name
                    if (entryName.includes('copy')) {
                        console.log(`Skipping nested ZIP file with 'Copy' in name: ${entry.entryName}`);
                        continue;
                    }

                    // Found another ZIP, extract and recurse
                    const tempZipPath = path.join(extractDir, path.basename(entry.entryName));
                    console.log(`Found nested ZIP, extracting to: ${tempZipPath}`);

                    if (onProgress) {
                        onProgress({ step: 'extracting', message: `Extracting nested ZIP...`, percent: 70 });
                    }

                    zip.extractEntryTo(entry, extractDir, false, true);

                    // Recursively extract the nested ZIP
                    console.log(`Recursively extracting nested ZIP...`);
                    return await this.extractRomFromZip(tempZipPath, extractDir, onProgress);
                }
            }

            // If we get here, no ROM file was found
            const fileList = zipEntries.map(e => e.entryName).join(', ');
            throw new Error(`No ROM file found in ZIP. Files found: ${fileList}`);
        } catch (error) {
            console.error('Error extracting ZIP:', error.message);
            if (onProgress) {
                onProgress({ step: 'error', message: `Extraction failed: ${error.message}`, percent: 0 });
            }
            throw error;
        }
    }

    /**
     * Process downloaded ROM file - extract if ZIP, use directly if ROM file
     */
    async processRomFile(filePath, extractDir, onProgress = null) {
        try {
            // Check if the file is a ZIP by reading the first few bytes
            const buffer = Buffer.alloc(4);
            const fd = fsSync.openSync(filePath, 'r');
            fsSync.readSync(fd, buffer, 0, 4, 0);
            fsSync.closeSync(fd);

            // ZIP files start with 'PK\x03\x04'
            const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;

            if (isZip) {
                console.log(`[PROCESS] File is a ZIP archive, extracting...`);
                return await this.extractRomFromZip(filePath, extractDir, onProgress);
            } else {
                // Check if it's directly a ROM file by extension
                const ext = path.extname(filePath).toLowerCase();
                const isRomFile = ['.iso', '.cso', '.pbp', '.elf', '.gcm', '.wbfs', '.ciso', '.gcz'].includes(ext);

                if (isRomFile) {
                    console.log(`[PROCESS] File is directly a ROM file (${ext}), using as-is`);
                    // Copy the file to extract directory
                    const fileName = path.basename(filePath);
                    const targetPath = path.join(extractDir, fileName);

                    if (onProgress) {
                        onProgress({ step: 'extracting', message: `Copying ROM file...`, percent: 50 });
                    }

                    await fs.copyFile(filePath, targetPath);

                    if (onProgress) {
                        onProgress({ step: 'extracting', message: `ROM ready`, percent: 100 });
                    }

                    return targetPath;
                } else {
                    throw new Error(`Unsupported file type: ${ext}. Expected ZIP or ROM file.`);
                }
            }
        } catch (error) {
            console.error('Error processing ROM file:', error.message);
            if (onProgress) {
                onProgress({ step: 'error', message: `Processing failed: ${error.message}`, percent: 0 });
            }
            throw error;
        }
    }

    async launchRom(rom, customEmulatorPath = null, rommAPI = null, saveManager = null, onProgress = null, onSaveUploadSuccess = null) {
        try {
            const platform = rom.platform_slug || rom.platform;
            const internalKey = this.getInternalKey(platform);
            if (!internalKey) {
                return {
                    success: false,
                    error: `Unsupported platform: ${platform}`
                };
            }

            const emulatorConfig = this.emulators[internalKey];

            if (!emulatorConfig) {
                return {
                    success: false,
                    error: `No emulator configured for platform: ${platform}`
                };
            }

            const emulatorPath = customEmulatorPath || emulatorConfig.path;

            if (!emulatorPath) {
                return {
                    success: false,
                    error: `Emulator path not configured for: ${platform}`
                };
            }

            if (!rommAPI) {
                return {
                    success: false,
                    error: 'RomM API not initialized'
                };
            }

            if (!saveManager) {
                return {
                    success: false,
                    error: 'SaveManager not initialized'
                };
            }

            // Get the emulator instance
            const emulator = this.getEmulatorInstance(platform);
            emulator.setExecutablePath(emulatorPath);

            // Create cache directory for ROMs (use emulator name for better organization)
            const cacheDir = path.join(
                process.env.APPDATA || process.env.HOME,
                'romm-client',
                'roms',
                internalKey
            );
            await fs.mkdir(cacheDir, { recursive: true });

            // Determine the filename to use for the API download
            let apiFileName = rom.fs_name || rom.name;

            // If rom has files array, use the first file's name
            if (rom.files && rom.files.length > 0) {
                apiFileName = rom.files[0].file_name;
            }

            // Determine the correct extension for caching based on the original filename
            const originalExt = path.extname(apiFileName).toLowerCase();
            const isRomExtension = ['.iso', '.cso', '.pbp', '.elf', '.gcm', '.wbfs', '.ciso', '.gcz'].includes(originalExt);

            // Use ROM ID as base for cache filename to avoid conflicts
            const cacheBaseName = `rom_${rom.id}`;
            // If it's a direct ROM file, keep the original extension; otherwise assume it's a ZIP
            const cacheExt = isRomExtension ? originalExt : '.zip';
            const cachedFilePath = path.join(cacheDir, `${cacheBaseName}${cacheExt}`);

            // Check if we have the file in cache
            let finalRomPath = null;
            let needsDownload = !fsSync.existsSync(cachedFilePath);

            console.log(`[CACHE] Checking for cached file: ${cachedFilePath}`);
            console.log(`[CACHE] File exists: ${!needsDownload}`);

            // Download file if not in cache
            if (needsDownload) {
                console.log(`[DOWNLOAD] File not in cache, downloading: ${rom.name}...`);
                console.log(`  API endpoint: /api/roms/${rom.id}/content/${apiFileName}`);

                // Pass progress callback to downloadRom
                const downloadResult = await rommAPI.downloadRom(rom.id, apiFileName, onProgress);

                if (!downloadResult.success) {
                    return {
                        success: false,
                        error: `Download error: ${downloadResult.error}`
                    };
                }

                // Save the file to cache with correct extension
                await fs.writeFile(cachedFilePath, Buffer.from(downloadResult.data));
                console.log(`[CACHE] File saved to cache: ${cachedFilePath}`);
            } else {
                console.log(`[CACHE] Using cached file: ${cachedFilePath}`);
            }

            // Process the downloaded file (extract if ZIP, use directly if ROM)
            console.log(`[PROCESS] Processing downloaded file...`);
            try {
                // Create a temporary extraction directory for this launch
                const extractDir = path.join(cacheDir, `temp_extract_${rom.id}`);
                await fs.mkdir(extractDir, { recursive: true });

                finalRomPath = await this.processRomFile(cachedFilePath, extractDir, onProgress);
                console.log(`[PROCESS] ROM ready at: ${finalRomPath}`);

                // Add finalRomPath to rom object for use in save methods
                rom.finalRomPath = finalRomPath;

                // Apply integrity verification strategy based on file type
                if (rom.crc_hash || rom.md5_hash || rom.sha1_hash) {
                    // Check if the cached file is a ZIP or a raw ROM file
                    const buffer = Buffer.alloc(4);
                    const fd = fsSync.openSync(cachedFilePath, 'r');
                    fsSync.readSync(fd, buffer, 0, 4, 0);
                    fsSync.closeSync(fd);

                    const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
                    const isRomExtension = ['.iso', '.cso', '.pbp', '.elf', '.gcm', '.wbfs', '.ciso', '.gcz'].includes(path.extname(cachedFilePath).toLowerCase());

                    if (isZip) {
                        // ZIP file: warn but continue
                        console.log(`[VERIFY] ZIP file detected, checking integrity (warning only)...`);
                        try {
                            const verificationResult = await HashCalculator.verifyFileIntegrity(finalRomPath, rom);
                            if (!verificationResult.isValid) {
                                console.warn(`[VERIFY] ⚠️ ZIP file integrity check failed - hashes don't match expected values`);
                                console.warn(`[VERIFY] This may indicate the ROM file is different from what RomM expects`);
                                console.warn(`[VERIFY] Continuing with launch anyway...`);
                            } else {
                                console.log(`[VERIFY] ✅ ZIP file integrity verified`);
                            }
                        } catch (error) {
                            console.warn(`[VERIFY] Could not verify ZIP file integrity: ${error.message}`);
                        }
                    } else if (isRomExtension) {
                        // Raw ROM file: strict verification
                        console.log(`[VERIFY] Raw ROM file detected, performing strict integrity check...`);
                        try {
                            const verificationResult = await HashCalculator.verifyFileIntegrity(finalRomPath, rom);
                            if (!verificationResult.isValid) {
                                console.error(`[VERIFY] ❌ Raw ROM file integrity check failed - refusing to launch`);
                                console.error(`[VERIFY] Expected hashes don't match calculated hashes`);
                                console.error(`[VERIFY] This ROM file appears to be corrupted or modified`);

                                // Clean up and return error
                                try {
                                    await fs.rm(extractDir, { recursive: true, force: true });
                                } catch (cleanupError) {
                                    console.warn(`[VERIFY] Failed to clean up temp directory: ${cleanupError.message}`);
                                }

                                return {
                                    success: false,
                                    error: `ROM integrity verification failed. The file appears to be corrupted or doesn't match the expected ROM.`
                                };
                            } else {
                                console.log(`[VERIFY] ✅ Raw ROM file integrity verified - safe to launch`);
                            }
                        } catch (error) {
                            console.error(`[VERIFY] Error during strict integrity verification: ${error.message}`);

                            // Clean up and return error
                            try {
                                await fs.rm(extractDir, { recursive: true, force: true });
                            } catch (cleanupError) {
                                console.warn(`[VERIFY] Failed to clean up temp directory: ${cleanupError.message}`);
                            }

                            return {
                                success: false,
                                error: `ROM integrity verification failed: ${error.message}`
                            };
                        }
                    } else {
                        console.log(`[VERIFY] Unknown file type, skipping integrity verification`);
                    }
                } else {
                    console.log(`[VERIFY] No hash information available, skipping integrity verification`);
                }

            } catch (error) {
                return {
                    success: false,
                    error: `Failed to process ROM: ${error.message}`
                };
            }

            // Create a dedicated save directory for this ROM (use emulator name for better organization)
            const saveDir = path.join(
                process.env.APPDATA || process.env.HOME,
                'romm-client',
                'saves',
                internalKey,
                `rom_${rom.id}`
            );
            await fs.mkdir(saveDir, { recursive: true });
            console.log(`Save directory: ${saveDir}`);

            // Setup emulator environment using the modular approach
            const setupResult = await emulator.setupEnvironment(rom, saveDir, rommAPI, saveManager);
            if (!setupResult.success) {
                return setupResult;
            }

            // Check save comparison for platforms that support it
            let saveComparison = null;
            const supportedEmulator = this.supportedEmulators[internalKey];
            if (supportedEmulator && supportedEmulator.supportsSaves) {
                const comparisonResult = await emulator.getSaveComparison(rom, saveDir, rommAPI, saveManager);

                if (comparisonResult.success) {
                    saveComparison = comparisonResult.data;
                    console.log(`Save comparison:`, saveComparison.recommendation);

                    // Show choice modal if needed
                    const hasMultipleCloudSaves = saveComparison.cloudSaves && saveComparison.cloudSaves.length > 1;
                    const needsChoice = (saveComparison.hasLocal && saveComparison.hasCloud) || hasMultipleCloudSaves || saveComparison.hasCloud;

                    if (needsChoice) {
                        // Get emulator-specific setup info for save choice
                        const setupResult = await emulator.setupEnvironment(rom, saveDir, rommAPI, saveManager);
                        const setupData = setupResult.success ? setupResult : {};

                        return {
                            success: true,
                            needsSaveChoice: true,
                            saveComparison: saveComparison,
                            romData: {
                                rom,
                                finalRomPath,
                                saveDir,
                                platform: internalKey,  // Use internal key
                                ...setupData  // Include emulator-specific setup data
                            }
                        };
                    }
                }
            }

            // Launch the emulator
            const launchResult = await emulator.launch(finalRomPath, saveDir);

            // Monitor process to upload saves when it closes
            if (launchResult.process) {
                launchResult.process.on('exit', async (code) => {
                    console.log(`Emulator closed with code ${code}`);

                    // Upload saves back to RomM using the emulator's save sync method
                    const uploadResult = await emulator.handleSaveSync(rom, saveDir, rommAPI, saveManager);

                    // Notify success if callback provided
                    if (uploadResult.success && onSaveUploadSuccess) {
                        onSaveUploadSuccess(rom);
                    }
                });
            }

            return {
                success: true,
                message: `ROM launched: ${rom.name}`,
                pid: launchResult.process ? launchResult.process.pid : null,
                romPath: finalRomPath,
                saveDir: saveDir,
                saveComparison: saveComparison
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Check if ROM is cached (simplified - no integrity checks)
     */
    async checkRomCacheIntegrity(rom) {
        try {
            const platform = rom.platform_slug || rom.platform;
            const internalKey = this.getInternalKey(platform);
            const cacheDir = path.join(
                process.env.APPDATA || process.env.HOME,
                'romm-client',
                'roms',
                internalKey || platform
            );

            const cacheBaseName = `rom_${rom.id}`;
            const cachedZipPath = path.join(cacheDir, `${cacheBaseName}.zip`);

            const exists = fsSync.existsSync(cachedZipPath);
            if (!exists) {
                return {
                    success: true,
                    cached: false,
                    integrity: null
                };
            }

            // Just check existence, no integrity verification
            return {
                success: true,
                cached: true,
                integrity: null
            };
        } catch (error) {
            return {
                success: false,
                cached: false,
                integrity: null,
                error: error.message
            };
        }
    }
    async launchRomWithSaveChoice(romData, saveChoice, saveManager, rommAPI, saveId = null, onSaveUploadSuccess = null) {
        try {
            const { rom, finalRomPath, saveDir, platform } = romData;

            console.log(`User chose save: ${saveChoice}${saveId ? ` (ID: ${saveId})` : ''}`);

            // Get the emulator instance (recreate it since IPC strips methods)
            const emulator = this.getEmulatorInstance(platform);
            const emulatorConfig = this.emulators[platform];
            emulator.setExecutablePath(emulatorConfig.path);

            // Use the emulator's handleSaveChoice method
            const romDataWithPaths = {
                rom,
                emulatorPath: emulator.getExecutablePath(),
                finalRomPath,
                saveDir,
                platform
            };

            const result = await emulator.handleSaveChoice(romDataWithPaths, saveChoice, saveManager, rommAPI, saveId);

            // Monitor process to upload saves when it closes (if process exists)
            if (result.process && onSaveUploadSuccess) {
                result.process.on('exit', async (code) => {
                    console.log(`Emulator closed with code ${code}`);

                    // Upload saves back to RomM using the emulator's save sync method
                    const uploadResult = await emulator.handleSaveSync(rom, saveDir, rommAPI, saveManager);

                    // Notify success if callback provided
                    if (uploadResult.success && onSaveUploadSuccess) {
                        onSaveUploadSuccess(rom);
                    }
                });
            }

            return result;
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = EmulatorManager;

/**
 * Hash calculation utilities for ROM integrity verification
 */
class HashCalculator {
    /**
     * Calculate CRC32 hash of a file
     */
    static async calculateCRC32(filePath) {
        try {
            const data = await fs.readFile(filePath);

            // Use crc-32 package (returns signed 32-bit integer)
            const crcValue = CRC32.buf(data);

            // Convert signed to unsigned 32-bit integer
            const unsignedCrc = crcValue >>> 0;

            // Apply crc32_to_hex conversion (same as RomM)
            const crcHex = unsignedCrc.toString(16).toLowerCase().padStart(8, '0');

            console.log(`[CRC32] crc-32 result: ${crcValue} (signed), ${unsignedCrc} (unsigned), hex: ${crcHex}`);

            return crcHex;
        } catch (error) {
            throw new Error(`Failed to calculate CRC32 for ${filePath}: ${error.message}`);
        }
    }

    /**
     * Calculate MD5 hash of a file
     */
    static async calculateMD5(filePath) {
        try {
            const data = await fs.readFile(filePath);
            return crypto.createHash('md5').update(data).digest('hex');
        } catch (error) {
            throw new Error(`Failed to calculate MD5 for ${filePath}: ${error.message}`);
        }
    }

    /**
     * Calculate SHA1 hash of a file
     */
    static async calculateSHA1(filePath) {
        try {
            const data = await fs.readFile(filePath);
            return crypto.createHash('sha1').update(data).digest('hex');
        } catch (error) {
            throw new Error(`Failed to calculate SHA1 for ${filePath}: ${error.message}`);
        }
    }

    /**
     * Calculate all hashes for a file
     */
    static async calculateAllHashes(filePath) {
        try {
            const [crc32, md5, sha1] = await Promise.all([
                this.calculateCRC32(filePath),
                this.calculateMD5(filePath),
                this.calculateSHA1(filePath)
            ]);

            return {
                crc32,
                md5,
                sha1
            };
        } catch (error) {
            throw new Error(`Failed to calculate hashes for ${filePath}: ${error.message}`);
        }
    }

    /**
     * Verify file integrity against expected hashes
     */
    static async verifyFileIntegrity(filePath, expectedHashes) {
        try {
            console.log(`[VERIFY] Starting integrity verification for file: ${filePath}`);
            console.log(`[VERIFY] Expected hashes from RomM:`, {
                crc_hash: expectedHashes.crc_hash,
                md5_hash: expectedHashes.md5_hash,
                sha1_hash: expectedHashes.sha1_hash
            });

            const actualHashes = await this.calculateAllHashes(filePath);

            console.log(`[VERIFY] Calculated hashes for file:`, actualHashes);

            const results = {
                crc32: {
                    expected: expectedHashes.crc_hash,
                    actual: actualHashes.crc32,
                    valid: actualHashes.crc32 === expectedHashes.crc_hash || actualHashes.crc32.toUpperCase() === expectedHashes.crc_hash.toUpperCase()
                },
                md5: {
                    expected: expectedHashes.md5_hash,
                    actual: actualHashes.md5,
                    valid: actualHashes.md5 === expectedHashes.md5_hash || actualHashes.md5.toUpperCase() === expectedHashes.md5_hash.toUpperCase()
                },
                sha1: {
                    expected: expectedHashes.sha1_hash,
                    actual: actualHashes.sha1,
                    valid: actualHashes.sha1 === expectedHashes.sha1_hash || actualHashes.sha1.toUpperCase() === expectedHashes.sha1_hash.toUpperCase()
                }
            };

            console.log(`[VERIFY] Verification results:`, results);

            const isValid = results.crc32.valid || results.md5.valid || results.sha1.valid;

            console.log(`[VERIFY] Overall verification result: ${isValid ? 'VALID' : 'INVALID'}`);

            return {
                isValid,
                results,
                filePath
            };
        } catch (error) {
            console.error(`[VERIFY] Error during integrity verification: ${error.message}`);
            return {
                isValid: false,
                error: error.message,
                filePath
            };
        }
    }
}
