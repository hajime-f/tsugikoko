import { test } from "node:test";
import assert from "node:assert/strict";
import { fsqCandidates, fsqNameMatch, prepareFsqRow } from "../../src/lib/places/foursquare";
import { fsqFixture } from "../fixtures/foursquare";

test("店名と店舗ピンを合わせて判定し、両方向の支店名欠落・曖昧さを保持", () => {
  const row = fsqFixture().rows[0];
  assert.equal(fsqNameMatch("検証寿司", "検証 寿司"), "exact");
  assert.equal(fsqNameMatch("検証寿司", "検証寿司 恵比寿店"), "branch");
  assert.equal(fsqNameMatch("検証寿司 恵比寿店", "検証寿司"), "branch");
  assert.equal(fsqNameMatch("検証寿司 恵比寿店", "検証寿司 中目黒店"), null);
  assert.equal(fsqCandidates([{ ...row, longitude: row.longitude - 0.02 }], row.name, row).length, 0);
  assert.equal(fsqCandidates([{ ...row, name: "別の寿司店" }], row.name, row).length, 0);
  assert.equal(fsqCandidates([row, { ...row, id: "222222222222222222222222" }], row.name, row).length, 2);
  assert.equal(fsqCandidates([row], "検証寿司 恵比寿店", row)[0].exact, false);
});
test("未確認報告・古い日付・不正な日付を警告し、カテゴリを寿司へ対応", () => {
  const row = fsqFixture().rows[0];
  for (const changed of [{ flags: ["duplicate"] }, { refreshed: "2000-01-01" }, { refreshed: null }, { refreshed: "2026-99-99" }]) {
    assert.ok(fsqCandidates([{ ...row, ...changed }], row.name, row)[0].warnings.length);
  }
  const raw = { country: "JP", name: "検証寿司", fsq_place_id: row.id, region: "東京都", locality: "渋谷区", address: "テスト町1-2-3",
    latitude: row.latitude, longitude: row.longitude, fsq_category_labels: ["Dining and Drinking > Restaurant > Japanese Restaurant > Sushi Restaurant"] };
  assert.equal(prepareFsqRow(raw)?.genre, "sushi");
  assert.equal(prepareFsqRow({ ...raw, date_closed: "2025-01-01" }), null);
  assert.equal(prepareFsqRow({ ...raw, region: "" }), null);
  assert.equal(prepareFsqRow({ ...raw, fsq_category_labels: ["Retail > Shop"] }), null);
});
