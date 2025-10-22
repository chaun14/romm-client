const { contextBridge, ipcRenderer } = require('electron');

// Create a custom console that sends logs to main process
const originalConsole = { ...console };

const createConsoleProxy = () => {
    const proxyConsole = {};

    ['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
        proxyConsole[level] = (...args) => {
            // Send to main process for terminal logging
            ipcRenderer.send('console-log', {
                level,
                args: args.map(arg =>
                    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                )
            });

            // Also call original console for DevTools
            originalConsole[level](...args);
        };
    });

    return proxyConsole;
};

// Override global console
global.console = createConsoleProxy();

// Securely expose APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Configuration
    config: {
        setRommUrl: (url) => ipcRenderer.invoke('config:set-romm-url', url),
        setCredentials: (username, password, saveCredentials = true) =>
            ipcRenderer.invoke('config:set-credentials', { username, password, saveCredentials }),
        testConnection: () => ipcRenderer.invoke('config:test-connection'),
        logout: () => ipcRenderer.invoke('config:logout'),
        getCurrentUser: () => ipcRenderer.invoke('config:get-current-user'),
        getBaseUrl: () => ipcRenderer.invoke('config:get-base-url'),
        getPlatformImageUrl: (slug) => ipcRenderer.invoke('config:get-platform-image-url', slug),
        startOAuth: (url) => ipcRenderer.invoke('config:start-oauth', url),
        hasSavedCredentials: () => ipcRenderer.invoke('config:has-saved-credentials'),
        authenticateWithSavedCredentials: () => ipcRenderer.invoke('config:authenticate-with-saved-credentials'),
        hasSavedSession: () => ipcRenderer.invoke('config:has-saved-session'),
        authenticateWithSavedSession: () => ipcRenderer.invoke('config:authenticate-with-saved-session'),
        getVersion: () => ipcRenderer.invoke('config:get-version')
    },

    // Login completion
    loginComplete: () => ipcRenderer.send('login-complete'),

    // ROMs
    roms: {
        fetchAll: () => ipcRenderer.invoke('roms:fetch-all'),
        fetchLocal: () => ipcRenderer.invoke('roms:fetch-local'),
        search: (query, platformId, limit, offset) => ipcRenderer.invoke('roms:search', query, platformId, limit, offset),
        getByPlatform: (platform, limit = null, offset = 0) => ipcRenderer.invoke('roms:get-by-platform', { platform, limit, offset }),
        launch: (rom, emulatorPath) =>
            ipcRenderer.invoke('roms:launch', { rom, emulatorPath }),
        getNoCacheMode: () => ipcRenderer.invoke('roms:noCachedMode')
    },

    // Emulators
    emulator: {
        launchWithSaveChoice: (romData, saveChoice, saveId) =>
            ipcRenderer.invoke('emulator:launch-with-save-choice', { romData, saveChoice, saveId }),
        configure: (platform, emulatorPath) =>
            ipcRenderer.invoke('emulator:configure', { platform, emulatorPath }),
        configureEmulator: (emulatorKey, emulatorPath) =>
            ipcRenderer.invoke('emulator:configure-emulator', { emulatorKey, emulatorPath }),
        getConfigs: () => ipcRenderer.invoke('emulator:get-configs'),
        saveConfig: (emulatorKey, path) => ipcRenderer.invoke('emulator:saveConfig', { emulatorKey, path }),
        isPlatformSupported: (platform) => ipcRenderer.invoke('emulator:is-platform-supported', platform),
        getSupportedPlatforms: () => ipcRenderer.invoke('emulator:get-supported-platforms'),
        getSupportedEmulators: () => ipcRenderer.invoke('emulator:get-supported-emulators')
    },

    // Sauvegardes
    saves: {
        download: (romId) => ipcRenderer.invoke('saves:download', romId),
        upload: (romId, savePath) =>
            ipcRenderer.invoke('saves:upload', { romId, savePath }),
        sync: (romId) => ipcRenderer.invoke('saves:sync', romId)
    },

    // Plateformes
    platforms: {
        fetchAll: () => ipcRenderer.invoke('platforms:fetch-all')
    },

    // Stats
    stats: {
        fetch: () => ipcRenderer.invoke('stats:fetch')
    },

    // Download progress listener
    onRomDownloadProgress: (callback) => {
        // console.log('[PRELOAD] Setting up rom:download-progress listener');
        ipcRenderer.on('rom:download-progress', (event, progress) => {
            //  console.log('[PRELOAD] Received rom:download-progress event:', progress);
            callback(progress);
        });
    },
    removeDownloadProgressListener: () => {
        ipcRenderer.removeAllListeners('rom:download-progress');
    },

    // Download complete listener
    onDownloadComplete: (callback) => {
        ipcRenderer.on('rom:download-complete', (event, data) => callback(data));
    },
    removeDownloadCompleteListener: () => {
        ipcRenderer.removeAllListeners('rom:download-complete');
    },

    // Cache and save status
    checkRomCache: (rom) => ipcRenderer.invoke('rom:check-cache', rom),
    checkRomCacheIntegrity: (rom) => ipcRenderer.invoke('rom:check-cache-integrity', rom),
    checkRomSaves: (rom) => ipcRenderer.invoke('rom:check-saves', rom),

    // Delete cached ROM
    deleteCachedRom: (rom) => ipcRenderer.invoke('rom:delete-cache', rom),

    // Get cached ROM size on disk
    getRomCacheSize: (rom) => ipcRenderer.invoke('rom:get-cache-size', rom),

    // Open RomM Web Interface
    openRommWebInterface: (romId) => ipcRenderer.invoke('romm:open-web-interface', romId),

    // Updates
    updates: {
        check: () => ipcRenderer.invoke('update:check'),
        download: () => ipcRenderer.invoke('update:download'),
        install: () => ipcRenderer.invoke('update:install')
    }
});

// Event listeners for notifications
contextBridge.exposeInMainWorld('electronEvents', {
    // Initialization events
    onInitStatus: (callback) => {
        ipcRenderer.on('init-status', (event, data) => callback(event, data));
    },
    onInitError: (callback) => {
        ipcRenderer.on('init-error', (event, data) => callback(event, data));
    },
    onInitComplete: (callback) => {
        ipcRenderer.on('init-complete', (event) => callback(event));
    },
    removeInitListeners: () => {
        ipcRenderer.removeAllListeners('init-status');
        ipcRenderer.removeAllListeners('init-error');
        ipcRenderer.removeAllListeners('init-complete');
    },

    onSaveUploadSuccess: (callback) => {
        ipcRenderer.on('save:upload-success', (event, data) => callback(data));
    },
    removeSaveUploadSuccessListener: () => {
        ipcRenderer.removeAllListeners('save:upload-success');
    },

    // Save choice modal events
    onSaveChoiceModal: (callback) => {
        ipcRenderer.on('save:show-choice-modal', (event, data) => callback(data));
    },
    sendSaveChoice: (choice, saveId) => {
        ipcRenderer.send('save:choice-selected', { choice, saveId });
    },
    removeSaveChoiceListener: () => {
        ipcRenderer.removeAllListeners('save:show-choice-modal');
    },

    // ROM launch events
    onRomLaunched: (callback) => {
        ipcRenderer.on('rom:launched', (event, data) => callback(data));
    },
    onRomLaunchFailed: (callback) => {
        ipcRenderer.on('rom:launch-failed', (event, data) => callback(data));
    },
    removeRomLaunchListeners: () => {
        ipcRenderer.removeAllListeners('rom:launched');
        ipcRenderer.removeAllListeners('rom:launch-failed');
    },

    // Update events
    onUpdateAvailable: (callback) => {
        ipcRenderer.on('update-available', (event, data) => callback(data));
    },
    onUpdateDownloadProgress: (callback) => {
        ipcRenderer.on('update-download-progress', (event, data) => callback(data));
    },
    onUpdateDownloaded: (callback) => {
        ipcRenderer.on('update-downloaded', (event, data) => callback(data));
    },
    onUpdateError: (callback) => {
        ipcRenderer.on('update-error', (event, data) => callback(data));
    },
    removeUpdateListeners: () => {
        ipcRenderer.removeAllListeners('update-available');
        ipcRenderer.removeAllListeners('update-download-progress');
        ipcRenderer.removeAllListeners('update-downloaded');
        ipcRenderer.removeAllListeners('update-error');
    }
});
