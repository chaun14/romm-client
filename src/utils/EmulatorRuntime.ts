import path from "path";

export function getPpssppSessionMemstickDirectory(sessionDirectory: string, platform: NodeJS.Platform = process.platform): string {
  const memstickContainer = path.join(sessionDirectory, "memstick");
  return platform === "linux" ? path.join(memstickContainer, "ppsspp") : memstickContainer;
}

export function getPcsx2DataRoot(container: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "linux" ? path.join(container, "PCSX2") : container;
}

export function getPcsx2LaunchArguments(romPath: string, platform: NodeJS.Platform = process.platform): string[] {
  const args = ["-fullscreen", "--", romPath];
  return platform === "linux" ? args : ["-portable", ...args];
}
