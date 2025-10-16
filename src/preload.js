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
        hasSavedSession: () => ipcRenderer.invoke('config:has-saved-session')
    },

    // ROMs
    roms: {
        fetchAll: () => ipcRenderer.invoke('roms:fetch-all'),
        search: (query) => ipcRenderer.invoke('roms:search', query),
        getByPlatform: (platform) => ipcRenderer.invoke('roms:get-by-platform', platform)
    },

    // Emulators
    emulator: {
        launch: (rom, emulatorPath) =>
            ipcRenderer.invoke('emulator:launch', { rom, emulatorPath }),
        launchWithSaveChoice: (romData, saveChoice, saveId) =>
            ipcRenderer.invoke('emulator:launch-with-save-choice', { romData, saveChoice, saveId }),
        configure: (platform, emulatorPath) =>
            ipcRenderer.invoke('emulator:configure', { platform, emulatorPath }),
        getConfigs: () => ipcRenderer.invoke('emulator:get-configs'),
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
    onDownloadProgress: (callback) => {
        ipcRenderer.on('download:progress', (event, progress) => callback(progress));
    },
    removeDownloadProgressListener: () => {
        ipcRenderer.removeAllListeners('download:progress');
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
    openRommWebInterface: (romId) => ipcRenderer.invoke('romm:open-web-interface', romId)
});

// Event listeners for notifications
contextBridge.exposeInMainWorld('electronEvents', {
    onSaveUploadSuccess: (callback) => {
        ipcRenderer.on('save:upload-success', (event, data) => callback(data));
    },
    removeSaveUploadSuccessListener: () => {
        ipcRenderer.removeAllListeners('save:upload-success');
    }
});
