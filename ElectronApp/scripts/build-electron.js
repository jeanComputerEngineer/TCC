const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const electronDir = path.resolve(__dirname, "..");
const stagingDir = path.join(os.tmpdir(), "processador-imagens-raizes-electron-build");
const outputDirName = "release-output";
const builderCli = path.join(
  electronDir,
  "node_modules",
  "electron-builder",
  "cli.js"
);
const electronPackageJson = path.join(electronDir, "node_modules", "electron", "package.json");

if (!fs.existsSync(builderCli)) {
  console.error("electron-builder nao encontrado. Execute `npm run ensure:electron`.");
  process.exit(1);
}
if (!fs.existsSync(electronPackageJson)) {
  console.error("electron nao encontrado. Execute `npm run ensure:electron`.");
  process.exit(1);
}

const electronVersion = JSON.parse(fs.readFileSync(electronPackageJson, "utf8")).version;

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function copyProjectToStaging() {
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  for (const entry of ["package.json", "package-lock.json", "main.js", "preload.js", "dist", "resources"]) {
    const source = path.join(electronDir, entry);
    if (fs.existsSync(source)) {
      fs.cpSync(source, path.join(stagingDir, entry), { recursive: true });
    }
  }
}

function installRuntimeDependencies() {
  if (process.platform === "win32") {
    run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm", "install", "--omit=dev", "--no-audit", "--no-fund"], stagingDir);
    return;
  }
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], stagingDir);
}

function copyReleaseOutputBack() {
  const stagedOutput = path.join(stagingDir, outputDirName);
  const finalOutput = path.join(electronDir, outputDirName);
  fs.rmSync(finalOutput, { recursive: true, force: true });
  fs.cpSync(stagedOutput, finalOutput, { recursive: true });
}

copyProjectToStaging();
installRuntimeDependencies();
run(process.execPath, [builderCli, "--win", `--config.electronVersion=${electronVersion}`], stagingDir);
copyReleaseOutputBack();

console.log(`Artefatos do Electron copiados para ${path.join(electronDir, outputDirName)}`);
