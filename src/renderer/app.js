// État de l'application
let currentRoms = [];
let currentPlatforms = [];
let selectedRom = null;
let currentUser = null;
let currentPlatformId = null;

// Cache status for ROMs
let romCacheStatus = new Map();
let romSaveStatus = new Map();

// Download state
let isDownloading = false;

// Track loaded views to avoid reloading
let loadedViews = {
    platforms: false,
    installed: false,
    emulators: false
};

// Navigation between views
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        const viewName = item.dataset.view;

        // Update navigation buttons
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');

        // Display the view
        document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
        document.getElementById(`${viewName}-view`).classList.add('active');

        // Reset platform view when switching views
        if (viewName === 'platforms') {
            showPlatformsList();
            if (!loadedViews.platforms) {
                loadPlatforms();
                loadedViews.platforms = true;
            }
        } else if (viewName === 'installed') {
            // Always load installed ROMs when switching to this view (will use cache if available)
            loadInstalledRoms();
        } else if (viewName === 'emulators') {
            if (!loadedViews.emulators) {
                loadEmulatorsConfig();
                loadedViews.emulators = true;
            }
        }
    });
});

// Settings
document.getElementById('test-connection-btn').addEventListener('click', async () => {
    const url = document.getElementById('romm-url').value;

    if (!url) {
        showResult('Please enter a URL', 'error');
        return;
    }

    await window.electronAPI.config.setRommUrl(url);
    const result = await window.electronAPI.config.testConnection();

    if (result.success) {
        showResult('Connection successful!', 'success');
        updateConnectionStatus(true);

        // Store auth method for next step
        const authMethod = result.data?.auth_method || 'password';
        document.getElementById('romm-url').dataset.authMethod = authMethod;

        // Enable the Next button
        document.getElementById('next-to-auth-btn').disabled = false;
        document.getElementById('next-to-auth-btn').classList.remove('btn-disabled');
    } else {
        showResult(`Error: ${result.error}`, 'error');
        updateConnectionStatus(false);

        // Keep Next button disabled on connection failure
        document.getElementById('next-to-auth-btn').disabled = true;
        document.getElementById('next-to-auth-btn').classList.add('btn-disabled');
    }
});

document.getElementById('next-to-auth-btn').addEventListener('click', () => {
    const url = document.getElementById('romm-url').value;
    const authMethod = document.getElementById('romm-url').dataset.authMethod;

    if (!url) {
        showResult('Please enter a URL first', 'error');
        return;
    }

    if (!authMethod) {
        showResult('Please test the connection first', 'error');
        return;
    }

    // Move to auth step
    document.getElementById('server-url-step').classList.remove('active');
    document.getElementById('auth-step').classList.add('active');

    // Configure auth form based on method
    if (authMethod === 'oauth') {
        document.getElementById('auth-description').textContent = 'OAuth authentication will open in a new window.';
        document.getElementById('password-auth-form').style.display = 'none';
        document.getElementById('oauth-auth-form').style.display = 'block';
    } else {
        document.getElementById('auth-description').textContent = 'Enter your credentials to connect to RomM.';
        document.getElementById('password-auth-form').style.display = 'block';
        document.getElementById('oauth-auth-form').style.display = 'none';
    }
});

document.getElementById('back-to-url-btn').addEventListener('click', () => {
    document.getElementById('auth-step').classList.remove('active');
    document.getElementById('server-url-step').classList.add('active');

    // Reset Next button to disabled when going back
    document.getElementById('next-to-auth-btn').disabled = true;
    document.getElementById('next-to-auth-btn').classList.add('btn-disabled');
});

document.getElementById('back-to-url-oauth-btn').addEventListener('click', () => {
    document.getElementById('auth-step').classList.remove('active');
    document.getElementById('server-url-step').classList.add('active');

    // Reset Next button to disabled when going back
    document.getElementById('next-to-auth-btn').disabled = true;
    document.getElementById('next-to-auth-btn').classList.add('btn-disabled');
});

document.getElementById('start-oauth-btn').addEventListener('click', async () => {
    const url = document.getElementById('romm-url').value;

    try {
        // Start OAuth flow
        const result = await window.electronAPI.config.startOAuth(url);

        if (result.success) {
            showResult('OAuth window opened. Complete authentication in the new window.', 'success');

            // Listen for OAuth completion
            window.electronAPI.onOAuthComplete(async (authResult) => {
                if (authResult.success) {
                    showResult('OAuth authentication successful!', 'success');

                    // Load user info
                    await loadCurrentUser();

                    // Move to connected state
                    document.getElementById('auth-step').classList.remove('active');
                    document.getElementById('connected-state').classList.add('active');
                } else {
                    showResult(`OAuth failed: ${authResult.error}`, 'error');
                }
            });
        } else {
            showResult(`Failed to start OAuth: ${result.error}`, 'error');
        }
    } catch (error) {
        showResult(`Error: ${error.message}`, 'error');
    }
});

document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const url = document.getElementById('romm-url').value;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (!url || !username || !password) {
        showResult('Please fill in all fields', 'error');
        return;
    }

    // Show consent modal before saving credentials
    showConsentModal(url, username, password);
});

// Settings logout button
document.getElementById('settings-logout-btn').addEventListener('click', async () => {
    const result = await window.electronAPI.config.logout();

    if (result.success) {
        showNotification('Logged out successfully', 'success');
        currentUser = null;
        updateConnectionStatus(false);

        // Clear data
        currentRoms = [];
        currentPlatforms = [];
        displayRoms([]);
        displayPlatforms([]);

        // Reset to server URL step
        document.getElementById('connected-state').classList.remove('active');
        document.getElementById('server-url-step').classList.add('active');

        // Reset Next button to disabled when logging out
        document.getElementById('next-to-auth-btn').disabled = true;
        document.getElementById('next-to-auth-btn').classList.add('btn-disabled');
    } else {
        showNotification(`Logout error: ${result.error}`, 'error');
    }
});

function showResult(message, type) {
    const resultDiv = document.getElementById('connection-result');
    resultDiv.textContent = message;
    resultDiv.className = `result-message show ${type}`;

    setTimeout(() => {
        resultDiv.classList.remove('show');
    }, 5000);
}

async function loadCurrentUser() {
    const result = await window.electronAPI.config.getCurrentUser();

    if (result.success) {
        currentUser = result.data;
        updateConnectionStatus(true);

        // Update connected state UI
        document.getElementById('user-info-connected').innerHTML = `
            <p><strong>Username:</strong> ${currentUser.username}</p>
            <p><strong>Role:</strong> ${currentUser.role}</p>
            <p><strong>Server:</strong> ${document.getElementById('romm-url').value}</p>
        `;

        return true;
    } else {
        currentUser = null;
        updateConnectionStatus(false);
        return false;
    }
}

function updateConnectionStatus(connected) {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    const userInfo = document.getElementById('user-info');
    const usernameDisplay = document.getElementById('username-display');

    // Prevent redundant updates
    if ((connected && indicator.className === 'status-dot connected') ||
        (!connected && indicator.className === 'status-dot disconnected')) {
        return;
    }

    if (connected && currentUser) {
        indicator.className = 'status-dot connected';
        text.textContent = 'Connected';

        // Show user info
        userInfo.style.display = 'flex';
        usernameDisplay.textContent = `${currentUser.username} (${currentUser.role})`;
    } else {
        indicator.className = 'status-dot disconnected';
        text.textContent = 'Disconnected';

        // Hide user info
        userInfo.style.display = 'none';
        usernameDisplay.textContent = '';
    }
}

// Search ROMs within current platform
document.getElementById('search-btn').addEventListener('click', searchRoms);
document.getElementById('search-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchRoms();
    }
});

async function searchRoms() {
    const query = document.getElementById('search-input').value;

    if (!query || !currentPlatformId) {
        // Reload current platform ROMs
        if (currentPlatformId) {
            const platform = currentPlatforms.find(p => p.id === currentPlatformId);
            await loadRomsForPlatform(currentPlatformId, platform);
        }
        return;
    }

    // Filter current ROMs by search query
    const filteredRoms = currentRoms.filter(rom => {
        const searchText = query.toLowerCase();
        return (rom.name?.toLowerCase().includes(searchText) ||
            rom.fs_name?.toLowerCase().includes(searchText));
    });

    // Clear cache status for filtered ROMs to force refresh
    filteredRoms.forEach(rom => {
        romCacheStatus.delete(rom.id);
        romSaveStatus.delete(rom.id);
    });

    displayRoms(filteredRoms);
}

async function displayRoms(roms) {
    const grid = document.getElementById('roms-grid');

    if (!roms || roms.length === 0) {
        grid.innerHTML = '<p class="empty-state">No ROMs found</p>';
        return;
    }

    // Get emulator configurations and supported emulators
    const [configsResult, supportedResult] = await Promise.all([
        window.electronAPI.emulator.getConfigs(),
        window.electronAPI.emulator.getSupportedEmulators()
    ]);

    const emulatorConfigs = configsResult.success ? configsResult.data : {};
    const supportedEmulators = supportedResult.success ? supportedResult.data : {};

    // Check cache and save status for all ROMs
    const romsWithStatus = await Promise.all(roms.map(async (rom) => {
        const [isCached, hasSaves] = await Promise.all([
            checkRomCacheStatus(rom),
            checkRomSaveStatus(rom)
        ]);

        // Check if platform is supported and configured
        const platform = rom.platform_slug || rom.platform;
        let isPlatformSupported = false;
        let isEmulatorConfigured = false;
        let emulatorMessage = '';

        // Find emulator for this platform
        for (const [emulatorKey, emulator] of Object.entries(supportedEmulators)) {
            if (emulator.platforms.includes(platform)) {
                isPlatformSupported = true;
                if (emulatorConfigs[emulatorKey] && emulatorConfigs[emulatorKey].path) {
                    isEmulatorConfigured = true;
                } else {
                    emulatorMessage = `Please configure ${emulator.name} emulator`;
                }
                break;
            }
        }

        if (!isPlatformSupported) {
            emulatorMessage = 'Platform not supported';
        }

        return {
            ...rom,
            isCached,
            hasSaves,
            isPlatformSupported,
            isEmulatorConfigured,
            emulatorMessage
        };
    }));

    // Sort ROMs: Downloaded first, then by name
    const sortedRoms = romsWithStatus.sort((a, b) => {
        // Downloaded ROMs first
        if (a.isCached && !b.isCached) return -1;
        if (!a.isCached && b.isCached) return 1;

        // Then by name
        return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
    });

    // Get base URL for images
    const baseUrl = await window.electronAPI.config.getBaseUrl();

    grid.innerHTML = sortedRoms.map(rom => {
        // Use path_cover_small or url_cover for cover image
        const coverUrl = rom.path_cover_small
            ? `${baseUrl}${rom.path_cover_small}`
            : rom.url_cover || '';

        // Status icons
        const statusIcons = [];
        if (rom.isCached) {
            statusIcons.push('<span class="status-icon cached" title="Downloaded">💾</span>');
        }
        if (rom.hasSaves) {
            statusIcons.push('<span class="status-icon played" title="Already played">🎮</span>');
        }

        // Determine button state and text
        let buttonClass = 'btn-primary';
        let buttonText = rom.isCached ? '🎮 Launch' : '⬇️ Download';
        let buttonDisabled = '';
        let buttonTitle = '';

        if (!rom.isCached && (!rom.isPlatformSupported || !rom.isEmulatorConfigured)) {
            buttonClass = 'btn-disabled';
            buttonDisabled = 'disabled';
            buttonTitle = `title="${rom.emulatorMessage}"`;
            buttonText = '⬇️ Download';
        }

        return `
      <div class="rom-card ${rom.isCached ? 'cached' : ''}" data-rom-id="${rom.id}">
        <div class="rom-cover">
          ${coverUrl ? `<img src="${coverUrl}" alt="${rom.name}" onerror="this.parentElement.innerHTML='🎮'">` : '🎮'}
          ${statusIcons.length > 0 ? `<div class="rom-status-icons">${statusIcons.join('')}</div>` : ''}
        </div>
        <div class="rom-info">
          <h3 title="${rom.name}">${rom.name}</h3>
          <p>${rom.platform_display_name || rom.platform_name || 'Unknown'}</p>
          <p class="rom-size">${formatFileSize(rom.file_size_bytes || rom.files?.[0]?.file_size_bytes)}</p>
        </div>
        <div class="rom-actions">
          <button class="${buttonClass}" ${buttonDisabled} ${buttonTitle} data-rom-id="${rom.id}">${buttonText}</button>
          <button class="btn-romm-small open-romm-btn" data-rom-id="${rom.id}" title="Open in RomM Web Interface">🌐</button>
        </div>
      </div>
    `;
    }).join('');

    // Add event listeners
    grid.querySelectorAll('.rom-card button:not([disabled]):not(.btn-romm-small)').forEach(btn => {
        btn.addEventListener('click', () => {
            const romId = parseInt(btn.dataset.romId);
            const rom = sortedRoms.find(r => r.id === romId);
            showRomDetail(rom);
        });
    });

    // Add event listeners for RomM buttons
    grid.querySelectorAll('.btn-romm-small').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const romId = parseInt(btn.dataset.romId);
            const rom = sortedRoms.find(r => r.id === romId);
            if (rom) openInRomm(rom);
        });
    });
}

async function showRomDetail(rom) {
    selectedRom = rom;
    const modal = document.getElementById('rom-modal');
    const detail = document.getElementById('rom-detail');

    // Check if ROM is cached
    const isCached = await checkRomCacheStatus(rom);

    // Get emulator configurations and supported emulators
    const [configsResult, supportedResult] = await Promise.all([
        window.electronAPI.emulator.getConfigs(),
        window.electronAPI.emulator.getSupportedEmulators()
    ]);

    const emulatorConfigs = configsResult.success ? configsResult.data : {};
    const supportedEmulators = supportedResult.success ? supportedResult.data : {};

    // Check if platform is supported and configured
    const platform = rom.platform_slug || rom.platform;
    let isPlatformSupported = false;
    let isEmulatorConfigured = false;
    let emulatorMessage = '';

    // Find emulator for this platform
    for (const [emulatorKey, emulator] of Object.entries(supportedEmulators)) {
        if (emulator.platforms.includes(platform)) {
            isPlatformSupported = true;
            if (emulatorConfigs[emulatorKey] && emulatorConfigs[emulatorKey].path) {
                isEmulatorConfigured = true;
            } else {
                emulatorMessage = `Please configure ${emulator.name} emulator`;
            }
            break;
        }
    }

    if (!isPlatformSupported) {
        emulatorMessage = 'Platform not supported';
    }

    // Determine button state and text
    let buttonClass = 'btn-primary';
    let buttonText = isCached ? '🎮 Launch' : '⬇️ Download';
    let buttonDisabled = '';
    let buttonTitle = '';

    if (!isCached && (!isPlatformSupported || !isEmulatorConfigured)) {
        buttonClass = 'btn-disabled';
        buttonDisabled = 'disabled';
        buttonTitle = `title="${emulatorMessage}"`;
    }

    detail.innerHTML = `
    <div class="rom-detail-header">
      <h2>${rom.name}</h2>
      <p><strong>Platform:</strong> ${rom.platform_name || rom.platform}</p>
      <p><strong>Region:</strong> ${rom.region || 'Unknown'}</p>
      <p><strong>Size:</strong> ${formatFileSize(rom.file_size_bytes || rom.files?.[0]?.file_size_bytes)}</p>
    </div>

    <div class="rom-detail-actions">
      <button class="${buttonClass}" id="launch-rom-btn" ${buttonDisabled} ${buttonTitle}>${buttonText}</button>
      <button class="btn-secondary" id="open-romm-btn" title="Open in RomM Web Interface">🌐 Open in RomM</button>
    </div>
  `;

    modal.classList.add('show');

    // Event listeners
    const launchBtn = document.getElementById('launch-rom-btn');
    if (!launchBtn.disabled) {
        launchBtn.addEventListener('click', () => launchRom(rom));
    }
    document.getElementById('open-romm-btn').addEventListener('click', () => openInRomm(rom));
}

// Open ROM in RomM web interface
async function openInRomm(rom) {
    try {
        const result = await window.electronAPI.openRommWebInterface(rom.id);
        if (result.success) {
            showNotification('RomM web interface opened', 'success');
        } else {
            showNotification(`Error opening RomM: ${result.error}`, 'error');
        }
    } catch (error) {
        showNotification(`Error: ${error.message}`, 'error');
    }
}

// Consent modal functions
function showConsentModal(url, username, password) {
    // Store credentials temporarily
    window.tempCredentials = { url, username, password };

    const modal = document.getElementById('consent-modal');
    modal.classList.add('show');
}

async function handleConsentResponse(saveCredentials) {
    const modal = document.getElementById('consent-modal');
    modal.classList.remove('show');

    const { url, username, password } = window.tempCredentials;
    delete window.tempCredentials;

    if (!url || !username || !password) {
        showResult('Authentication data missing', 'error');
        return;
    }

    await window.electronAPI.config.setRommUrl(url);
    const result = await window.electronAPI.config.setCredentials(username, password, saveCredentials);

    if (result.success) {
        showResult('Authentication successful!', 'success');
        document.getElementById('password').value = '';

        // Load user info
        await loadCurrentUser();

        // Move to connected state
        document.getElementById('auth-step').classList.remove('active');
        document.getElementById('connected-state').classList.add('active');
    } else {
        showResult(`Error: ${result.error}`, 'error');
        updateConnectionStatus(false);
    }
}

// Consent modal event listeners
document.getElementById('consent-allow-btn').addEventListener('click', () => handleConsentResponse(true));
document.getElementById('consent-session-only-btn').addEventListener('click', () => handleConsentResponse(false));
document.getElementById('consent-cancel-btn').addEventListener('click', () => {
    const modal = document.getElementById('consent-modal');
    modal.classList.remove('show');
    delete window.tempCredentials;
});

// Modal close handlers
window.addEventListener('click', (e) => {
    const consentModal = document.getElementById('consent-modal');
    const romModal = document.getElementById('rom-modal');
    const saveChoiceModal = document.getElementById('save-choice-modal');

    if (e.target === consentModal) {
        consentModal.classList.remove('show');
        delete window.tempCredentials;
    }
    if (e.target === romModal) {
        romModal.classList.remove('show');
    }
    if (e.target === saveChoiceModal) {
        saveChoiceModal.classList.remove('show');
    }
});

// Save choice modal cancel button
document.getElementById('save-choice-cancel').addEventListener('click', () => {
    document.getElementById('save-choice-modal').classList.remove('show');
});

// Cancel download button
document.getElementById('cancel-download-btn').addEventListener('click', () => {
    if (isDownloading) {
        showNotification('Cancelling download...', 'info');
        hideDownloadProgressModal();
        window.electronAPI.removeDownloadProgressListener();
        isDownloading = false;
    }
});

async function launchRom(rom) {
    if (isDownloading) {
        showNotification('Download already in progress', 'warning');
        return;
    }

    isDownloading = true;

    // Setup download progress listener
    window.electronAPI.onDownloadProgress((progress) => {
        updateDownloadProgress(progress);
    });

    // Show progress modal
    showDownloadProgressModal(rom.name);

    try {
        const result = await window.electronAPI.emulator.launch(rom, null);

        // Hide progress modal and remove listener
        hideDownloadProgressModal();
        window.electronAPI.removeDownloadProgressListener();

        if (result.success) {
            // ROM has been downloaded and cached, update cache status immediately
            romCacheStatus.set(rom.id, true);

            // Invalidate installed ROMs cache so the "Installed" view gets updated
            cachedInstalledRoms = null;
            cachedInstalledPlatforms = null;
            allInstalledRoms = [];
            installedPlatforms = [];

            // Check if we need to show save choice modal
            if (result.needsSaveChoice) {
                showSaveChoiceModal(result.saveComparison, result.romData);
            } else {
                // ROM was launched automatically (no save choice needed)
                showNotification(`ROM launched: ${rom.name}`, 'success');
                document.getElementById('rom-modal').classList.remove('show');

                // ROM has been downloaded and cached, update cache status immediately
                romCacheStatus.set(rom.id, true);

                // Invalidate installed ROMs cache so the "Installed" view gets updated
                cachedInstalledRoms = null;
                cachedInstalledPlatforms = null;
                allInstalledRoms = [];
                installedPlatforms = [];

                // Refresh ROM list to update cache status (keep as backup)
                scheduleRomListRefresh();
            }
        } else {
            showNotification(`Error: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error(`[Launch Error] Failed to launch ROM ${rom.name}:`, error);
        showNotification(`Error: ${error.message}`, 'error');
    } finally {
        isDownloading = false;
    }
}

function showDownloadProgressModal(romName) {
    const modal = document.getElementById('download-progress-modal');
    const romNameElement = document.getElementById('download-rom-name');
    const modalTitle = document.getElementById('progress-modal-title');

    romNameElement.textContent = romName;
    modalTitle.textContent = 'Preparing ROM';

    // Reset progress
    document.getElementById('progress-bar-fill').style.width = '0%';
    document.getElementById('progress-percent').textContent = 'Preparing...';
    document.getElementById('progress-size').textContent = '';

    modal.classList.add('show');
}

function hideDownloadProgressModal() {
    const modal = document.getElementById('download-progress-modal');
    modal.classList.remove('show');
    isDownloading = false;
}

function updateDownloadProgress(progress) {
    const progressBar = document.getElementById('progress-bar-fill');
    const progressPercent = document.getElementById('progress-percent');
    const progressSize = document.getElementById('progress-size');
    const modalTitle = document.getElementById('progress-modal-title');

    if (progress.step === 'extracting') {
        // Extraction progress
        modalTitle.textContent = 'Extracting ROM';
        progressBar.style.width = `${progress.percent}%`;
        progressPercent.textContent = progress.message;
        progressSize.textContent = '';
    } else if (progress.step === 'error') {
        // Error state
        modalTitle.textContent = 'Error';
        progressPercent.textContent = progress.message;
        progressBar.style.width = '0%';
        progressSize.textContent = '';
    } else {
        // Download progress (existing logic)
        modalTitle.textContent = 'Downloading ROM';
        progressBar.style.width = `${progress.percent}%`;
        progressPercent.textContent = `${progress.percent}%`;
        progressSize.textContent = `${progress.downloaded} MB / ${progress.total} MB`;
    }
}

function showSaveChoiceModal(saveComparison, romData) {
    const modal = document.getElementById('save-choice-modal');
    const optionsContainer = document.getElementById('save-options');

    // Clear previous options
    optionsContainer.innerHTML = '';

    // Create save options array with timestamps for sorting
    const options = [];

    // Add only the 5 most recent cloud saves
    if (saveComparison.hasCloud && saveComparison.cloudSaves.length > 0) {
        const recentCloudSaves = saveComparison.cloudSaves.slice(0, 5);

        recentCloudSaves.forEach((cloudSave, index) => {
            options.push({
                type: 'cloud',
                saveId: cloudSave.id,
                title: `☁️ Cloud Save ${recentCloudSaves.length > 1 ? `#${index + 1}` : ''}`,
                description: `${cloudSave.fileName} - Last modified: ${cloudSave.updatedStr}`,
                timestamp: new Date(cloudSave.updated).getTime()
            });
        });
    }

    // Add local save with its timestamp
    if (saveComparison.hasLocal) {
        options.push({
            type: 'local',
            title: '💾 Local Save',
            description: `Last modified: ${saveComparison.localSave.modifiedStr}`,
            timestamp: saveComparison.localSave.modified
        });
    }

    // Sort all options by timestamp (most recent first)
    options.sort((a, b) => b.timestamp - a.timestamp);

    // Mark the most recent save as recommended
    if (options.length > 0) {
        options[0].recommended = true;
    }

    // Add "New Game" option at the end
    options.push({
        type: 'none',
        title: '🆕 New Game',
        description: 'Start from the beginning',
        recommended: false,
        timestamp: 0
    });

    // Create option buttons
    options.forEach(option => {
        const optionDiv = document.createElement('div');
        optionDiv.className = `save-option ${option.recommended ? 'recommended' : ''}`;
        optionDiv.innerHTML = `
            <h3>${option.title}${option.recommended ? ' <span class="recommended-badge">Recommended</span>' : ''}</h3>
            <p>${option.description}</p>
        `;
        optionDiv.addEventListener('click', () => selectSaveAndLaunch(option.type, romData, option.saveId));
        optionsContainer.appendChild(optionDiv);
    });

    // Show modal
    modal.classList.add('show');

    // Close ROM modal
    document.getElementById('rom-modal').classList.remove('show');
}

async function selectSaveAndLaunch(saveChoice, romData, saveId = null) {
    // Hide modal
    document.getElementById('save-choice-modal').classList.remove('show');

    // Show loading notification
    showNotification('Launching...', 'info');

    // Launch with selected save (include saveId for cloud saves)
    const result = await window.electronAPI.emulator.launchWithSaveChoice(romData, saveChoice, saveId);

    if (result.success) {
        showNotification(`ROM launched: ${romData.rom.name}`, 'success');

        // ROM has been downloaded and cached, update cache status immediately
        romCacheStatus.set(romData.rom.id, true);

        // Invalidate installed ROMs cache so the "Installed" view gets updated
        cachedInstalledRoms = null;
        cachedInstalledPlatforms = null;
        allInstalledRoms = [];
        installedPlatforms = [];

        // Refresh ROM list to update cache status (keep as backup)
        scheduleRomListRefresh();
    } else {
        showNotification(`Error: ${result.error}`, 'error');
    }
}

// Platforms
document.getElementById('refresh-platforms-btn').addEventListener('click', () => {
    invalidateCache();
    loadPlatforms();
});

// Global variables for caching data
let cachedPlatforms = null;
let cachedStats = null;
let cachedInstalledRoms = null;
let cachedInstalledPlatforms = null;
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

// Global variables for installed ROMs filtering
let allInstalledRoms = [];
let installedPlatforms = [];

// Cache management functions
function isCacheValid() {
    return Date.now() - lastCacheTime < CACHE_DURATION;
}

function invalidateCache() {
    cachedPlatforms = null;
    cachedStats = null;
    cachedInstalledRoms = null;
    cachedInstalledPlatforms = null;
    lastCacheTime = 0;
    allInstalledRoms = [];
    installedPlatforms = [];

    // Reset loaded views to force reload
    loadedViews.platforms = false;
    loadedViews.installed = false;
}

async function preloadData() {
    try {
        console.log('Preloading data...');

        // Test connection first
        const connectionResult = await window.electronAPI.config.testConnection();
        if (!connectionResult.success) {
            console.log('Connection failed, skipping preload');
            return false;
        }

        // Load user info
        await loadCurrentUser();

        // Load stats
        await loadStatsBar();

        // Load platforms
        const platformsResult = await window.electronAPI.platforms.fetchAll();
        if (platformsResult.success) {
            cachedPlatforms = platformsResult.data;
            loadedViews.platforms = true; // Mark platforms as loaded
        }

        // Preload installed ROMs data
        await preloadInstalledRomsData();
        loadedViews.installed = true; // Mark installed ROMs as loaded

        lastCacheTime = Date.now();
        console.log('Data preloaded successfully');
        return true;

    } catch (error) {
        console.error('Error preloading data:', error);
        return false;
    }
}

async function preloadInstalledRomsData() {
    try {
        if (!cachedPlatforms) return;

        const platforms = cachedPlatforms;
        const platformMap = {};
        platforms.forEach(platform => {
            platformMap[platform.id] = platform;
        });

        // Get all ROMs from all platforms
        const allRoms = [];
        for (const platform of platforms) {
            if (platform.rom_count > 0) {
                const romsResult = await window.electronAPI.roms.getByPlatform(platform.id);
                if (romsResult.success && romsResult.data.items) {
                    // Add platform info to each ROM
                    const romsWithPlatform = romsResult.data.items.map(rom => ({
                        ...rom,
                        platform_name: platform.display_name || platform.name,
                        platform_slug: platform.slug || platform.name.toLowerCase().replace(/\s+/g, '-'),
                        platform_id: platform.id
                    }));
                    allRoms.push(...romsWithPlatform);
                }
            }
        }

        // Filter ROMs that are cached/installed
        const installedRoms = [];
        for (const rom of allRoms) {
            const isCached = await checkRomCacheStatus(rom);
            if (isCached) {
                installedRoms.push(rom);
            }
        }

        // Get unique platforms that have installed ROMs
        const installedPlatformIds = [...new Set(installedRoms.map(rom => rom.platform_id))];
        const platformsWithInstalledRoms = platforms.filter(platform => installedPlatformIds.includes(platform.id));

        // Cache the data
        cachedInstalledRoms = installedRoms;
        cachedInstalledPlatforms = platformsWithInstalledRoms;
        allInstalledRoms = installedRoms;
        installedPlatforms = [];

    } catch (error) {
        console.error('Error preloading installed ROMs data:', error);
    }
}

async function loadPlatforms() {
    // Use cached data if available and valid
    if (cachedPlatforms && isCacheValid()) {
        console.log('Using cached platforms data');
        currentPlatforms = cachedPlatforms;
        displayPlatforms(currentPlatforms);
        return;
    }

    const result = await window.electronAPI.platforms.fetchAll();

    if (result.success) {
        currentPlatforms = result.data;
        // Cache the data
        cachedPlatforms = result.data;
        displayPlatforms(currentPlatforms);
    } else {
        showNotification(`Error: ${result.error}`, 'error');
    }
}

async function displayPlatforms(platforms) {
    const list = document.getElementById('platforms-list');

    if (!platforms || platforms.length === 0) {
        list.innerHTML = '<p class="empty-state">No platforms found</p>';
        return;
    }

    // Filter out platforms with 0 ROMs
    const platformsWithRoms = platforms.filter(platform => (platform.rom_count || 0) > 0);

    if (platformsWithRoms.length === 0) {
        list.innerHTML = '<p class="empty-state">No platforms with ROMs found</p>';
        return;
    }

    // Get emulator configurations and supported emulators
    const [configsResult, supportedResult] = await Promise.all([
        window.electronAPI.emulator.getConfigs(),
        window.electronAPI.emulator.getSupportedEmulators()
    ]);

    const emulatorConfigs = configsResult.success ? configsResult.data : {};
    const supportedEmulators = supportedResult.success ? supportedResult.data : {};

    // Get base URL from API
    const baseUrl = await window.electronAPI.config.getBaseUrl();

    list.innerHTML = platformsWithRoms.map(platform => {
        // Use igdb_slug if available (for identified platforms), otherwise use slug
        // For unidentified platforms, no image will be available
        const platformSlug = platform.igdb_slug || (platform.is_identified ? platform.slug : null);
        const platformImage = platformSlug ? `${baseUrl}/assets/platforms/${platformSlug}.svg` : '';

        // Check if platform is supported and configured
        const platformKey = platform.slug || platform.name.toLowerCase().replace(/\s+/g, '-');
        let isPlatformSupported = false;
        let isEmulatorConfigured = false;
        let platformDisabled = '';
        let platformTitle = '';

        // Find emulator for this platform
        for (const [emulatorKey, emulator] of Object.entries(supportedEmulators)) {
            if (emulator.platforms.includes(platformKey)) {
                isPlatformSupported = true;
                if (emulatorConfigs[emulatorKey] && emulatorConfigs[emulatorKey].path) {
                    isEmulatorConfigured = true;
                } else {
                    platformDisabled = 'disabled';
                    platformTitle = `title="Please configure ${emulator.name} emulator"`;
                }
                break;
            }
        }

        if (!isPlatformSupported) {
            platformDisabled = 'disabled';
            platformTitle = 'title="Platform not supported"';
        }

        return `
      <div class="platform-card ${platformDisabled ? 'disabled' : ''}" data-platform-id="${platform.id}" ${platformTitle}>
        ${platformImage ? `<img src="${platformImage}" alt="${platform.display_name || platform.name}" onerror='this.style.display="none"' />` : '<span class="platform-emoji">🎮</span>'}
        <h3>${platform.display_name || platform.name}</h3>
        <p>${platform.rom_count || 0} ROM${platform.rom_count > 1 ? 's' : ''}</p>
      </div>
    `;
    }).join('');

    list.querySelectorAll('.platform-card:not([disabled])').forEach(card => {
        card.addEventListener('click', async () => {
            const platformId = parseInt(card.dataset.platformId);
            const platform = platformsWithRoms.find(p => p.id === platformId);

            // Load ROMs for this platform
            await loadRomsForPlatform(platformId, platform);
        });
    });
}

// Installed ROMs
async function loadInstalledRoms() {
    // Use cached data if available and valid
    if (cachedInstalledRoms && cachedInstalledPlatforms && isCacheValid()) {
        console.log('Using cached installed ROMs data');
        allInstalledRoms = cachedInstalledRoms;
        installedPlatforms = cachedInstalledPlatforms;

        // Populate platform filter dropdown
        const platformFilter = document.getElementById('installed-platform-filter');
        platformFilter.innerHTML = '<option value="">All Platforms</option>';
        cachedInstalledPlatforms.forEach(platform => {
            const option = document.createElement('option');
            option.value = platform.id;
            option.textContent = platform.display_name || platform.name;
            platformFilter.appendChild(option);
        });

        // Apply current filters
        applyFilters();
        return;
    }

    const container = document.getElementById('installed-roms-list');
    container.innerHTML = '<p class="empty-state">Loading installed ROMs...</p>';

    try {
        // Get all platforms first to map platform names
        const platformsResult = await window.electronAPI.platforms.fetchAll();
        if (!platformsResult.success) {
            container.innerHTML = '<p class="empty-state error">Failed to load platforms</p>';
            return;
        }

        const platforms = platformsResult.data;
        const platformMap = {};
        platforms.forEach(platform => {
            platformMap[platform.id] = platform;
        });

        // Get all ROMs from all platforms
        const allRoms = [];
        for (const platform of platforms) {
            if (platform.rom_count > 0) {
                const romsResult = await window.electronAPI.roms.getByPlatform(platform.id);
                if (romsResult.success && romsResult.data.items) {
                    // Add platform info to each ROM
                    const romsWithPlatform = romsResult.data.items.map(rom => ({
                        ...rom,
                        platform_name: platform.display_name || platform.name,
                        platform_slug: platform.slug || platform.name.toLowerCase().replace(/\s+/g, '-'),
                        platform_id: platform.id
                    }));
                    allRoms.push(...romsWithPlatform);
                }
            }
        }

        // Filter ROMs that are cached/installed
        const installedRoms = [];
        for (const rom of allRoms) {
            const isCached = await checkRomCacheStatus(rom);
            if (isCached) {
                installedRoms.push(rom);
            }
        }

        // Get unique platforms that have installed ROMs
        const installedPlatformIds = [...new Set(installedRoms.map(rom => rom.platform_id))];
        const platformsWithInstalledRoms = platforms.filter(platform => installedPlatformIds.includes(platform.id));

        // Populate platform filter dropdown with only platforms that have installed ROMs
        const platformFilter = document.getElementById('installed-platform-filter');
        platformFilter.innerHTML = '<option value="">All Platforms</option>';
        platformsWithInstalledRoms.forEach(platform => {
            const option = document.createElement('option');
            option.value = platform.id;
            option.textContent = platform.display_name || platform.name;
            platformFilter.appendChild(option);
        });

        // Store globally for filtering
        allInstalledRoms = installedRoms;
        installedPlatforms = platforms;

        // Cache the data
        cachedInstalledRoms = installedRoms;
        cachedInstalledPlatforms = platformsWithInstalledRoms;

        // Apply current filters
        applyFilters();

    } catch (error) {
        console.error('Error loading installed ROMs:', error);
        container.innerHTML = '<p class="empty-state error">Error loading installed ROMs</p>';
    }
}

// Installed ROMs event listeners
document.getElementById('refresh-installed-btn').addEventListener('click', () => {
    invalidateCache();
    loadInstalledRoms();
});
document.getElementById('installed-platform-filter').addEventListener('change', applyFilters);
document.getElementById('installed-search-input').addEventListener('input', applyFilters);

function applyFilters() {
    const platformFilter = document.getElementById('installed-platform-filter').value;
    const searchQuery = document.getElementById('installed-search-input').value.toLowerCase().trim();

    let filteredRoms = allInstalledRoms;

    // Apply platform filter
    if (platformFilter) {
        filteredRoms = filteredRoms.filter(rom => rom.platform_id == platformFilter);
    }

    // Apply search filter
    if (searchQuery) {
        filteredRoms = filteredRoms.filter(rom => {
            const romName = (rom.name || '').toLowerCase();
            const fileName = (rom.fs_name || '').toLowerCase();
            return romName.includes(searchQuery) || fileName.includes(searchQuery);
        });
    }

    displayInstalledRoms(filteredRoms);
}

async function displayInstalledRoms(roms) {
    const container = document.getElementById('installed-roms-list');

    if (!roms || roms.length === 0) {
        container.innerHTML = '<p class="empty-state">No installed ROMs found</p>';
        return;
    }

    // Get base URL for images
    const baseUrl = await window.electronAPI.config.getBaseUrl();

    // Get cache sizes for all ROMs
    const romsWithSizes = await Promise.all(roms.map(async (rom) => {
        try {
            const sizeResult = await window.electronAPI.getRomCacheSize(rom);
            return {
                ...rom,
                cacheSize: sizeResult.success ? sizeResult.size : 0
            };
        } catch (error) {
            console.warn(`Failed to get cache size for ROM ${rom.id}:`, error);
            return {
                ...rom,
                cacheSize: 0
            };
        }
    }));

    container.innerHTML = romsWithSizes.map(rom => {
        // Use path_cover_small or url_cover for cover image
        const coverUrl = rom.path_cover_small
            ? `${baseUrl}${rom.path_cover_small}`
            : rom.url_cover || '';

        return `
      <div class="installed-rom-card" data-rom-id="${rom.id}">
        <div class="installed-rom-header">
          <div class="installed-rom-cover">
            ${coverUrl ? `<img src="${coverUrl}" alt="${rom.name}" onerror="this.parentElement.innerHTML='🎮'">` : '🎮'}
          </div>
          <div class="installed-rom-info">
            <h3 title="${rom.name}">${rom.name}</h3>
            <p>${rom.platform_name || rom.platform}</p>
            <p class="rom-size">${formatFileSize(rom.cacheSize)}</p>
          </div>
          <button class="btn-delete delete-rom-btn" data-rom-id="${rom.id}" title="Delete cached ROM">
            🗑️
          </button>
        </div>
        <div class="installed-rom-actions">
          <button class="btn-launch launch-rom-btn" data-rom-id="${rom.id}" title="Launch ROM">
            ▶️ Launch
          </button>
          <button class="btn-romm open-romm-btn" data-rom-id="${rom.id}" title="Open in RomM Web Interface">
            🌐 RomM
          </button>
        </div>
      </div>
    `}).join('');

    // Add event listeners
    container.querySelectorAll('.open-romm-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const romId = parseInt(btn.dataset.romId);
            const rom = roms.find(r => r.id === romId);
            if (rom) openInRomm(rom);
        });
    });

    container.querySelectorAll('.launch-rom-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const romId = parseInt(btn.dataset.romId);
            const rom = roms.find(r => r.id === romId);
            if (rom) showRomDetail(rom);
        });
    });

    container.querySelectorAll('.delete-rom-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const romId = parseInt(btn.dataset.romId);
            const rom = roms.find(r => r.id === romId);
            if (rom) await deleteCachedRom(rom);
        });
    });
}

async function deleteCachedRom(rom) {
    if (!confirm(`Are you sure you want to delete the cached ROM "${rom.name}"?`)) {
        return;
    }

    try {
        const result = await window.electronAPI.deleteCachedRom(rom);
        if (result.success) {
            showNotification(`ROM "${rom.name}" deleted successfully`, 'success');
            // Clear ROM cache status and invalidate main cache
            romCacheStatus.delete(rom.id);
            romSaveStatus.delete(rom.id);
            invalidateCache();
            loadInstalledRoms();
        } else {
            showNotification(`Error deleting ROM: ${result.error}`, 'error');
        }
    } catch (error) {
        showNotification(`Error: ${error.message}`, 'error');
    }
}

// Show platforms list
function showPlatformsList() {
    currentPlatformId = null;
    document.getElementById('platform-title').textContent = 'Platforms';
    document.getElementById('platforms-list').style.display = 'grid';
    document.getElementById('roms-grid').style.display = 'none';
    document.getElementById('rom-search-bar').style.display = 'none';
    document.getElementById('back-to-platforms-btn').style.display = 'none';
    document.getElementById('refresh-platforms-btn').style.display = 'block';
}

// Show ROMs for a platform
async function loadRomsForPlatform(platformId, platform) {
    currentPlatformId = platformId;

    // Update UI
    document.getElementById('platform-title').textContent = platform?.display_name || platform?.name || 'ROMs';
    document.getElementById('platforms-list').style.display = 'none';
    document.getElementById('roms-grid').style.display = 'grid';
    document.getElementById('rom-search-bar').style.display = 'flex';
    document.getElementById('back-to-platforms-btn').style.display = 'block';
    document.getElementById('refresh-platforms-btn').style.display = 'none';

    // Clear cache status when loading new platform
    clearCacheStatus();

    // Fetch ROMs
    const result = await window.electronAPI.roms.getByPlatform(platformId);

    if (result.success) {
        currentRoms = result.data.items || result.data;
        displayRoms(currentRoms);
    } else {
        showNotification(`Error: ${result.error}`, 'error');
    }
}

// Back to platforms button
document.getElementById('back-to-platforms-btn').addEventListener('click', () => {
    showPlatformsList();
    loadPlatforms();
});

// Emulator configuration
async function loadEmulatorsConfig() {
    const [configsResult, supportedResult] = await Promise.all([
        window.electronAPI.emulator.getConfigs(),
        window.electronAPI.emulator.getSupportedEmulators()
    ]);

    if (configsResult.success && supportedResult.success) {
        displayEmulatorsConfig(configsResult.data, supportedResult.data);
    }
}

function displayEmulatorsConfig(configs, supportedEmulators) {
    const container = document.getElementById('emulators-config');

    container.innerHTML = `
    <p class="info-text">Configure the path to your emulators</p>
    <div>
    <p  class="info-text">⚠️Note: We recommend using emulators that you're not using for other purposes to avoid configuration / save conflicts. </p>
    </div>
    ${Object.entries(supportedEmulators).map(([emulatorKey, emulator]) => `
      <div class="emulator-item">
        <h4>${emulator.name}</h4>
        <p class="emulator-platforms">Supports: ${emulator.platforms.join(', ').toUpperCase()}</p>
        <input
          type="text"
          data-emulator="${emulatorKey}"
          value="${configs[emulatorKey]?.path || ''}"
          placeholder="C:\\emulators\\${emulator.name}\\${emulator.name}.exe"
        >
      </div>
    `).join('')}
    <button class="btn-primary" id="save-emulators-btn" style="margin-top: 1rem;">Save</button>
  `;

    document.getElementById('save-emulators-btn').addEventListener('click', async () => {
        const inputs = container.querySelectorAll('input');

        for (const input of inputs) {
            const emulatorKey = input.dataset.emulator;
            const path = input.value;

            if (path) {
                // Configure for all platforms supported by this emulator
                const emulator = supportedEmulators[emulatorKey];
                for (const platform of emulator.platforms) {
                    await window.electronAPI.emulator.configure(platform, path);
                }
            }
        }

        showNotification('Configuration saved!', 'success');
    });
}

// Utilities
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return 'N/A';

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// Check if ROM is cached
async function checkRomCacheStatus(rom) {
    if (romCacheStatus.has(rom.id)) {
        return romCacheStatus.get(rom.id);
    }

    try {
        const result = await window.electronAPI.checkRomCacheIntegrity(rom);
        if (result.success) {
            // Store the cache status
            romCacheStatus.set(rom.id, result.cached);

            // Log integrity verification results if available
            if (result.integrity) {
                if (result.integrity.verified) {
                    console.log(`[CACHE] ROM ${rom.id} integrity verified ✅`);
                } else {
                    console.warn(`[CACHE] ROM ${rom.id} integrity check failed ⚠️`, result.integrity);
                }
            }

            return result.cached;
        } else {
            console.error(`Error checking cache integrity for ROM ${rom.id}:`, result.error);
            return false;
        }
    } catch (error) {
        console.error(`Error checking cache for ROM ${rom.id}:`, error);
        return false;
    }
}

// Check if ROM has saves (cloud or local)
async function checkRomSaveStatus(rom) {
    if (romSaveStatus.has(rom.id)) {
        return romSaveStatus.get(rom.id);
    }

    try {
        const result = await window.electronAPI.checkRomSaves(rom);
        romSaveStatus.set(rom.id, result.hasSaves);
        return result.hasSaves;
    } catch (error) {
        console.error(`Error checking saves for ROM ${rom.id}:`, error);
        return false;
    }
}

// Clear cache status when needed
function clearCacheStatus() {
    romCacheStatus.clear();
    romSaveStatus.clear();
}

// Refresh ROM list after download to update cache status
function scheduleRomListRefresh() {
    setTimeout(async () => {
        if (currentPlatformId) {
            clearCacheStatus(); // Clear cache to force refresh
            const platform = currentPlatforms.find(p => p.id === currentPlatformId);
            if (platform) {
                await loadRomsForPlatform(currentPlatformId, platform);
            }
        }
    }, 3000); // Wait 3 seconds
}

function showNotification(message, type) {
    // Log to console for debugging
    if (type === 'error') {
        console.error(`[UI Error] ${message}`);
    } else if (type === 'warning') {
        console.warn(`[UI Warning] ${message}`);
    } else {
        console.log(`[UI ${type}] ${message}`);
    }

    // Create a temporary notification
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    border-radius: 0.5rem;
    background-color: ${type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--warning)'};
    color: white;
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Load and update stats bar
async function loadStatsBar() {
    // Use cached data if available and valid
    if (cachedStats && isCacheValid()) {
        console.log('Using cached stats data');
        const stats = cachedStats;

        // Update stats bar values
        document.getElementById('stat-platforms').textContent = stats.PLATFORMS || 0;
        document.getElementById('stat-roms').textContent = stats.ROMS || 0;
        document.getElementById('stat-saves').textContent = stats.SAVES || 0;
        document.getElementById('stat-states').textContent = stats.STATES || 0;
        document.getElementById('stat-screenshots').textContent = stats.SCREENSHOTS || 0;

        // Format storage
        const totalSizeGB = (stats.TOTAL_FILESIZE_BYTES / (1024 * 1024 * 1024)).toFixed(1);
        const totalSizeTB = (stats.TOTAL_FILESIZE_BYTES / (1024 * 1024 * 1024 * 1024)).toFixed(2);
        const displaySize = totalSizeTB >= 1 ? `${totalSizeTB} TB` : `${totalSizeGB} GB`;
        document.getElementById('stat-storage').textContent = displaySize;

        // Show stats bar
        document.getElementById('stats-bar').style.display = 'flex';
        return;
    }

    const result = await window.electronAPI.stats.fetch();

    if (result.success) {
        const stats = result.data;
        // Cache the stats
        cachedStats = stats;

        // Update stats bar values
        document.getElementById('stat-platforms').textContent = stats.PLATFORMS || 0;
        document.getElementById('stat-roms').textContent = stats.ROMS || 0;
        document.getElementById('stat-saves').textContent = stats.SAVES || 0;
        document.getElementById('stat-states').textContent = stats.STATES || 0;
        document.getElementById('stat-screenshots').textContent = stats.SCREENSHOTS || 0;

        // Format storage
        const totalSizeGB = (stats.TOTAL_FILESIZE_BYTES / (1024 * 1024 * 1024)).toFixed(1);
        const totalSizeTB = (stats.TOTAL_FILESIZE_BYTES / (1024 * 1024 * 1024 * 1024)).toFixed(2);
        const displaySize = totalSizeTB >= 1 ? `${totalSizeTB} TB` : `${totalSizeGB} GB`;
        document.getElementById('stat-storage').textContent = displaySize;

        // Show stats bar
        document.getElementById('stats-bar').style.display = 'flex';
    }
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Setup save upload success notification listener
    window.electronEvents.onSaveUploadSuccess((data) => {
        showNotification(`Save uploaded successfully for "${data.romName}"`, 'success');
    });

    // Load saved server URL into the input field
    const savedUrl = await window.electronAPI.config.getBaseUrl();
    if (savedUrl) {
        document.getElementById('romm-url').value = savedUrl;
    }

    // Test connection and check if user is authenticated
    const connectionResult = await window.electronAPI.config.testConnection();

    if (connectionResult.success) {
        // Check if we have saved credentials or session
        const hasCredentials = await window.electronAPI.config.hasSavedCredentials();
        const hasSession = await window.electronAPI.config.hasSavedSession();

        if (hasCredentials || hasSession) {
            // Try to load current user to verify authentication
            const userResult = await loadCurrentUser();

            if (userResult) {
                // User is authenticated, load all data
                await preloadData();
                await loadPlatforms();

                // Show connected state in settings
                document.getElementById('server-url-step').classList.remove('active');
                document.getElementById('auth-step').classList.remove('active');
                document.getElementById('connected-state').classList.add('active');
            } else {
                // Saved auth didn't work, show login form
                document.getElementById('server-url-step').classList.add('active');
                updateConnectionStatus(false);
            }
        } else {
            // No saved auth, show login form
            document.getElementById('server-url-step').classList.add('active');
            updateConnectionStatus(false);
        }
    } else {
        // No connection to server
        document.getElementById('server-url-step').classList.add('active');
        updateConnectionStatus(false);
    }
});
