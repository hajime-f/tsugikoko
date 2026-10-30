import { createHash } from "node:crypto";
import type { FsqRow } from "../../src/lib/places/foursquare";
export function fsqFixture() {
  const row: FsqRow = { id: "111111111111111111111111", name: "検証寿司", address: "東京都渋谷区テスト町1-2-3",
    latitude: 35.646162, longitude: 139.7085709, genre: "sushi", refreshed: new Date().toISOString().slice(0, 10), flags: [] };
  const rows = [row];
  return { format: 1 as const, source: "Foursquare OS Places" as const, generatedAt: new Date().toISOString(),
    version: createHash("sha256").update(JSON.stringify(rows)).digest("hex"), rows };
}
export const fsqFixtureUrl = "https://www.google.com/maps/place/検証寿司+恵比寿店/data=!3d35.646162!4d139.7085709";
