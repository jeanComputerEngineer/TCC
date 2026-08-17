const fs = require("fs");
const path = require("path");

async function removeReleaseDir(target) {
  try {
    await fs.promises.rm(target, { recursive: true, force: true });
    console.log(`Release directory cleaned: ${target}`);
  } catch (error) {
    console.warn(`Warning: unable to clean ${target}: ${error.message}`);
  }
}

async function main() {
  const baseDir = path.resolve(__dirname, "..");
  const targets = [
    path.join(baseDir, "release"),
    path.join(baseDir, "release-artifacts"),
    path.join(baseDir, "release-output")
  ];
  for (const dir of targets) {
    await removeReleaseDir(dir);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
