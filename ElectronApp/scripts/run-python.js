const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

function resolveCandidates() {
  const custom = process.env.PROCESSADOR_PYTHON;
  const list = [];
  if (custom && custom.trim().length > 0) {
    list.push(custom.trim());
  }
  const repoRoot = path.resolve(__dirname, "..", "..");
  const venvPath =
    process.platform === "win32"
      ? path.join(repoRoot, "Backend", ".venv", "Scripts", "python.exe")
      : path.join(repoRoot, "Backend", ".venv", "bin", "python3");
  if (fs.existsSync(venvPath)) {
    if (process.platform === "win32") {
      list.push(`"${venvPath}"`);
    } else {
      list.push(venvPath);
    }
  }
  if (process.platform === "win32") {
    list.push("python.exe", "python3.exe", "py -3", "py");
  } else {
    list.push("python3", "python", "python3.12", "python3.11");
  }
  return list;
}

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

function candidateWorks(command) {
  const { cmd, args } = splitCommand(command);
  if (!cmd) {
    return null;
  }
  const result = spawnSync(cmd, [...args, "--version"], {
    stdio: "ignore",
    env: process.env
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return { cmd, args };
}

function main() {
  const scriptArgs = process.argv.slice(2);
  if (scriptArgs.length === 0) {
    console.error("Uso: node run-python.js <script.py> [args...]");
    process.exit(1);
  }
  const [script, ...rest] = scriptArgs;
  const scriptPath = path.resolve(script);
  const candidates = resolveCandidates();

  for (const candidate of candidates) {
    const resolved = candidateWorks(candidate);
    if (!resolved) {
      continue;
    }
    const attemptArgs = [...resolved.args, scriptPath, ...rest];
    const result = spawnSync(resolved.cmd, attemptArgs, {
      stdio: "inherit",
      env: process.env,
      cwd: path.dirname(scriptPath)
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== null && result.status !== 0) {
      process.exit(result.status);
    }
    return;
  }

  console.error("Não foi possível localizar um interpretador Python. Configure a variável PROCESSADOR_PYTHON.");
  process.exit(1);
}

main();
