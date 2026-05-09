import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(desktopDir, "..");
const frontendDir = path.join(rootDir, "frontend-v3");
const python = process.env.AINDEXER_PYTHON || "python";
const installerTargetDir = path.join(
  desktopDir,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "nsis",
);
const installerOutputDir = path.join(rootDir, "dist", "desktop-v4-installer");

function commandName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function runStep(label, command, args, cwd) {
  console.log(`[build] ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function collectInstaller() {
  const installerFiles = fs
    .readdirSync(installerTargetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"))
    .map((entry) => entry.name)
    .sort();

  if (installerFiles.length === 0) {
    throw new Error(`No installer exe found in ${installerTargetDir}`);
  }

  fs.rmSync(installerOutputDir, { recursive: true, force: true });
  fs.mkdirSync(installerOutputDir, { recursive: true });

  const installerName = installerFiles[installerFiles.length - 1];
  const sourcePath = path.join(installerTargetDir, installerName);
  const outputPath = path.join(installerOutputDir, installerName);
  fs.copyFileSync(sourcePath, outputPath);

  console.log(`[build] installer copied to ${outputPath}`);
}

runStep("building frontend-v3", commandName("npm"), ["run", "build"], frontendDir);
runStep("syncing desktop version", commandName("npm"), ["run", "sync:version"], desktopDir);
runStep(
  "building packaged sidecar",
  python,
  [path.join(desktopDir, "scripts", "build-sidecar.py")],
  desktopDir,
);
runStep(
  "building tauri installer",
  commandName("npm"),
  ["run", "build:tauri", "--", "--config", "src-tauri/tauri.bundle.conf.json"],
  desktopDir,
);
collectInstaller();
