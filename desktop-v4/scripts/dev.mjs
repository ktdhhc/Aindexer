import fs from "node:fs";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopDir = path.join(rootDir, "desktop-v4");
const backendDir = path.join(rootDir, "backend");
const frontendDir = path.join(rootDir, "frontend-v3");
const isWindows = process.platform === "win32";
const defaultBackendPort = 18000;
const defaultFrontendPort = 16733;

const children = [];
const tempPaths = [];
let shuttingDown = false;

function commandName(name) {
  return isWindows ? `${name}.cmd` : name;
}

function spawnManaged(name, command, args, cwd, extraEnv = {}) {
  const useShell = isWindows && command.endsWith(".cmd");
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...extraEnv,
    },
    shell: useShell,
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

function requestStatus(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode || 0);
    });
    request.once("error", reject);
  });
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode || 0,
          body,
        });
      });
    });
    request.once("error", reject);
  });
}

function waitForHttpOk(url, label, timeoutMs = 60_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const status = await requestStatus(url);
        if (status >= 200 && status < 300) {
          console.log(`[dev] ${label} ready at ${url}`);
          resolve();
          return;
        }
      } catch {
        // keep polling until timeout
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`${label} did not respond with HTTP 2xx at ${url}`));
        return;
      }
      setTimeout(check, 400);
    };
    void check();
  });
}

function waitForOpenApiRoute(url, routePath, methods, timeoutMs = 60_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const response = await requestText(url);
        if (response.status >= 200 && response.status < 300) {
          const parsed = JSON.parse(response.body);
          const route = parsed?.paths?.[routePath];
          if (route && methods.every((method) => route[method])) {
            console.log(`[dev] backend route ready ${methods.join(",").toUpperCase()} ${routePath}`);
            resolve();
            return;
          }
        }
      } catch {
        // keep polling until timeout
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`backend route ${routePath} (${methods.join(",")}) not available in OpenAPI`));
        return;
      }
      setTimeout(check, 400);
    };
    void check();
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
  for (const target of [...tempPaths].reverse()) {
    try {
      fs.rmSync(target, { force: true, recursive: true });
    } catch {
      // ignore temp cleanup failures
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
  const backendPort = await pickPreferredPort(defaultBackendPort);
  const frontendPort = await pickPreferredPort(defaultFrontendPort);
  const dataDir = resolveDesktopDataDir();
  const tauriConfigPath = writeTauriDevConfig(frontendPort);

  console.log(
    `[dev] starting desktop-v4 stack on frontend=${frontendPort} backend=${backendPort} data=${dataDir}`,
  );

  spawnManaged(
    "backend",
    "python",
    ["-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", String(backendPort)],
    backendDir,
    {
      APP_HOST: "127.0.0.1",
      APP_PORT: String(backendPort),
      AINDEXER_DATA_DIR: dataDir,
    },
  );
  await waitForPort(backendPort, "backend");
  await waitForHttpOk(`http://127.0.0.1:${backendPort}/api/system/client_state`, "backend client_state");
  await waitForOpenApiRoute(
    `http://127.0.0.1:${backendPort}/openapi.json`,
    "/api/system/client_state",
    ["get", "put"],
  );
  await verifyDataDir(backendPort, dataDir);

  spawnManaged(
    "frontend",
    commandName("npm"),
    ["run", "dev"],
    frontendDir,
    {
      AINDEXER_DEV_FRONTEND_PORT: String(frontendPort),
      AINDEXER_DEV_BACKEND_PORT: String(backendPort),
    },
  );
  await waitForPort(frontendPort, "frontend");
  await waitForHttpOk(`http://127.0.0.1:${frontendPort}/api/system/client_state`, "frontend api proxy");

  spawnManaged(
    "tauri",
    commandName("npm"),
    ["run", "dev:tauri", "--", "--config", tauriConfigPath],
    desktopDir,
    {
      AINDEXER_DEV_FRONTEND_PORT: String(frontendPort),
      AINDEXER_DEV_BACKEND_PORT: String(backendPort),
      AINDEXER_DATA_DIR: dataDir,
    },
  );
}

main().catch((error) => {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
});

function resolveDesktopDataDir() {
  if (process.env.AINDEXER_DATA_DIR) {
    return path.resolve(process.env.AINDEXER_DATA_DIR);
  }
  if (isWindows && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "Aindexer", "v4", "data");
  }
  if (process.env.HOME) {
    return path.join(process.env.HOME, ".local", "share", "aindexer-v4", "data");
  }
  return path.join(rootDir, "data");
}

async function verifyDataDir(backendPort, expectedDataDir) {
  try {
    const { body } = await requestText(`http://127.0.0.1:${backendPort}/api/system/data_dir`);
    const parsed = JSON.parse(body);
    const resolvedExpected = path.resolve(expectedDataDir);
    const resolvedActual = path.resolve(parsed?.data_dir ?? "");
    if (resolvedActual !== resolvedExpected) {
      console.warn(
        `[dev] WARNING: backend DATA_DIR mismatch! expected=${resolvedExpected} actual=${resolvedActual}`,
      );
    } else {
      console.log(`[dev] backend DATA_DIR confirmed: ${resolvedActual}`);
    }
  } catch (err) {
    console.warn(`[dev] WARNING: could not verify backend DATA_DIR: ${err.message}`);
  }
}

function pickPreferredPort(preferredPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => {
      const fallbackServer = net.createServer();
      fallbackServer.unref();
      fallbackServer.once("error", reject);
      fallbackServer.listen(0, "127.0.0.1", () => {
        const address = fallbackServer.address();
        const port = typeof address === "object" && address ? address.port : null;
        fallbackServer.close(() => {
          if (!port) {
            reject(new Error("failed to pick a local port"));
            return;
          }
          resolve(port);
        });
      });
    });
    server.listen(preferredPort, "127.0.0.1", () => {
      server.close(() => resolve(preferredPort));
    });
  });
}

function writeTauriDevConfig(frontendPort) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aindexer-v4-dev-"));
  const configPath = path.join(tempDir, "tauri.dev.override.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      build: {
        devUrl: `http://127.0.0.1:${frontendPort}/v3/workbench`,
      },
    }),
  );
  tempPaths.push(configPath, tempDir);
  return configPath;
}
