import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopDir = path.join(rootDir, "desktop-v4");
const backendDir = path.join(rootDir, "backend");
const frontendDir = path.join(rootDir, "frontend-v3");
const isWindows = process.platform === "win32";

const children = [];
let shuttingDown = false;

function commandName(name) {
  return isWindows ? `${name}.cmd` : name;
}

function spawnManaged(name, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsHide: false,
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`[dev] ${name} exited (${signal || (code ?? 0)})`);
      shutdown(code || 1);
    }
  });
  return child;
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function waitForPort(port, label, timeoutMs = 60_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        console.log(`[dev] ${label} ready on ${port}`);
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`${label} did not open port ${port}`));
          return;
        }
        setTimeout(check, 400);
      });
    };
    check();
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [...children].reverse()) {
    if (child.killed || child.exitCode !== null) continue;
    if (isWindows) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 250);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => {
  for (const child of children) {
    if (!child.killed && child.exitCode === null) child.kill();
  }
});

async function main() {
  console.log("[dev] starting backend, frontend, and Tauri shell");
  if (await isPortOpen(8000)) {
    console.log("[dev] backend already ready on 8000");
  } else {
    spawnManaged("backend", "python", ["-m", "uvicorn", "app.main:app", "--reload"], backendDir);
    await waitForPort(8000, "backend");
  }

  if (await isPortOpen(5173)) {
    console.log("[dev] frontend already ready on 5173");
  } else {
    spawnManaged("frontend", commandName("npm"), ["run", "dev"], frontendDir);
    await waitForPort(5173, "frontend");
  }

  spawnManaged("tauri", commandName("npm"), ["run", "dev:tauri"], desktopDir);
}

main().catch((error) => {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
});
