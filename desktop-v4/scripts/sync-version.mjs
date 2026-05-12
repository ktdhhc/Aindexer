import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(desktopDir, "package.json");
const cargoTomlPath = path.join(desktopDir, "src-tauri", "Cargo.toml");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function syncCargoVersion(version) {
  const cargoToml = fs.readFileSync(cargoTomlPath, "utf-8");
  const pattern = /(\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m;
  const match = cargoToml.match(pattern);

  if (!match) {
    throw new Error(`Failed to locate package version in ${cargoTomlPath}`);
  }

  const nextCargoToml = cargoToml.replace(pattern, `$1${version}$3`);

  if (nextCargoToml !== cargoToml) {
    fs.writeFileSync(cargoTomlPath, nextCargoToml, "utf-8");
  }
}

function syncTauriConfigVersion(version) {
  const tauriConfPath = path.join(desktopDir, "src-tauri", "tauri.conf.json");
  const tauriConf = fs.readFileSync(tauriConfPath, "utf-8");
  const pattern = /"version"\s*:\s*"[^"]*"/;
  const nextTauriConf = tauriConf.replace(pattern, `"version": "${version}"`);

  if (nextTauriConf !== tauriConf) {
    fs.writeFileSync(tauriConfPath, nextTauriConf, "utf-8");
  }
}

function main() {
  const packageJson = readJson(packageJsonPath);
  const version = String(packageJson.version || "").trim();
  if (!version) {
    throw new Error(`Missing version in ${packageJsonPath}`);
  }

  syncCargoVersion(version);
  syncTauriConfigVersion(version);
  console.log(`[version] desktop-v4 version synced: ${version}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[version] ${message}`);
  process.exit(1);
}
