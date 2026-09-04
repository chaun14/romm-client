# RomM Client

Electron app for Linux (Appimage) & Windows that plugs into the [RomM](https://github.com/rommapp/romm) API to provide a desktop experience for launching emulators with synced ROMs and save data.

## Disclaimer

This project is not affliated with the RomM project. It is a third-party client built to enhance the RomM experience.

**IT IS REALLY EARLY STAGE, PLEASE CONSIDER IT AS A PROOF OF CONCEPT, IT MIGHT CONTAIN BUGS, DELETE SAVES OR BAD STUFF LIKE THAT, USE AT YOUR OWN RISK!**

## Screenshot

<img width="733" height="490" alt="screenshot1" src="https://raw.githubusercontent.com/chaun14/romm-client/refs/heads/master/docs/images/screenshot1.png" />

## Features

- Browse and launch ROMs from your RomM server
- Automatic download and caching of ROM files
- Sync save data between local storage and RomM server
- Support for multiple emulators (e.g., PPSSPP, Dolphin...)
- Offline mode: play your ROMs without an internet connection (if you have them cached)

## Supported Emulators

- PPSSPP (PlayStation Portable)
- PCSX2 (PlayStation 2) ⚠️ beta
- Dolphin (GameCube/Wii) ⚠️ beta
- Azahar (3ds) ⚠️ beta
- RomM's Built-in EmulatorJS system (web-based emulators)
