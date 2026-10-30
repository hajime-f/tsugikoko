import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { prepareFsqRow, fsqCatalogSchema } from "../src/lib/places/foursquare.ts";
// Usage: node --import tsx scripts/prepare-foursquare.mts input.json output.json
const [input, output] = process.argv.slice(2);
if (!input || !output || input === output) throw new Error("Specify distinct input.json and output.json paths");
if ((await stat(input)).size > 50_000_000) throw new Error("Input exceeds 50 MB; prepare a bounded region first");
const raw = JSON.parse(await readFile(input, "utf8"));
if (raw.source !== "Foursquare OS Places (Apache-2.0)" || raw.truncated !== false || !Array.isArray(raw.rows)) throw new Error("Expected complete, attributed Foursquare OS export");
const rows = raw.rows.map(prepareFsqRow).filter((value: unknown) => value !== null);
if (new Set(rows.map((row: { id: string }) => row.id)).size !== rows.length) throw new Error("Duplicate place IDs");
const catalog = fsqCatalogSchema.parse({ format: 1, source: "Foursquare OS Places", generatedAt: new Date().toISOString(),
  version: createHash("sha256").update(JSON.stringify(rows)).digest("hex"), rows });
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(catalog), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ inputRows: raw.rows.length, catalogRows: rows.length, version: catalog.version }));
