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

for (const file of files) {
  const filePath = path.join(DATA_DIR, file);
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const meta = json.metadata;

  if (!meta?.lastUpdated) {
    console.warn(`? ${file}: no metadata.lastUpdated field, skipping`);
    continue;
  }

  const lastUpdated = new Date(meta.lastUpdated);
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

if (overdue > 0) {
  console.error(`\n${overdue} data file(s) are past their stated review cadence. Review and update data/*.json metadata.lastUpdated.`);
  process.exit(1);
}

console.log("\nAll knowledge base files are within their stated review cadence.");
