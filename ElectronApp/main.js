const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog } = require("electron");
const { spawn, spawnSync } = require("child_process");
const net = require("net");
const log = require("electron-log/main");
const waitOn = require("wait-on");

log.initialize();

const APP_TITLE = "Processador de Imagens de Ra\u00EDzes";
const DEFAULT_BACKEND_PORT = Number.parseInt(process.env.PROCESSADOR_PORT ?? "", 10) || 8765;
const BACKEND_HOST = process.env.PROCESSADOR_HOST || "127.0.0.1";

const isDev = !app.isPackaged;
let backendPort = DEFAULT_BACKEND_PORT;
let pythonProcess = null;
let cleanedBackends = false;
let isQuitting = false;

app.setName(APP_TITLE);

function splitCommand(command) {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { cmd: "", args: [] };
  }
  if (trimmed.startsWith("\"")) {
    const closing = trimmed.indexOf("\"", 1);
    if (closing === -1) {
      return { cmd: trimmed.slice(1), args: [] };
    }
    const cmd = trimmed.slice(1, closing);
    const rest = trimmed.slice(closing + 1).trim();
    const args = rest.length > 0 ? rest.split(/\s+/) : [];
    return { cmd, args };
  }
  const parts = trimmed.split(/\s+/);
  return { cmd: parts[0], args: parts.slice(1) };
}

function resolvePythonInvoker() {
  const repoRoot = path.resolve(__dirname, "..");
  const venvPath =
    process.platform === "win32"
      ? path.join(repoRoot, "Backend", ".venv", "Scripts", "python.exe")
      : path.join(repoRoot, "Backend", ".venv", "bin", "python3");

  const candidates = [];
  const seen = new Set();

  const pushCandidate = (value) => {
    if (!value) {
      return;
    }
    let candidate = value;
    if (typeof value === "string") {
      const parsed = splitCommand(value);
      if (!parsed.cmd) {
        return;
      }
      candidate = parsed;
    }
    const key = `${candidate.cmd} ${candidate.args.join(" ")}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  };

  const custom = process.env.PROCESSADOR_PYTHON;
  if (custom && custom.trim().length > 0) {
    pushCandidate(custom.trim());
  }
  if (fs.existsSync(venvPath)) {
    if (process.platform === "win32") {
      pushCandidate(`"${venvPath}"`);
    } else {
      pushCandidate(venvPath);
    }
  }

  if (process.platform === "win32") {
    pushCandidate("python.exe");
    pushCandidate("python3.exe");
    pushCandidate({ cmd: "py", args: ["-3"] });
    pushCandidate("py");
  } else {
    pushCandidate("python3");
    pushCandidate("python");
    pushCandidate("python3.12");
    pushCandidate("python3.11");
  }

  for (const candidate of candidates) {
    const check = spawnSync(candidate.cmd, [...candidate.args, "--version"], {
      stdio: "ignore"
    });
    if (!check.error && check.status === 0) {
      return { command: candidate.cmd, args: candidate.args };
    }
  }
  return null;
}

function killStaleBackends() {
  if (cleanedBackends || isDev) {
    return;
  }
  cleanedBackends = true;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/IM", "processador-backend.exe", "/F"], {
        stdio: "ignore"
      });
      spawnSync("taskkill", ["/IM", "root-analyzer-backend.exe", "/F"], {
        stdio: "ignore"
      });
    } else {
      spawnSync("pkill", ["-f", "processador-backend"], { stdio: "ignore" });
      spawnSync("pkill", ["-f", "root-analyzer-backend"], { stdio: "ignore" });
    }
  } catch (error) {
    log.warn(`Failed to terminate stale backend processes: ${error.message}`);
  }
}

function getBackendTarget() {
  if (isDev) {
    const pythonInvoker = resolvePythonInvoker();
    if (!pythonInvoker) {
      throw new Error(
        "Python interpreter not found. Set PROCESSADOR_PYTHON to an absolute path."
      );
    }
    const backendDir = path.resolve(__dirname, "../Backend");
    const scriptPath = path.join(backendDir, "start_server.py");
    return {
      command: pythonInvoker.command,
      args: [...pythonInvoker.args, scriptPath],
      options: {
        cwd: backendDir,
        env: {
          ...process.env,
          PROCESSADOR_PORT: String(backendPort),
          PROCESSADOR_HOST: BACKEND_HOST,
          UVICORN_NO_COLOR: "1"
        }
      }
    };
  }
  const resourcesPath = process.resourcesPath;
  let backendExecutable = path.join(
    resourcesPath,
    "python",
    process.platform === "win32" ? "processador-backend.exe" : "processador-backend"
  );
  if (!fs.existsSync(backendExecutable) && process.platform === "win32") {
    const legacy = path.join(
      resourcesPath,
      "python",
      "root-analyzer-backend.exe"
    );
    if (fs.existsSync(legacy)) {
      backendExecutable = legacy;
    }
  }
  return {
    command: backendExecutable,
    args: [],
    options: {
      cwd: path.dirname(backendExecutable),
      env: {
        ...process.env,
        PROCESSADOR_PORT: String(backendPort),
        PROCESSADOR_HOST: BACKEND_HOST,
        UVICORN_NO_COLOR: "1"
      }
    }
  };
}

function startBackend() {
  if (pythonProcess) {
    return;
  }
  killStaleBackends();
  const target = getBackendTarget();
  if (!isDev) {
    const cmdPath = target.command;
    if (!fs.existsSync(cmdPath)) {
      dialog.showErrorBox(
        "Backend missing",
        `Could not find the backend executable at ${cmdPath}.\nReinstall the application or run the backend build before packaging.`
      );
      app.quit();
      return;
    }
  }
  log.info("Starting backend", target.command);
  pythonProcess = spawn(target.command, target.args, target.options);
  pythonProcess.stdout.on("data", (chunk) => {
    log.info(`[backend] ${chunk.toString().trim()}`);
  });
  pythonProcess.stderr.on("data", (chunk) => {
    log.error(`[backend] ${chunk.toString().trim()}`);
  });
  pythonProcess.on("exit", (code, signal) => {
    log.warn(`Backend exited (code=${code} signal=${signal})`);
    pythonProcess = null;
    if (!isDev && !isQuitting) {
      dialog.showErrorBox(
        APP_TITLE,
        "The internal processing service has stopped. Please restart the app."
      );
      app.quit();
    }
  });
}

async function ensureBackendReady() {
  const resource = `http-get://${BACKEND_HOST}:${backendPort}/health`;
  log.info(`Waiting backend at ${resource}`);
  await waitOn({
    resources: [resource],
    timeout: 360000,
    interval: 500,
    validateStatus: (status) => status === 200
  });
}

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    title: APP_TITLE,
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  mainWindow.setTitle(APP_TITLE);

  if (isDev) {
    const devServerUrl = process.env.FRONTEND_URL || "http://127.0.0.1:4200";
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(__dirname, "dist", "renderer", "index.html");
    mainWindow.loadFile(indexPath);
  }

  return mainWindow;
}

async function bootstrap({ skipStart } = {}) {
  if (!skipStart) {
    startBackend();
  } else {
    log.info(`Backend already running on port ${backendPort}, skipping spawn.`);
  }
  try {
    await ensureBackendReady();
  } catch (err) {
    log.error("Failed to start backend:", err);
    dialog.showErrorBox(
      "Startup error",
      "Could not initialize the internal service of Processador de Imagens de Raízes. Please check the logs."
    );
    app.quit();
    return;
  }
  createMainWindow();
}

async function findAvailablePort(preferredPort) {
  const preferred = Number.parseInt(preferredPort, 10);
  const startPort = Number.isFinite(preferred) && preferred > 0 ? preferred : DEFAULT_BACKEND_PORT;

  const canListen = (port) =>
    new Promise((resolve) => {
      const tester = net.createServer()
        .once("error", () => {
          tester.close(() => resolve(false));
        })
        .once("listening", () => {
          tester.close(() => resolve(true));
        });
      tester.listen(port, BACKEND_HOST);
    });

  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await canListen(port)) {
      return port;
    }
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (err) => {
      server.close(() => reject(err));
    });
    server.listen({ port: 0, host: BACKEND_HOST }, () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function isBackendRunning(portCandidate) {
  const portNumber = Number.parseInt(portCandidate, 10);
  if (!Number.isFinite(portNumber) || portNumber <= 0) {
    return false;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const response = await fetch(`http://${BACKEND_HOST}:${portNumber}/health`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    return response.ok;
  } catch (error) {
    return false;
  }
}

app.whenReady()
  .then(async () => {
    app.setName(APP_TITLE);
    const preferredPort = process.env.PROCESSADOR_PORT ?? String(DEFAULT_BACKEND_PORT);
    const reuseExisting = await isBackendRunning(preferredPort);
    if (reuseExisting) {
      backendPort = Number.parseInt(preferredPort, 10) || DEFAULT_BACKEND_PORT;
      log.info(`Detected running backend at port ${backendPort}`);
    } else {
      backendPort = await findAvailablePort(preferredPort);
      log.info(`Selected backend port ${backendPort}`);
    }
    process.env.PROCESSADOR_PORT = String(backendPort);
    await bootstrap({ skipStart: reuseExisting });
  })
  .catch((error) => {
    log.error("Failed to initialize application:", error);
    dialog.showErrorBox(
      APP_TITLE,
      "Could not initialize the application environment. Please check the logs and try again."
    );
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  if (pythonProcess) {
    log.info("Stopping backend process");
    pythonProcess.kill();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});








