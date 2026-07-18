// scripts/check-syntax.js
// Cheap sanity gate: parses every project .js file with `node --check` so a
// typo in a file nothing imports (or nothing tests yet) still fails CI
// instead of shipping to production.

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".vercel", ".claude"]);

function findJsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = findJsFiles(ROOT);
let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    failed++;
    console.error(`FAIL: ${path.relative(ROOT, file)}`);
    console.error(err.stderr?.toString() || err.message);
  }
}

console.log(`\nChecked ${files.length} files, ${failed} failed.`);
if (failed > 0) process.exit(1);
