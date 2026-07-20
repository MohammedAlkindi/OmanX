// scripts/check-kb-freshness.js
// The compliance knowledge base (data/*.json) is hand-maintained with a
// stated update cadence in its own metadata, but nothing ever checked
// whether a file had actually gone past that cadence. Visa/immigration
// rules that quietly go stale ship wrong guidance with no visible signal.
//
// Run manually with `npm run check:kb-freshness`, or via the scheduled
// kb-freshness GitHub Actions workflow.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const FREQUENCY_DAYS = {
  monthly: 30,
  quarterly: 90,
  "semi-annual": 180,
  biannual: 180,
  annual: 365,
  yearly: 365,
};
const DEFAULT_FREQUENCY_DAYS = 90;

const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
let overdue = 0;
let invalid = 0;

for (const file of files) {
  const filePath = path.join(DATA_DIR, file);
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const meta = json.metadata;

  if (!meta?.lastUpdated) {
    // Not "skipping" — a compliance file with no review date is a file
    // nobody can tell is stale, which is the condition this check exists
    // to catch.
    console.error(`[INVALID] ${file}: no metadata.lastUpdated field. Every knowledge base file must declare when it was last reviewed.`);
    invalid++;
    continue;
  }

  const lastUpdated = new Date(meta.lastUpdated);
  // An unparseable date yields NaN, and `NaN > cadenceDays` is false, so a
  // corrupted lastUpdated used to log "NaNd ago" and exit 0 — the check
  // reported healthy precisely when it could no longer tell.
  if (Number.isNaN(lastUpdated.getTime())) {
    console.error(`[INVALID] ${file}: metadata.lastUpdated is not a parseable date (got ${JSON.stringify(meta.lastUpdated)}). Expected YYYY-MM-DD.`);
    invalid++;
    continue;
  }
  const ageDays = Math.floor((Date.now() - lastUpdated.getTime()) / (24 * 60 * 60 * 1000));

  const frequencyKey = (meta.updateFrequency || "").toLowerCase();
  const cadenceDays = FREQUENCY_DAYS[frequencyKey] ?? DEFAULT_FREQUENCY_DAYS;
  if (!(frequencyKey in FREQUENCY_DAYS)) {
    console.warn(`? ${file}: unrecognized updateFrequency "${meta.updateFrequency}", assuming ${DEFAULT_FREQUENCY_DAYS}-day cadence`);
  }

  const isOverdue = ageDays > cadenceDays;
  if (isOverdue) overdue++;

  const status = isOverdue ? "OVERDUE" : "ok";
  console.log(
    `[${status}] ${file}: last updated ${meta.lastUpdated} (${ageDays}d ago), ` +
    `${meta.updateFrequency || "unknown"} cadence (${cadenceDays}d)`
  );
}

if (invalid > 0) {
  console.error(`\n${invalid} data file(s) have missing or unparseable review metadata, so their freshness cannot be determined.`);
}
if (overdue > 0) {
  console.error(`\n${overdue} data file(s) are past their stated review cadence. Review and update data/*.json metadata.lastUpdated.`);
}
if (invalid > 0 || overdue > 0) process.exit(1);

console.log("\nAll knowledge base files are within their stated review cadence.");
