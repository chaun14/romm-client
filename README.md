# RomM Client

Electron app that plugs into the [RomM](https://github.com/rommapp/romm) API to provide a desktop experience for launching emulators with synced ROMs and save data.

## Disclaimer

This project is not affliated with the RomM project. It is a third-party client built to enhance the RomM experience.

**IT IS REALLY EARLY STAGE, PLEASE CONSIDER IT AS A PROOF OF CONCEPT, IT MIGHT CONTAIN BUGS, DELETE SAVES OR BAD STUFF LIKE THAT, USE AT YOUR OWN RISK!**

## Screenshot

<img width="733" height="490" alt="screenshot1" src="https://github.com/user-attachments/assets/3cc84c1d-b571-4529-84fb-61061e815e62" />

## Features

- Browse and launch ROMs from your RomM server
- Automatic download and caching of ROM files
- Sync save data between local storage and RomM server
- Support for multiple emulators (e.g., PPSSPP, Dolphin...)

## Downloads

Pre-built packages are published on the [releases page](https://github.com/chaun14/romm-client/releases):

- **Windows** — NSIS installer (`.exe`)
- **macOS** — disk image (`.dmg`)
- **Linux** — AppImage (`.AppImage`) and Flatpak (`.flatpak`)

## Building from source

```bash
npm install
npm run dist:linux   # builds both AppImage and Flatpak
npm run dist:win     # builds the Windows installer
npm run dist:mac     # builds the macOS disk image
```

Building the Flatpak locally requires `flatpak`, `flatpak-builder` and the
`org.electronjs.Electron2.BaseApp//23.08` runtime to be installed.

## Supported Emulators

- PPSSPP (PlayStation Portable)
- PCSX2 (PlayStation 2) ⚠️ beta
- Dolphin (GameCube/Wii)
- RomM's Built-in EmulatorJS system (web-based emulators)
