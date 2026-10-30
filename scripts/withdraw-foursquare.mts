// 個人記録のFoursquare取り込みだけを撤回する。既定は読み取りのみ、上限到達は明示。
// node --conditions=react-server --import tsx scripts/withdraw-foursquare.mts [--apply]
import { database } from "../src/server/firebase/admin";
import { removeFoursquare } from "../src/server/places/service";
const apply = process.argv.includes("--apply"), cap = 20_000;
if (process.env.FOURSQUARE_ENABLED === "true") throw new Error("Disable Foursquare before withdrawal");
const records = await database().collectionGroup("savedPlaces").select("foursquareSource", "updatedAt").limit(cap + 1).get();
// 全件読めなければ部分撤回せず停止する。規模拡大時はページングへ変更する。
if (records.size > cap) throw new Error("Scan limit reached; no records changed. Add paginated withdrawal before proceeding.");
let candidates = 0, changed = 0, conflicts = 0;
for (const record of records.docs) {
  if (!record.get("foursquareSource")) continue;
  const path = record.ref.path.split("/");
  if (path.length !== 4 || path[0] !== "users" || path[2] !== "savedPlaces") continue;
  candidates++;
  if (apply) {
    try { await removeFoursquare(path[1], record.id, record.get("updatedAt")); changed++; }
    catch (error) { if ((error as { status?: number }).status === 409) conflicts++; else throw error; }
  }
}
console.log(JSON.stringify({ apply, scanned: records.size, candidates, changed, conflicts }));
if (conflicts) process.exitCode = 2;
