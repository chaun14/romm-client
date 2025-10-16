const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const RommAPI = require('./api/romm-api');
const EmulatorManager = require('./managers/emulator-manager');
const SaveManager = require('./managers/save-manager');

let mainWindow;
let rommAPI;
let emulatorManager;
let saveManager;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, './assets/imgs/icon.png')
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

    // Open DevTools in development mode
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createRommWebWindow(romId = null) {
    // Get the base URL from RomM API
    const baseUrl = rommAPI.getBaseUrl();
    if (!baseUrl) {
        return { success: false, error: 'RomM URL not configured' };
    }

    // Create URL for specific ROM or main page
    const url = romId ? `${baseUrl}/rom/${romId}` : baseUrl;

    // Create new window
    const rommWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: 'persist:romm-session' // Use persistent session for cookies
        },
        icon: path.join(__dirname, '../assets/icon.png'),
        title: 'RomM Web Interface'
    });

    // Inject cookies before loading the page
    rommWindow.webContents.once('dom-ready', async () => {
        try {
            // Get session cookies from RomM API
            const sessionCookies = rommAPI.sessionCookie;
            if (sessionCookies) {
                // Parse and inject cookies
                const cookieStrings = sessionCookies.split('; ');
                for (const cookieStr of cookieStrings) {
                    const [nameValue] = cookieStr.split(';');
                    const [name, value] = nameValue.split('=');

                    if (name && value) {
                        // Get domain from base URL
                        const urlObj = new URL(baseUrl);
                        const domain = urlObj.hostname;

                        await rommWindow.webContents.session.cookies.set({
                            url: baseUrl,
                            name: name,
                            value: value,
                            domain: domain,
                            path: '/',
                            httpOnly: false,
                            secure: urlObj.protocol === 'https:'
                        });
                    }
                }
                console.log('RomM session cookies injected successfully');
            }

            // Also inject basic auth if available
            if (rommAPI.username && rommAPI.password) {
                const auth = Buffer.from(`${rommAPI.username}:${rommAPI.password}`).toString('base64');
                // Inject basic auth via JavaScript
                await rommWindow.webContents.executeJavaScript(`
                    // Override XMLHttpRequest to include basic auth
                    (function() {
                        const originalOpen = XMLHttpRequest.prototype.open;
                        XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
                            originalOpen.call(this, method, url, async, user, password);
                            if (url.startsWith('${baseUrl}')) {
                                this.setRequestHeader('Authorization', 'Basic ${auth}');
                            }
                        };
                    })();
                `);
                console.log('Basic auth injected for RomM requests');
            }

            // Refresh the page to apply cookies
            rommWindow.webContents.reload();
        } catch (error) {
            console.error('Failed to inject cookies:', error);
        }
    });

    // Load the RomM page
    rommWindow.loadURL(url);

    // Open DevTools in development mode
    if (process.argv.includes('--dev')) {
        rommWindow.webContents.openDevTools();
    }

    return { success: true };
}

app.whenReady().then(() => {
    // Initialize managers
    rommAPI = new RommAPI();
    emulatorManager = new EmulatorManager();
    saveManager = new SaveManager();

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC Handlers for renderer communication

// Console logging from renderer process
ipcMain.on('console-log', (event, { level, args }) => {
    const message = `[RENDERER ${level.toUpperCase()}] ${args.join(' ')}`;

    switch (level) {
        case 'error':
            console.error(message);
            break;
        case 'warn':
            console.warn(message);
            break;
        case 'info':
            console.info(message);
            break;
        case 'debug':
            console.debug(message);
            break;
        default:
            console.log(message);
    }
});

// RomM API Configuration
ipcMain.handle('config:set-romm-url', async (event, url) => {
    return rommAPI.setBaseUrl(url);
});

ipcMain.handle('config:set-credentials', async (event, { username, password, saveCredentials = true }) => {
    return rommAPI.setCredentials(username, password, saveCredentials);
});

ipcMain.handle('config:test-connection', async () => {
    return rommAPI.testConnection();
});

ipcMain.handle('config:logout', async () => {
    return rommAPI.logout();
});

ipcMain.handle('config:get-current-user', async () => {
    return rommAPI.getCurrentUser();
});

ipcMain.handle('config:get-base-url', async () => {
    return rommAPI.getBaseUrl();
});

ipcMain.handle('config:get-platform-image-url', async (event, slug) => {
    return rommAPI.getPlatformImageUrl(slug);
});

ipcMain.handle('config:start-oauth', async (event, url) => {
    // OAuth not implemented yet
    return { success: false, error: 'OAuth authentication is not yet implemented' };
});

ipcMain.handle('config:has-saved-credentials', async () => {
    return rommAPI.hasSavedCredentials();
});

ipcMain.handle('config:authenticate-with-saved-credentials', async () => {
    return rommAPI.authenticateWithSavedCredentials();
});

ipcMain.handle('config:has-saved-session', async () => {
    return rommAPI.hasSavedSession();
});

// ROM Management
ipcMain.handle('roms:fetch-all', async () => {
    return rommAPI.fetchRoms();
});

ipcMain.handle('roms:search', async (event, query) => {
    return rommAPI.searchRoms(query);
});

ipcMain.handle('roms:get-by-platform', async (event, platform) => {
    return rommAPI.getRomsByPlatform(platform);
});

// Emulator Launch
ipcMain.handle('emulator:launch', async (event, { rom, emulatorPath }) => {
    // Create progress callback to send updates to renderer
    const onProgress = (progress) => {
        event.sender.send('download:progress', progress);
    };

    // Create save upload success callback
    const onSaveUploadSuccess = (rom) => {
        event.sender.send('save:upload-success', { romId: rom.id, romName: rom.name });
    };

    return emulatorManager.launchRom(rom, emulatorPath, rommAPI, saveManager, onProgress, onSaveUploadSuccess);
});

ipcMain.handle('emulator:launch-with-save-choice', async (event, { romData, saveChoice, saveId }) => {
    // Create save upload success callback
    const onSaveUploadSuccess = (rom) => {
        event.sender.send('save:upload-success', { romId: rom.id, romName: rom.name });
    };

    return emulatorManager.launchRomWithSaveChoice(romData, saveChoice, saveManager, rommAPI, saveId, onSaveUploadSuccess);
});

ipcMain.handle('emulator:configure', async (event, { platform, emulatorPath }) => {
    return emulatorManager.configureEmulator(platform, emulatorPath);
});

ipcMain.handle('emulator:get-configs', async () => {
    return emulatorManager.getConfigurations();
});

ipcMain.handle('emulator:is-platform-supported', async (event, platform) => {
    return { success: true, data: emulatorManager.isPlatformSupported(platform) };
});

ipcMain.handle('emulator:get-supported-platforms', async () => {
    return { success: true, data: emulatorManager.getSupportedPlatforms() };
});

ipcMain.handle('emulator:get-supported-emulators', async () => {
    return { success: true, data: emulatorManager.getSupportedEmulators() };
});

// Save Management
ipcMain.handle('saves:download', async (event, romId) => {
    return saveManager.downloadSave(romId, rommAPI);
});

ipcMain.handle('saves:upload', async (event, { romId, savePath }) => {
    return saveManager.uploadSave(romId, savePath, rommAPI);
});

ipcMain.handle('saves:sync', async (event, romId) => {
    return saveManager.syncSave(romId, rommAPI);
});

// Platform Management
ipcMain.handle('platforms:fetch-all', async () => {
    return rommAPI.fetchPlatforms();
});

// Stats
ipcMain.handle('stats:fetch', async () => {
    return rommAPI.fetchStats();
});

// Cache and Save Status
ipcMain.handle('rom:check-cache', async (event, rom) => {
    const fs = require('fs');
    const path = require('path');

    try {
        const platform = rom.platform_slug || rom.platform;
        const internalKey = emulatorManager.getInternalKey(platform);
        const cacheDir = path.join(
            process.env.APPDATA || process.env.HOME,
            'romm-client',
            'roms',
            internalKey || platform
        );

        const cacheBaseName = `rom_${rom.id}`;
        const cachedZipPath = path.join(cacheDir, `${cacheBaseName}.zip`);

        return {
            success: true,
            cached: fs.existsSync(cachedZipPath)
        };
    } catch (error) {
        return {
            success: false,
            cached: false,
            error: error.message
        };
    }
});

// Check ROM cache with integrity verification
ipcMain.handle('rom:check-cache-integrity', async (event, rom) => {
    try {
        return await emulatorManager.checkRomCacheIntegrity(rom);
    } catch (error) {
        return {
            success: false,
            cached: false,
            integrity: null,
            error: error.message
        };
    }
});

// Delete cached ROM
ipcMain.handle('rom:delete-cache', async (event, rom) => {
    const fs = require('fs');
    const path = require('path');

    try {
        const platform = rom.platform_slug || rom.platform;
        const internalKey = emulatorManager.getInternalKey(platform);
        const cacheDir = path.join(
            process.env.APPDATA || process.env.HOME,
            'romm-client',
            'roms',
            internalKey || platform
        );

        const cacheBaseName = `rom_${rom.id}`;
        const cachedZipPath = path.join(cacheDir, `${cacheBaseName}.zip`);
        const extractedDirPath = path.join(cacheDir, cacheBaseName);

        // Delete the ZIP file if it exists
        if (fs.existsSync(cachedZipPath)) {
            fs.unlinkSync(cachedZipPath);
        }

        // Delete the extracted directory if it exists
        if (fs.existsSync(extractedDirPath)) {
            fs.rmSync(extractedDirPath, { recursive: true, force: true });
        }

        return {
            success: true
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
});

// Get cached ROM size on disk
ipcMain.handle('rom:get-cache-size', async (event, rom) => {
    const fs = require('fs');
    const path = require('path');

    try {
        const platform = rom.platform_slug || rom.platform;
        const internalKey = emulatorManager.getInternalKey(platform);
        const cacheDir = path.join(
            process.env.APPDATA || process.env.HOME,
            'romm-client',
            'roms',
            internalKey || platform
        );

        const cacheBaseName = `rom_${rom.id}`;
        const cachedZipPath = path.join(cacheDir, `${cacheBaseName}.zip`);
        const extractedDirPath = path.join(cacheDir, cacheBaseName);

        let totalSize = 0;

        // Check if ZIP file exists (this is what takes disk space for "installed" ROMs)
        if (fs.existsSync(cachedZipPath)) {
            const stats = fs.statSync(cachedZipPath);
            totalSize = stats.size;
        }

        return {
            success: true,
            size: totalSize
        };
    } catch (error) {
        return {
            success: false,
            size: 0,
            error: error.message
        };
    }
});

ipcMain.handle('rom:check-saves', async (event, rom) => {
    try {
        const platform = rom.platform_slug || rom.platform;
        const internalKey = emulatorManager.getInternalKey(platform);
        const fs = require('fs');
        const path = require('path');

        // Check local saves
        const saveDir = path.join(
            process.env.APPDATA || process.env.HOME,
            'romm-client',
            'saves',
            internalKey || platform,
            `rom_${rom.id}`
        );

        let hasLocal = false;
        if (fs.existsSync(saveDir)) {
            const files = fs.readdirSync(saveDir, { recursive: true });
            hasLocal = files.some(file => {
                const filePath = path.join(saveDir, file);
                const stats = fs.statSync(filePath);
                return stats.isFile();
            });
        }

        // Check cloud saves
        let hasCloud = false;
        const cloudResult = await rommAPI.downloadSave(rom.id);
        if (cloudResult.success && cloudResult.data && cloudResult.data.length > 0) {
            hasCloud = true;
        }

        return {
            success: true,
            hasSaves: hasLocal || hasCloud,
            hasLocal,
            hasCloud
        };
    } catch (error) {
        return {
            success: false,
            hasSaves: false,
            error: error.message
        };
    }
});

// Open RomM Web Interface
ipcMain.handle('romm:open-web-interface', async (event, romId) => {
    return createRommWebWindow(romId);
});

// Auto-updater configuration
autoUpdater.autoDownload = false; // Don't auto-download, wait for user confirmation
autoUpdater.autoInstallOnAppQuit = true;

// Check for updates on app ready (skip in dev mode)
app.whenReady().then(() => {
    if (!process.argv.includes('--dev')) {
        setTimeout(() => {
            autoUpdater.checkForUpdates();
        }, 3000); // Check 3 seconds after startup
    }
});

// Auto-updater events
autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    if (mainWindow) {
        mainWindow.webContents.send('update-available', {
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes
        });
    }
});

autoUpdater.on('update-not-available', (info) => {
    console.log('No updates available');
});

autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow) {
        mainWindow.webContents.send('update-download-progress', {
            percent: progressObj.percent,
            transferred: progressObj.transferred,
            total: progressObj.total
        });
    }
});

autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    if (mainWindow) {
        mainWindow.webContents.send('update-downloaded', {
            version: info.version
        });
    }
});

autoUpdater.on('error', (error) => {
    console.error('Update error:', error);
    if (mainWindow) {
        mainWindow.webContents.send('update-error', {
            message: error.message
        });
    }
});

// IPC handlers for updates
ipcMain.handle('update:check', async () => {
    try {
        const result = await autoUpdater.checkForUpdates();
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('update:download', async () => {
    try {
        await autoUpdater.downloadUpdate();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true);
});

