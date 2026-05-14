import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(desktopDir, "..");
const backendDir = path.join(rootDir, "backend");
const frontendDir = path.join(rootDir, "frontend-v3");
const packageJsonPath = path.join(desktopDir, "package.json");
const backendVenvPython = process.platform === "win32"
  ? path.join(backendDir, ".venv", "Scripts", "python.exe")
  : path.join(backendDir, ".venv", "bin", "python");
const python = resolveBackendPython();
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

function canExecute(command, args, cwd) {
  try {
    const result = spawnSync(command, args, {
      cwd,
      env: process.env,
      stdio: "ignore",
      shell: process.platform === "win32" && command.endsWith(".cmd"),
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function resolveBackendPython() {
  if (process.env.AINDEXER_PYTHON) {
    return process.env.AINDEXER_PYTHON;
  }
  if (fs.existsSync(backendVenvPython) && canExecute(backendVenvPython, ["--version"], backendDir)) {
    return backendVenvPython;
  }
  return "python";
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

function readDesktopVersion() {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
    throw new Error(`Missing desktop-v4 version in ${packageJsonPath}`);
  }
  return packageJson.version.trim();
}

function formatTimestampPart(value) {
  return String(value).padStart(2, "0");
}

function createBuildStamp(now = new Date()) {
  const yy = formatTimestampPart(now.getFullYear() % 100);
  const mm = formatTimestampPart(now.getMonth() + 1);
  const dd = formatTimestampPart(now.getDate());
  const hh = formatTimestampPart(now.getHours());
  const min = formatTimestampPart(now.getMinutes());
  return {
    folder: `${yy}${mm}${dd}`,
    time: `${hh}${min}`,
  };
}

function collectInstaller() {
  const installerFiles = fs
    .readdirSync(installerTargetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"))
    .map((entry) => ({
      name: entry.name,
      mtimeMs: fs.statSync(path.join(installerTargetDir, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (installerFiles.length === 0) {
    throw new Error(`No installer exe found in ${installerTargetDir}`);
  }

  const version = readDesktopVersion();
  const stamp = createBuildStamp();
  const versionedOutputDir = path.join(installerOutputDir, `${stamp.folder}_v${version}`);
  const outputName = `Aindexer_v4-win-x64-setup-(${stamp.time}).exe`;

  fs.mkdirSync(versionedOutputDir, { recursive: true });

  const sourcePath = path.join(installerTargetDir, installerFiles[0].name);
  const outputPath = path.join(versionedOutputDir, outputName);
  fs.copyFileSync(sourcePath, outputPath);

  console.log(`[build] installer copied to ${outputPath}`);
}

runStep("building frontend-v3", commandName("npm"), ["run", "build"], frontendDir);
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
