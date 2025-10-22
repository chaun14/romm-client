// Application state
let currentRoms = [];
let currentPlatforms = [];
let selectedRom = null;
let currentUser = null;
let currentPlatformId = null;
let isLibraryFullyCached = false;
let remoteRoms = [];
let localRoms = [];

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
    try {
        const result = await window.electronAPI.config.logout();
        if (result.success) {
            // Logout successful - the IPC handler will reload the login page
            console.log('Logout successful');
        } else {
            console.error('Logout failed:', result.error);
            showResult('Logout failed', 'error');
        }
    } catch (error) {
        console.error('Logout error:', error);
        showResult('Logout failed', 'error');
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
    console.log(`Displaying ${roms.length} ROMs for platform ID ${roms.length > 0 ? roms[0].platform_id || roms[0].platform_slug : 'N/A'}`);

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
        const platform = rom.platform_slug || rom.platform_fs_slug;
        let isPlatformSupported = false;
        let isEmulatorConfigured = false;
        let emulatorMessage = '';

        // Find emulator for this platform
        for (const [emulatorKey, emulator] of Object.entries(supportedEmulators)) {
            console.log(`Checking emulator ${emulatorKey} for platform ${platform}`);
            console.log(`Emulator platforms: ${emulator.platforms.join(', ')}`);

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

    // Check if ROM is cached and has saves
    const [isCached, hasSaves] = await Promise.all([
        checkRomCacheStatus(rom),
        checkRomSaveStatus(rom)
    ]);

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

    // Create save status indicator
    const saveStatusHtml = hasSaves
        ? '<p><strong>Saves:</strong> <span class="save-indicator" title="Save data available">💾 Available</span></p>'
        : '<p><strong>Saves:</strong> <span class="save-indicator" title="No save data found">❌ None</span></p>';

    detail.innerHTML = `
    <div class="rom-detail-header">
      <h2>${rom.name}</h2>
      <p><strong>Platform:</strong> ${rom.platform_name || rom.platform}</p>
      <p><strong>Region:</strong> ${rom.region || 'Unknown'}</p>
      <p><strong>Size:</strong> ${formatFileSize(rom.file_size_bytes || rom.files?.[0]?.file_size_bytes)}</p>
      ${saveStatusHtml}
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
        window.electronAPI.removeDownloadProgressListener(); // Correct function name
        isDownloading = false;
    }
});

async function launchRom(rom) {
    if (isDownloading) {
        showNotification('Download already in progress', 'warning');
        return;
    }

    isDownloading = true;

    // Setup ROM download progress listener
    window.electronAPI.onRomDownloadProgress((progress) => {
        console.log('[FRONTEND] Received rom:download-progress', progress);
        updateRomDownloadProgress(progress);
    });

    // Setup download complete listener
    window.electronAPI.onDownloadComplete((data) => {
        // Hide progress modal and remove listeners
        hideDownloadProgressModal();
        window.electronAPI.removeDownloadProgressListener(); // Correct function name
        window.electronAPI.removeDownloadCompleteListener();

        // ROM has been downloaded and cached, update cache status immediately
        romCacheStatus.set(rom.id, true);

        // Reload installed ROMs data to include the newly downloaded ROM
        preloadInstalledRomsData().then(() => {
            // If user is currently on the installed ROMs view, update the display
            if (document.getElementById('installed-view').classList.contains('active')) {
                loadInstalledRoms();
            }
        });

        showNotification(`ROM downloaded: ${rom.name}`, 'success');
        document.getElementById('rom-modal').classList.remove('show');

        // Refresh ROM list to update cache status
        scheduleRomListRefresh();

        isDownloading = false;
    });

    // Show progress modal
    showDownloadProgressModal(rom.name);

    try {
        // Start the launch process (returns immediately)
        const result = await window.electronAPI.roms.launch(rom, null);

        if (!result.success) {
            // Hide modal and show error if launch failed to start
            hideDownloadProgressModal();
            window.electronAPI.removeDownloadProgressListener(); // Correct function name
            window.electronAPI.removeDownloadCompleteListener();
            showNotification(`Error: ${result.error}`, 'error');
            isDownloading = false;
        }
    } catch (error) {
        console.error(`[Launch Error] Failed to start ROM launch ${rom.name}:`, error);
        hideDownloadProgressModal();
        window.electronAPI.removeDownloadProgressListener(); // Correct function name
        window.electronAPI.removeDownloadCompleteListener();
        showNotification(`Error: ${error.message}`, 'error');
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

// Update ROM download progress bar
function updateRomDownloadProgress(progress) {
    const progressBar = document.getElementById('progress-bar-fill');
    const progressPercent = document.getElementById('progress-percent');
    const progressSize = document.getElementById('progress-size');
    const modalTitle = document.getElementById('progress-modal-title');

    if (progress.step === 'extracting') {
        modalTitle.textContent = 'Extracting ROM';
        progressBar.style.width = `${progress.percent}%`;
        progressPercent.textContent = progress.message;
        progressSize.textContent = '';
    } else if (progress.step === 'error') {
        modalTitle.textContent = 'Error';
        progressPercent.textContent = progress.message;
        progressBar.style.width = '0%';
        progressSize.textContent = '';
    } else {
        modalTitle.textContent = 'Downloading ROM';
        progressBar.style.width = `${progress.percent}%`;
        if (progress.message === 'ROM already available') {
            progressPercent.textContent = progress.message;
            progressSize.textContent = '';
        } else {
            progressPercent.textContent = `${progress.percent}%`;
            let sizeText = `${progress.downloaded} MB / ${progress.total} MB`;
            if (progress.totalFilesNumber && progress.currentFileNumber) {
                sizeText += ` (File ${progress.currentFileNumber}/${progress.totalFilesNumber})`;
            }
            progressSize.textContent = sizeText;
        }
    }
}

// Update app update download progress bar (if used elsewhere)
function updateAppUpdateProgress(percent, info) {
    const progressBar = document.getElementById('progress-bar-fill');
    const progressPercent = document.getElementById('progress-percent');
    const modalTitle = document.getElementById('progress-modal-title');

    modalTitle.textContent = 'Downloading Update';
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    // Optionally display info if needed
}

function showSaveChoiceModal(saveData, context) {
    console.log('[FRONTEND] showSaveChoiceModal called with:', saveData);
    const modal = document.getElementById('save-choice-modal');
    const optionsContainer = document.getElementById('save-options');

    // Force hide modal first to ensure clean state
    modal.classList.remove('show');

    // Clear previous options
    optionsContainer.innerHTML = '';

    // Create save options array
    const options = [];

    // Add cloud saves (max 5 most recent)
    if (saveData.hasCloud && saveData.cloudSaves && saveData.cloudSaves.length > 0) {
        // Sort cloud saves by date (most recent first) and take the first 5
        const sortedCloudSaves = saveData.cloudSaves.sort((a, b) => {
            const dateA = new Date(a.created_at || a.updated_at || 0);
            const dateB = new Date(b.created_at || b.updated_at || 0);
            return dateB.getTime() - dateA.getTime(); // Most recent first
        });
        const recentCloudSaves = sortedCloudSaves.slice(0, 5);

        recentCloudSaves.forEach((cloudSave, index) => {
            // Extract filename from download_path or use fileName
            const zipName = cloudSave.download_path
                ? cloudSave.download_path.split('/').pop() || cloudSave.file_name || `save_${index + 1}.zip`
                : cloudSave.file_name || `save_${index + 1}.zip`;

            // Use created_at date if available, otherwise updated_at date, otherwise show "Unknown date"
            const dateField = cloudSave.created_at || cloudSave.updated_at;
            const dateDisplay = dateField
                ? new Date(dateField).toLocaleString()
                : 'Unknown date';

            options.push({
                type: 'cloud',
                saveId: cloudSave.id,
                title: `☁️ Cloud Save ${recentCloudSaves.length > 1 ? `#${index + 1}` : ''}`,
                description: `${zipName} - Created: ${dateDisplay}`,
                timestamp: dateField ? new Date(dateField).getTime() : Date.now() - (recentCloudSaves.length - index) * 60000 // Fallback timestamps
            });
        });
    }

    // Add local save
    if (saveData.hasLocal) {
        // Get the modification date of the local save directory
        let localDateDisplay = 'Unknown date';
        let localTimestamp = Date.now() - 1000; // Default fallback
        if (saveData.localSaveDate) {
            try {
                const localDate = new Date(saveData.localSaveDate);
                localDateDisplay = localDate.toLocaleString();
                localTimestamp = localDate.getTime();
            } catch (error) {
                console.warn('Could not parse local save date:', error);
                localDateDisplay = 'Local save available';
            }
        }

        options.push({
            type: 'local',
            title: '💾 Local Save',
            description: `Your local saved game - Modified: ${localDateDisplay}`,
            timestamp: localTimestamp
        });
    }

    // Add "New Game" option
    options.push({
        type: 'none',
        title: '🆕 New Game',
        description: 'Start from the beginning',
        recommended: false,
        timestamp: 0
    });

    // Sort options by timestamp (most recent first)
    options.sort((a, b) => b.timestamp - a.timestamp);

    // Mark most recent as recommended (after sorting)
    if (options.length > 0) {
        options[0].recommended = true;
    }

    // Create option buttons
    options.forEach(option => {
        const optionDiv = document.createElement('div');
        optionDiv.className = `save-option ${option.recommended ? 'recommended' : ''}`;
        optionDiv.innerHTML = `
            <h3>${option.title}${option.recommended ? ' <span class="recommended-badge">Recommended</span>' : ''}</h3>
            <p>${option.description}</p>
        `;
        optionDiv.addEventListener('click', () => selectSaveFromModal(option.type, option.saveId));
        optionsContainer.appendChild(optionDiv);
    });

    // Show modal
    modal.classList.add('show');

    // Close other modals
    const romModal = document.getElementById('rom-modal');
    if (romModal) {
        romModal.classList.remove('show');
    }

    const downloadModal = document.getElementById('download-progress-modal');
    if (downloadModal) {
        downloadModal.classList.remove('show');
    }
}

/**
 * New function: Send save choice back to main process via IPC
 * This is called from the modal triggered by launchRomWithSavesFlow
 */
async function selectSaveFromModal(saveChoice, saveId = null) {
    console.log(`[FRONTEND] selectSaveFromModal called with choice: ${saveChoice}, saveId: ${saveId}`);

    // Hide modal
    const modal = document.getElementById('save-choice-modal');
    modal.classList.remove('show');

    // Send the choice back to main process
    window.electronEvents.sendSaveChoice(saveChoice, saveId);
}

/**
 * Old function: For legacy flow with emulator.launchWithSaveChoice
 * Keeping for backward compatibility
 */
async function selectSaveAndLaunch(saveChoice, romData, saveId = null) {
    console.log(`[FRONTEND] selectSaveAndLaunch - Old flow: ${saveChoice}${saveId ? ` (ID: ${saveId})` : ''}`);

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

        // Reload installed ROMs data to include the newly downloaded ROM
        preloadInstalledRomsData().then(() => {
            // If user is currently on the installed ROMs view, update the display
            if (document.getElementById('installed-view').classList.contains('active')) {
                loadInstalledRoms();
            }
        });

        // Refresh ROM list to update cache status (keep as backup)
        scheduleRomListRefresh();
    } else {
        showNotification(`Error: ${result.error}`, 'error');
    }
}

// Platforms
document.getElementById('refresh-platforms-btn').addEventListener('click', () => {
    loadPlatforms();
});

// Global variables for ROMs pagination
let currentPage = 1;
let totalPages = 1;
let itemsPerPage = 50; // Nombre de ROMs par page
let totalRoms = 0;

// Global variables for installed ROMs filtering
let allInstalledRoms = [];
let installedPlatforms = [];

async function checkRomCacheStatus(rom) {
    if (!allInstalledRoms.filter(r => r.id === rom.id).length > 0) {
        console.log(`[ROM MANAGER] ROM is not installed: ${rom.name} (ID: ${rom.id})`);
        return false;
    }
    console.log(`[ROM MANAGER] ROM is installed: ${rom.name} (ID: ${rom.id})`);
    return true;
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

        // Load all remote ROMs
        const remoteRomsResult = await window.electronAPI.roms.fetchAll();
        if (remoteRomsResult) {
            remoteRoms = remoteRomsResult;
            console.log(`Loaded ${remoteRoms.length} remote ROMs`);
        }

        // load caching mode
        const noCacheMode = await window.electronAPI.roms.getNoCacheMode();
        isLibraryFullyCached = !noCacheMode;
        console.log(`Library fully cached mode: ${isLibraryFullyCached}`);

        // Load all local ROMs
        const localRomsResult = await window.electronAPI.roms.fetchLocal();
        if (localRomsResult) {
            localRoms = localRomsResult;
            console.log(`Loaded ${localRoms.length} local ROMs`);
        }

        // Load platforms
        const platformsResult = await window.electronAPI.platforms.fetchAll();
        if (platformsResult.success) {
            currentPlatforms = platformsResult.data;
            loadedViews.platforms = true; // Mark platforms as loaded
        }

        // Preload installed ROMs data
        await preloadInstalledRomsData();
        loadedViews.installed = true; // Mark installed ROMs as loaded

        console.log('Data preloaded successfully');
        return true;

    } catch (error) {
        console.error('Error preloading data:', error);
        return false;
    }
}

async function preloadInstalledRomsData() {
    try {
        // Always reload local ROMs to get the latest installed ROMs
        const localRomsResult = await window.electronAPI.roms.fetchLocal();
        if (localRomsResult) {
            localRoms = localRomsResult;
            console.log(`Reloaded ${localRoms.length} local ROMs`);
        }

        if (!currentPlatforms || !localRoms) return;

        // Filter ROMs that are cached/installed (localRoms contains the installed ones)
        const installedRoms = localRoms.map(localRom => {
            // Find the corresponding remote ROM info
            const remoteRom = remoteRoms.find(r => r.id === localRom.id);
            if (remoteRom) {
                return {
                    ...remoteRom,
                    localPath: localRom.localPath,
                    // Add platform info
                    platform_name: remoteRom.platform_name || 'Unknown',
                    platform_slug: remoteRom.platform_slug,
                    platform_id: remoteRom.platform_id
                };
            }
            return localRom; // fallback
        });

        console.log('Installed ROMs:', installedRoms);

        // Get unique platforms that have installed ROMs
        const installedPlatformIds = [...new Set(installedRoms.map(rom => rom.platform_id))];
        const platformsWithInstalledRoms = currentPlatforms.filter(platform => installedPlatformIds.includes(platform.id));

        // Store the data (no more caching, just direct assignment)
        allInstalledRoms = installedRoms;
        installedPlatforms = platformsWithInstalledRoms;

    } catch (error) {
        console.error('Error preloading installed ROMs data:', error);
    }
}

async function loadPlatforms() {
    // Use preloaded data if available
    if (currentPlatforms && currentPlatforms.length > 0) {
        console.log('Using preloaded platforms data');
        displayPlatforms(currentPlatforms);
        return;
    }

    const result = await window.electronAPI.platforms.fetchAll();

    if (result.success) {
        currentPlatforms = result.data;
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

        const platformSlug = platform.slug || (platform.is_identified ? platform.fs_slug : null);
        const platformImageSvg = platformSlug ? `${baseUrl}/assets/platforms/${platformSlug}.svg` : '';
        const platformImageIco = platformSlug ? `${baseUrl}/assets/platforms/${platformSlug}.ico` : '';

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
        <div class="platform-image-container" data-svg="${platformImageSvg}" data-ico="${platformImageIco}">
          <img src="${platformImageSvg}" alt="${platform.display_name || platform.name}" class="platform-image platform-image-svg" />
          <img src="${platformImageIco}" alt="${platform.display_name || platform.name}" class="platform-image platform-image-ico" style="display: none;" />
        </div>
        <h3>${platform.display_name || platform.name}</h3>
        <p>${platform.rom_count || 0} ROM${platform.rom_count > 1 ? 's' : ''}</p>
      </div>
    `;
    }).join('');

    // Setup platform image fallback
    setupPlatformImageFallback();

    list.querySelectorAll('.platform-card:not([disabled])').forEach(card => {
        card.addEventListener('click', async () => {
            const platformId = parseInt(card.dataset.platformId);
            const platform = platformsWithRoms.find(p => p.id === platformId);

            // Load ROMs for this platform
            await loadRomsForPlatform(platformId, platform);
        });
    });
}

function setupPlatformImageFallback() {
    // Handle platform image fallback after DOM is updated
    document.querySelectorAll('.platform-image-container').forEach(container => {
        const svgImg = container.querySelector('.platform-image-svg');
        const icoImg = container.querySelector('.platform-image-ico');

        if (svgImg && icoImg) {
            // Check if SVG loads successfully
            svgImg.addEventListener('error', function () {
                //    console.log('SVG failed to load, showing ICO fallback:', this.src);
                this.style.display = 'none';
                icoImg.style.display = 'block';
            });

            svgImg.addEventListener('load', function () {
                //  console.log('SVG loaded successfully:', this.src);
                // SVG loaded, keep it visible and hide ICO
                this.style.display = 'block';
                icoImg.style.display = 'none';
            });

            // Handle ICO fallback if it also fails
            icoImg.addEventListener('error', function () {
                //   console.log('ICO also failed to load, showing emoji fallback:', this.src);
                container.innerHTML = '<span class="platform-emoji">🎮</span>';
            });

            // If SVG is already cached/loaded, the load event might not fire
            // So we also check after a short delay
            setTimeout(() => {
                if (svgImg.complete && svgImg.naturalHeight === 0) {
                    //   console.log('SVG failed to load (cached), showing ICO fallback:', svgImg.src);
                    svgImg.style.display = 'none';
                    icoImg.style.display = 'block';
                }
            }, 100);
        }
    });
}

// Installed ROMs
async function loadInstalledRoms() {
    // Use preloaded data
    if (allInstalledRoms && installedPlatforms) {
        console.log('Using preloaded installed ROMs data');

        // Populate platform filter dropdown
        const platformFilter = document.getElementById('installed-platform-filter');
        platformFilter.innerHTML = '<option value="">All Platforms</option>';
        installedPlatforms.forEach(platform => {
            const option = document.createElement('option');
            option.value = platform.id;
            option.textContent = platform.display_name || platform.name;
            platformFilter.appendChild(option);
        });

        // Apply current filters
        applyFilters();
        return;
    }

    console.log('No preloaded installed ROMs data available');
}

// Installed ROMs event listeners
document.getElementById('refresh-installed-btn').addEventListener('click', () => {
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
                cacheSize: sizeResult.success ? sizeResult.data : 0
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
        <button class="btn-delete delete-rom-btn" data-rom-id="${rom.id}" title="Remove ROM from filesystem">
          🗑️
        </button>
        <div class="installed-rom-header">
          <div class="installed-rom-cover">
            ${coverUrl ? `<img src="${coverUrl}" alt="${rom.name}" onerror="this.parentElement.innerHTML='🎮'">` : '🎮'}
          </div>
          <div class="installed-rom-info">
            <h3 title="${rom.name}">${rom.name}</h3>
            <p>${rom.platform_name || rom.platform}</p>
            <p class="rom-size">${formatFileSize(rom.cacheSize)}</p>
          </div>
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

            // Remove the ROM from the cached data instead of clearing everything
            romCacheStatus.delete(rom.id);
            romSaveStatus.delete(rom.id);

            // Remove the ROM from allInstalledRoms array
            allInstalledRoms = allInstalledRoms.filter(r => r.id !== rom.id);

            // Recalculate installedPlatforms - only keep platforms that still have ROMs
            const remainingPlatformIds = [...new Set(allInstalledRoms.map(r => r.platform_id))];
            installedPlatforms = installedPlatforms.filter(p => remainingPlatformIds.includes(p.id));

            // Update the UI with the filtered data
            applyFilters();

        } else {
            showNotification(`Error deleting ROM: ${result.error}`, 'error');
            // Don't clear cache if deletion failed - keep the ROM in the list
            console.error('ROM deletion failed:', result.error);
        }
    } catch (error) {
        showNotification(`Error: ${error.message}`, 'error');
        console.error('ROM deletion error:', error);
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
async function loadRomsForPlatform(platformId, platform, page = 1) {
    currentPlatformId = platformId;
    currentPage = page;

    // Update UI
    document.getElementById('platform-title').textContent = platform?.display_name || platform?.name || 'ROMs';
    document.getElementById('platforms-list').style.display = 'none';
    document.getElementById('roms-grid').style.display = 'grid';
    document.getElementById('rom-search-bar').style.display = 'flex';
    document.getElementById('back-to-platforms-btn').style.display = 'block';
    document.getElementById('refresh-platforms-btn').style.display = 'none';

    // Clear cache status when loading new platform
    clearCacheStatus();

    // Calculate offset from page
    const offset = (page - 1) * itemsPerPage;

    // Filter ROMs from preloaded remote ROMs
    if (isLibraryFullyCached) {
        const platformRoms = remoteRoms.filter(rom => rom.platform_id === platformId || rom.platform_slug === platformId);
        currentRoms = platformRoms.slice(offset, offset + itemsPerPage);
        totalRoms = platformRoms.length;
        totalPages = Math.ceil(totalRoms / itemsPerPage);
    } else {
        const platformRoms = await window.electronAPI.roms.getByPlatform(platformId, itemsPerPage, offset);
        console.log(JSON.stringify(platformRoms));
        if (platformRoms && platformRoms.success && platformRoms.data) {
            currentRoms = platformRoms.data.items || [];
            totalRoms = platformRoms.data.total || 0;
            totalPages = Math.ceil(totalRoms / itemsPerPage);
            console.log(`Loaded ${currentRoms.length} ROMs for platform ID ${platformId} from search API (page: ${page}/${totalPages}, total: ${totalRoms})`);
        } else {
            currentRoms = [];
            totalRoms = 0;
            totalPages = 1;
        }
    }

    displayRoms(currentRoms);
    displayPaginationControls();
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
    } else {
        console.error('Failed to load emulator configs:', { configsResult, supportedResult });
    }
}

function displayEmulatorsConfig(configs, supportedEmulators) {
    const container = document.getElementById('emulators-config');

    if (!container) {
        console.error('emulators-config container not found!');
        return;
    }

    const html = `
    <p class="info-text">Configure the path to your emulators</p>
    <div>
    <p  class="info-text">⚠️Note: We recommend using emulators that you're not using for other purposes to avoid configuration / save conflicts. </p>
    </div>
    ${Object.entries(supportedEmulators).map(([emulatorKey, emulator]) => `
      <div class="emulator-item">
        <h4>${emulator.name}</h4>
        <p class="emulator-platforms">Supports: ${emulator.platforms.join(', ').toUpperCase()}</p>
        <div class="emulator-config-row">
          <input
            type="text"
            data-emulator="${emulatorKey}"
            value="${configs[emulatorKey]?.path || ''}"
            placeholder="C:\\emulators\\${emulator.name}\\${emulator.name}.exe"
          >
          <button class="btn-config-emulator" data-emulator="${emulatorKey}" title="Configure ${emulator.name}">⚙️ Configure</button>
        </div>
      </div>
    `).join('')}
    <button class="btn-primary" id="save-emulators-btn" style="margin-top: 1rem;">Save</button>
  `;

    container.innerHTML = html;

    // Add event listeners for configure buttons
    container.querySelectorAll('.btn-config-emulator').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const emulatorKey = e.target.dataset.emulator;
            const emulatorPath = container.querySelector(`input[data-emulator="${emulatorKey}"]`).value.trim();

            if (!emulatorPath) {
                showNotification(`Please set the path for ${supportedEmulators[emulatorKey].name} first`, 'error');
                return;
            }

            try {
                showNotification(`Starting ${supportedEmulators[emulatorKey].name} in configuration mode...`, 'info');
                const result = await window.electronAPI.emulator.configureEmulator(emulatorKey, emulatorPath);
                if (result.success) {
                    showNotification(`${supportedEmulators[emulatorKey].name} configuration completed!`, 'success');
                } else {
                    showNotification(`Configuration failed: ${result.error}`, 'error');
                }
            } catch (error) {
                showNotification(`Error: ${error.message}`, 'error');
            }
        });
    });

    // Add auto-save on input change
    const inputs = container.querySelectorAll('input');
    // Autosave disabled, config is only saved when clicking Save

    document.getElementById('save-emulators-btn').addEventListener('click', async () => {
        const inputs = container.querySelectorAll('input');
        for (const input of inputs) {
            const emulatorKey = input.dataset.emulator;
            const path = input.value.trim();
            await window.electronAPI.emulator.saveConfig(emulatorKey, path);
        }
        showNotification('Configuration saved!', 'success');
        // Always reload platforms after saving emulator config
        // Switch to platforms view and reload
        document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
        document.getElementById('platforms-view').classList.add('active');
        loadPlatforms();
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



// Check if ROM has saves (cloud or local)
async function checkRomSaveStatus(rom) {
    if (romSaveStatus.has(rom.id)) {
        return romSaveStatus.get(rom.id);
    }

    try {
        if (isLibraryFullyCached) {
            const result = await window.electronAPI.checkRomSaves(rom);
            const hasSaves = result.hasLocal || result.hasCloud;
            romSaveStatus.set(rom.id, hasSaves);
            return hasSaves;
        } else {
            // for performance, only check local saves when not fully cached
            return false;
        }

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
    const result = await window.electronAPI.stats.fetch();

    if (result.success) {
        const stats = result.data;

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
    // Attach download:progress listener globally
    window.electronAPI.removeDownloadProgressListener();
    window.electronAPI.onRomDownloadProgress((progress) => {
        updateDownloadProgress(progress);
    });

    // Attach save choice modal listener
    window.electronEvents.removeSaveChoiceListener?.();
    window.electronEvents.onSaveChoiceModal((saveData) => {
        showSaveChoiceModal(saveData, { rom: saveData.rom });
    });

    // Attach ROM launch event listeners
    window.electronEvents.removeRomLaunchListeners?.();
    window.electronEvents.onRomLaunched((data) => {
        hideDownloadProgressModal();
        showNotification(`ROM launched: ${data.romName} (PID: ${data.pid})`, 'success');

        // ROM has been downloaded and cached, update cache status immediately
        romCacheStatus.set(data.romId, true);

        // Reload installed ROMs data to include the newly downloaded ROM
        preloadInstalledRomsData().then(() => {
            // If user is currently on the installed ROMs view, update the display
            if (document.getElementById('installed-view').classList.contains('active')) {
                loadInstalledRoms();
            }
        });
    });
    window.electronEvents.onRomLaunchFailed((data) => {
        hideDownloadProgressModal();
        showNotification(`Launch failed: ${data.error}`, 'error');
    });

    // Setup navigation between views
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const viewName = item.dataset.view;

            // Update navigation buttons
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Display the view - use CSS classes only, don't manipulate style.display
            document.querySelectorAll('.view').forEach(view => {
                view.classList.remove('active');
            });
            const targetView = document.getElementById(`${viewName}-view`);
            if (targetView) {
                targetView.classList.add('active');
            }

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
                loadEmulatorsConfig();
                loadedViews.emulators = true;
            } else if (viewName === 'settings') {
                // Ensure settings view shows the appropriate step based on connection status
                updateSettingsViewState();
            }
        });
    });

    // Setup save upload success notification listener
    window.electronEvents.onSaveUploadSuccess((data) => {
        showNotification(`Save uploaded successfully for "${data.romName}"`, 'success');
    });

    // Setup update event listeners
    setupUpdateListeners();

    // Setup update view event listeners
    setupUpdateViewListeners();

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

                // Show connected state in settings (but keep settings view hidden)
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

// Update management functions
function setupUpdateListeners() {
    // Update available
    window.electronEvents.onUpdateAvailable((info) => {
        console.log('[UPDATE] Update available:', info.version);
        updateAvailable = true;
        updateInfo = info;
        showUpdateButton();
    });

    // Download progress
    window.electronEvents.onUpdateDownloadProgress((progress) => {
        updateDownloadProgress(progress.percent);
    });

    // Update downloaded
    window.electronEvents.onUpdateDownloaded((info) => {
        console.log('[UPDATE] Update downloaded:', info.version);
        updateDownloading = false;
        updateReady = true;
        showUpdateReadyButton();
    });

    // Update error
    window.electronEvents.onUpdateError((error) => {
        console.error('[UPDATE] Update error:', error.message);
        showNotification(`Update error: ${error.message}`, 'error');
        hideUpdateButton();
    });
}

function showUpdateButton() {
    const sidebar = document.querySelector('.sidebar');

    // Check if button already exists
    let updateBtn = document.getElementById('update-btn');

    if (!updateBtn) {
        updateBtn = document.createElement('button');
        updateBtn.id = 'update-btn';
        updateBtn.className = 'update-btn';
        updateBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 6v6l4 2"></path>
            </svg>
            <span>Update Available</span>
            <span class="update-badge">NEW</span>
        `;

        // Insert before connection status
        const connectionStatus = document.querySelector('.connection-status');
        if (connectionStatus && connectionStatus.parentNode) {
            connectionStatus.parentNode.insertBefore(updateBtn, connectionStatus);
        }

        updateBtn.addEventListener('click', () => {
            // Navigate to update view instead of showing modal
            showUpdateView();
        });
    }

    updateBtn.style.display = 'flex';
}

function hideUpdateButton() {
    const updateBtn = document.getElementById('update-btn');
    if (updateBtn) {
        updateBtn.style.display = 'none';
    }
}

function showUpdateReadyButton() {
    const updateBtn = document.getElementById('update-btn');
    if (updateBtn) {
        updateBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Restart to Update</span>
            <span class="update-badge ready">READY</span>
        `;
    }

    // If update view is currently active, update it
    if (document.getElementById('update-view').classList.contains('active')) {
        populateUpdateView();
    }
}

function showUpdateModal() {
    const modal = document.createElement('div');
    modal.className = 'modal active';

    if (updateReady) {
        // Update is ready to install
        modal.innerHTML = `
            <div class="modal-content update-modal">
                <h2>Update Ready</h2>
                <p>Version ${updateInfo.version} has been downloaded and is ready to install.</p>
                <p>The application will restart to complete the installation.</p>
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="closeUpdateModal()">Later</button>
                    <button class="btn btn-primary" onclick="installUpdate()">Restart Now</button>
                </div>
            </div>
        `;
    } else if (updateDownloading) {
        // Update is downloading
        modal.innerHTML = `
            <div class="modal-content update-modal">
                <h2>Downloading Update</h2>
                <p>Version ${updateInfo.version} is being downloaded...</p>
                <div class="update-progress-bar">
                    <div class="update-progress-fill" id="update-progress-fill" style="width: 0%"></div>
                </div>
                <p class="update-progress-text" id="update-progress-text">0%</p>
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="closeUpdateModal()">Close</button>
                </div>
            </div>
        `;
    } else {
        // Update available but not downloaded yet
        modal.innerHTML = `
            <div class="modal-content update-modal">
                <h2>Update Available</h2>
                <p><strong>Version ${updateInfo.version}</strong> is available for download.</p>
                ${updateInfo.releaseNotes ? `
                    <div class="release-notes">
                        <h3>What's New:</h3>
                        <p>${updateInfo.releaseNotes}</p>
                    </div>
                ` : ''}
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="closeUpdateModal()">Later</button>
                    <button class="btn btn-primary" onclick="downloadUpdate()">Download Update</button>
                </div>
            </div>
        `;
    }

    document.body.appendChild(modal);
}

function closeUpdateModal() {
    const modal = document.querySelector('.modal.active');
    if (modal && modal.querySelector('.update-modal')) {
        modal.remove();
    }
}

async function downloadUpdate() {
    updateDownloading = true;

    // Show progress in update view
    const progressElement = document.getElementById('update-progress');
    if (progressElement) {
        progressElement.style.display = 'block';
    }

    // Update status
    const statusElement = document.getElementById('update-status');
    if (statusElement) {
        statusElement.textContent = 'Downloading...';
    }

    // Hide download button
    const downloadBtn = document.getElementById('download-update-btn');
    if (downloadBtn) {
        downloadBtn.style.display = 'none';
    }

    const result = await window.electronAPI.updates.download();
    if (!result.success) {
        showNotification(`Failed to download update: ${result.error}`, 'error');
        // Reset UI
        if (progressElement) {
            progressElement.style.display = 'none';
        }
        if (statusElement) {
            statusElement.textContent = 'Update available';
        }
        if (downloadBtn) {
            downloadBtn.style.display = 'block';
        }
        updateDownloading = false;
    }
}

function updateDownloadProgress(percent) {
    const progressFill = document.getElementById('update-progress-fill');
    const progressPercent = document.getElementById('update-progress-percent');
    const progressText = document.getElementById('update-progress-text');

    if (progressFill) {
        progressFill.style.width = `${percent}%`;
    }
    if (progressPercent) {
        progressPercent.textContent = `${Math.round(percent)}%`;
    }
    // Display downloaded and total size if possible
    if (progressText && arguments.length > 1) {
        const info = arguments[1];
        progressText.textContent = `${info.downloaded} MB / ${info.total} MB (${Math.round(percent)}%)`;
    }
}

async function installUpdate() {
    await window.electronAPI.updates.install();
}

function showUpdateView() {
    // Update navigation
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));

    // Display the update view
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    const updateView = document.getElementById('update-view');
    if (updateView) {
        updateView.classList.add('active');
    }

    // Populate update information
    populateUpdateView();
}

function populateUpdateView() {
    const versionElement = document.getElementById('update-version');
    const statusElement = document.getElementById('update-status');
    const notesElement = document.getElementById('release-notes-content');
    const downloadBtn = document.getElementById('download-update-btn');
    const installBtn = document.getElementById('install-update-btn');

    if (versionElement && updateInfo) {
        versionElement.textContent = updateInfo.version;
    }

    if (statusElement) {
        if (updateReady) {
            statusElement.textContent = 'Ready to install';
            downloadBtn.style.display = 'none';
            installBtn.style.display = 'block';
        } else if (updateDownloading) {
            statusElement.textContent = 'Downloading...';
            downloadBtn.style.display = 'none';
            installBtn.style.display = 'none';
        } else {
            statusElement.textContent = 'Update available';
            downloadBtn.style.display = 'block';
            installBtn.style.display = 'none';
        }
    }

    if (notesElement && updateInfo && updateInfo.releaseNotes) {
        notesElement.innerHTML = updateInfo.releaseNotes.replace(/\n/g, '<br>');
    } else {
        notesElement.innerHTML = '<p>No release notes available.</p>';
    }
}

function setupUpdateViewListeners() {
    // Download update button
    const downloadBtn = document.getElementById('download-update-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadUpdate);
    }

    // Install update button
    const installBtn = document.getElementById('install-update-btn');
    if (installBtn) {
        installBtn.addEventListener('click', installUpdate);
    }

    // Cancel update button
    const cancelBtn = document.getElementById('cancel-update-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            // Navigate back to platforms view
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            document.querySelector('[data-view="platforms"]').classList.add('active');

            document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
            document.getElementById('platforms-view').classList.add('active');
        });
    }
}

// Function to update settings view state based on connection status
function updateSettingsViewState() {
    // Check current connection status
    const isConnected = currentUser !== null;

    if (isConnected) {
        // Show connected state
        document.getElementById('server-url-step').classList.remove('active');
        document.getElementById('auth-step').classList.remove('active');
        document.getElementById('connected-state').classList.add('active');
    } else {
        // Show server URL step for connection
        document.getElementById('server-url-step').classList.add('active');
        document.getElementById('auth-step').classList.remove('active');
        document.getElementById('connected-state').classList.remove('active');
    }
}

// Logout functionality
document.getElementById('settings-logout-btn').addEventListener('click', async () => {
    try {
        const result = await window.electronAPI.config.logout();
        if (result.success) {
            // Logout successful - the IPC handler will reload the login page
            console.log('Logout successful');
        } else {
            console.error('Logout failed:', result.error);
            showResult('Logout failed', 'error');
        }
    } catch (error) {
        console.error('Logout error:', error);
        showResult('Logout failed', 'error');
    }
});

function displayPaginationControls() {
    const paginationContainer = document.getElementById('pagination-controls');
    if (!paginationContainer) {
        console.warn('Pagination container not found');
        return;
    }

    // Hide pagination if only one page or no ROMs
    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }

    // Calculate page range to display (max 5 pages)
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    // Adjust start page if we're near the end
    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    // Create pagination HTML
    let paginationHtml = '<div class="pagination-controls">';

    // Previous button
    const prevDisabled = currentPage <= 1 ? 'disabled' : '';
    paginationHtml += `<button class="btn-pagination prev-btn" ${prevDisabled} data-page="${currentPage - 1}">‹ Previous</button>`;

    // Page numbers
    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === currentPage ? 'active' : '';
        paginationHtml += `<button class="btn-pagination page-btn ${activeClass}" data-page="${i}">${i}</button>`;
    }

    // Next button
    const nextDisabled = currentPage >= totalPages ? 'disabled' : '';
    paginationHtml += `<button class="btn-pagination next-btn" ${nextDisabled} data-page="${currentPage + 1}">Next ›</button>`;

    // Page info
    paginationHtml += `<div class="pagination-info">Page ${currentPage} of ${totalPages} (${totalRoms} ROMs)</div>`;

    paginationHtml += '</div>';

    paginationContainer.innerHTML = paginationHtml;

    // Add event listeners
    paginationContainer.querySelectorAll('.btn-pagination:not([disabled])').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const page = parseInt(e.target.dataset.page);
            if (page && page >= 1 && page <= totalPages && page !== currentPage) {
                await loadRomsForPlatform(currentPlatformId, currentPlatforms.find(p => p.id === currentPlatformId), page);
            }
        });
    });
}

