const { spawn } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

/**
 * Base class for all emulators
 * Defines the common interface and functionality
 */
class Emulator {
    constructor(config) {
        this.config = config;
        this.platform = config.platform;
        this.name = config.name;
        this.extensions = config.extensions || [];
        this.defaultArgs = config.args || ['{rom}'];
    }

    /**
     * Get the emulator executable path
     */
    getExecutablePath() {
        return this.config.path;
    }

    /**
     * Set the emulator executable path
     */
    setExecutablePath(path) {
        this.config.path = path;
    }

    /**
     * Check if emulator is configured
     */
    isConfigured() {
        return !!(this.config.path && fsSync.existsSync(this.config.path));
    }

    /**
     * Prepare emulator arguments by replacing placeholders
     */
    prepareArgs(romPath, saveDir) {
        return this.defaultArgs.map(arg =>
            arg.replace('{rom}', romPath)
                .replace('{save}', saveDir)
        );
    }

    /**
     * Setup emulator environment before launch
     * Override in subclasses for platform-specific setup
     */
    async setupEnvironment(rom, saveDir, rommAPI, saveManager) {
        // Default implementation - no special setup needed
        return { success: true };
    }

    /**
     * Handle save synchronization after emulator closes
     * Override in subclasses for platform-specific save handling
     */
    async handleSaveSync(rom, saveDir, rommAPI, saveManager) {
        // Default implementation - no save sync needed
        return { success: true };
    }

    /**
     * Launch the emulator
     */
    async launch(romPath, saveDir) {
        const emulatorPath = this.getExecutablePath();

        if (!emulatorPath) {
            return {
                success: false,
                error: `Emulator path not configured for ${this.name}`
            };
        }

        // Prepare arguments
        const args = this.prepareArgs(romPath, saveDir);

        console.log(`Launching ${this.name}: ${emulatorPath} ${args.join(' ')}`);

        // Launch emulator
        const emulatorProcess = spawn(emulatorPath, args, {
            detached: false,
            stdio: 'ignore'
        });

        return {
            success: true,
            process: emulatorProcess,
            message: `ROM launched`,
            pid: emulatorProcess.pid
        };
    }

    /**
     * Get save comparison info for user choice
     * Override in subclasses that support save choice
     */
    async getSaveComparison(rom, saveDir, rommAPI, saveManager) {
        return {
            success: true,
            data: {
                hasLocal: false,
                hasCloud: false,
                localSave: null,
                cloudSaves: [],
                recommendation: 'none'
            }
        };
    }

    /**
     * Handle save choice selection
     * Override in subclasses that support save choice
     */
    async handleSaveChoice(romData, saveChoice, saveManager, rommAPI, saveId = null) {
        // Default implementation - just launch normally
        return this.launch(romData.rom, romData.saveDir, rommAPI, saveManager);
    }
}

module.exports = Emulator;