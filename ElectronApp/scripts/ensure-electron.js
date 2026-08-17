const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const electronDir = path.resolve(__dirname, "..");
const nodeModulesDir = path.join(electronDir, "node_modules");
const builderBinary = path.join(
  nodeModulesDir,
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder"
);

function runNpmInstall() {
  console.log("Instalando dependencias do Electron...");
  const result = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: electronDir,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!fs.existsSync(nodeModulesDir) || !fs.existsSync(builderBinary)) {
  runNpmInstall();
}
