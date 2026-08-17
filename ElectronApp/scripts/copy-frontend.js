const fs = require("fs");
const path = require("path");

async function ensureDirEmpty(target) {
  await fs.promises.rm(target, { recursive: true, force: true });
  await fs.promises.mkdir(target, { recursive: true });
}

async function copyRecursive(source, target) {
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await fs.promises.mkdir(targetPath, { recursive: true });
      await copyRecursive(sourcePath, targetPath);
    } else if (entry.isSymbolicLink()) {
      const link = await fs.promises.readlink(sourcePath);
      await fs.promises.symlink(link, targetPath);
    } else {
      await fs.promises.copyFile(sourcePath, targetPath);
    }
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const electronDist = path.resolve(__dirname, "..", "dist", "renderer");
  const override = process.env.PROCESSADOR_FRONTEND_DIST;
  let angularDist;

  if (override) {
    angularDist = path.resolve(repoRoot, override);
  } else {
    const distRoot = path.join(repoRoot, "Frontend", "dist");
    if (!fs.existsSync(distRoot)) {
      throw new Error(`Diretório ${distRoot} inexistente. Execute "npm run build:frontend".`);
    }
    const entries = await fs.promises.readdir(distRoot, { withFileTypes: true });
    const projectDir = entries.find((entry) => entry.isDirectory());
    if (!projectDir) {
      throw new Error(`Nenhum build encontrado em ${distRoot}.`);
    }
    const candidate = path.join(distRoot, projectDir.name, "browser");
    if (!fs.existsSync(candidate)) {
      throw new Error(`Diretório browser não encontrado em ${candidate}.`);
    }
    angularDist = candidate;
  }

  await ensureDirEmpty(electronDist);
  await copyRecursive(angularDist, electronDist);
  console.log(`Arquivos do frontend copiados para ${electronDist}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
