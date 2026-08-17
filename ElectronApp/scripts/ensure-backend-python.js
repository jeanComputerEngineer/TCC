const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const backendDir = path.join(repoRoot, "Backend");
const venvDir = path.join(backendDir, ".venv");
const pythonExe =
  process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python3");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: backendDir,
    stdio: "inherit",
    env: process.env,
    shell: false,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function createVenv() {
  if (fs.existsSync(pythonExe)) {
    return;
  }
  console.log("Criando ambiente Python isolado em Backend\\.venv...");
  const launcher = process.platform === "win32" ? "py" : "python3";
  const launcherArgs = process.platform === "win32" ? ["-3", "-m", "venv", ".venv"] : ["-m", "venv", ".venv"];
  run(launcher, launcherArgs);
}

function installDependencies() {
  console.log("Verificando dependencias Python do backend...");
  run(pythonExe, ["-m", "pip", "install", "--upgrade", "pip"]);
  run(pythonExe, [
    "-m",
    "pip",
    "install",
    "--upgrade",
    "-r",
    "requirements.txt",
    "pyinstaller",
  ]);
}

createVenv();
installDependencies();
