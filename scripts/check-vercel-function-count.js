// scripts/check-vercel-function-count.js
// Guards against the exact incident that broke production on 2026-07-18:
// every .js file directly under api/ (recursively) is auto-deployed by
// Vercel as its own Serverless Function, and the Hobby plan caps a
// deployment at 12. Underscore-prefixed files/dirs are excluded from that
// count (Vercel's documented convention for shared, non-route code).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.join(__dirname, "..", "api");
const VERCEL_HOBBY_FUNCTION_LIMIT = 12;

function isExcluded(relativePath) {
  return relativePath.split(path.sep).some((segment) => segment.startsWith("_"));
}

function findJsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      results.push(fullPath);
    }
  }
  return results;
}

const allFiles = findJsFiles(API_DIR).map((f) => path.relative(API_DIR, f));
const counted = allFiles.filter((f) => !isExcluded(f));
const excluded = allFiles.filter((f) => isExcluded(f));

console.log(`Serverless functions under api/: ${counted.length}/${VERCEL_HOBBY_FUNCTION_LIMIT}`);
for (const f of counted) console.log(`  - ${f}`);
if (excluded.length) {
  console.log(`Excluded (underscore-prefixed, not deployed as functions):`);
  for (const f of excluded) console.log(`  - ${f}`);
}

// A file counted as a function but exporting no default handler is not a
// route — it is a shared helper that Vercel is deploying anyway, burning a
// slot and publishing a URL that 500s on every request. api/rate-limit.js
// and api/auth-utils.js sat in exactly that state and consumed 2 of 12.
// Matched statically rather than by importing: these modules read env vars
// and construct clients at module scope, which must not run in CI.
const HANDLER_PATTERN = /export\s+default\s/;
const missingHandler = counted.filter(
  (f) => !HANDLER_PATTERN.test(fs.readFileSync(path.join(API_DIR, f), "utf8"))
);

if (missingHandler.length) {
  console.error(
    `\nFAIL: ${missingHandler.length} file(s) under api/ are deployed as Serverless ` +
    `Functions but export no default handler:\n` +
    missingHandler.map((f) => `  - ${f}`).join("\n") +
    `\n\nThese are helpers, not routes. Each one wastes a function slot and serves ` +
    `a public URL that fails at runtime. Rename to an underscore prefix ` +
    `(e.g. api/_my-helper.js) and update its imports.`
  );
  process.exit(1);
}

if (counted.length > VERCEL_HOBBY_FUNCTION_LIMIT) {
  console.error(
    `\nFAIL: ${counted.length} functions exceeds the Vercel Hobby plan limit of ${VERCEL_HOBBY_FUNCTION_LIMIT}.\n` +
    `Move shared/helper modules to an underscore-prefixed file (e.g. api/_my-helper.js) ` +
    `so Vercel doesn't deploy them as routes.`
  );
  process.exit(1);
}

if (counted.length === VERCEL_HOBBY_FUNCTION_LIMIT) {
  console.warn(
    `\nWARNING: at ${counted.length}/${VERCEL_HOBBY_FUNCTION_LIMIT}. There is no headroom — ` +
    `adding any new route will fail the deployment with ` +
    `exceeded_serverless_functions_per_deployment. Free a slot before adding one.`
  );
}

console.log("\nOK");
