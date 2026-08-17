const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const frontendDir = path.resolve(__dirname, "..", "..", "Frontend");
const nodeModulesDir = path.join(frontendDir, "node_modules");
const ngBinary = path.join(nodeModulesDir, ".bin", process.platform === "win32" ? "ng.cmd" : "ng");

function ensureDependencies() {
  const needsInstall =
    !fs.existsSync(nodeModulesDir) ||
    !fs.existsSync(ngBinary);

  if (!needsInstall) {
    return;
  }
  console.log("Instalando dependências do frontend...");
  let command = "npm";
  let args = ["install", "--no-audit", "--no-fund"];
  let options = {
    cwd: frontendDir,
    stdio: "inherit",
    env: process.env,
    shell: false
  };
  if (process.platform === "win32") {
    command = process.env.ComSpec || "cmd.exe";
    args = ["/c", "npm", ...args];
  }
  const result = spawnSync(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

ensureDependencies();
