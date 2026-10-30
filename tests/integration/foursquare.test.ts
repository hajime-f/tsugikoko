import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { database } from "../../src/server/firebase/admin";
import { createPlace, updatePlace, removeFoursquare, listPlaces } from "../../src/server/places/service";
import { loadFsqCatalog, lookupSavedFsq, selectedFsq, lookupFsqUrl } from "../../src/server/places/foursquare";
import { backfillUrlFacts } from "../../src/server/places/backfill";
import { POST, DELETE } from "../../src/app/api/places/[id]/foursquare/route";
import { fsqFixture, fsqFixtureUrl } from "../fixtures/foursquare";
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.GCLOUD_PROJECT !== "demo-tsugikoko") throw new Error("Demo emulator required");
const original = { enabled: process.env.FOURSQUARE_ENABLED, path: process.env.FOURSQUARE_CATALOG_PATH };
const catalog = fsqFixture(), origin = { row: catalog.rows[0], version: catalog.version };
let directory: string;
before(async () => { directory = await mkdtemp(join(tmpdir(), "tsugikoko-fsq-")); process.env.FOURSQUARE_ENABLED = "true";
  process.env.FOURSQUARE_CATALOG_PATH = join(directory, "catalog.json"); await writeFile(process.env.FOURSQUARE_CATALOG_PATH, JSON.stringify(catalog)); });
after(async () => { for (const [key, value] of Object.entries({ FOURSQUARE_ENABLED: original.enabled, FOURSQUARE_CATALOG_PATH: original.path })) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
} await rm(directory, { recursive: true, force: true }); });
const setup = async () => { const uid = `fsq-${randomUUID()}`; return { uid, place: (await createPlace(uid, `${fsqFixtureUrl}?case=${uid}`)).place }; };

test("短縮リンク解決後の候補、曖昧候補、報告付き、IDのみを区別", async () => {
  const result = await lookupFsqUrl("https://maps.app.goo.gl/test", { ...catalog, resolve: async () => fsqFixtureUrl });
  assert.equal(result.automatic, true); assert.equal(result.candidates[0].id, origin.row.id);
  assert.equal(result.candidates[0].exact, false);
  assert.equal((await lookupFsqUrl(fsqFixtureUrl, { ...catalog, rows: [origin.row, { ...origin.row, id: "222222222222222222222222" }] })).automatic, false);
  assert.equal((await lookupFsqUrl(fsqFixtureUrl, { ...catalog, rows: [{ ...origin.row, flags: ["duplicate"] }] })).automatic, false);
  assert.equal((await lookupFsqUrl("https://maps.google.com/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4", catalog)).candidates.length, 0);
});
test("本人・有効な候補・カタログ版数だけを許可し、停止時は候補を送らない", async () => {
  const { uid, place } = await setup();
  assert.equal((await loadFsqCatalog()).version, catalog.version);
  assert.equal((await lookupSavedFsq(uid, place.id)).candidates.length, 1);
  await assert.rejects(lookupSavedFsq("other", place.id), { status: 404 });
  await assert.rejects(selectedFsq(uid, place.id, { id: "222222222222222222222222", version: catalog.version }), { status: 409 });
  await assert.rejects(selectedFsq(uid, place.id, { id: origin.row.id, version: "0".repeat(64) }), { status: 409 });
  process.env.FOURSQUARE_ENABLED = "false";
  try { assert.equal((await lookupSavedFsq(uid, place.id)).enabled, false); await assert.rejects(selectedFsq(uid, place.id, { id: origin.row.id, version: catalog.version }), { status: 503 }); }
  finally { process.env.FOURSQUARE_ENABLED = "true"; }
  await updatePlace(uid, place.id, { action: "trash" });
  await assert.rejects(lookupSavedFsq(uid, place.id), { status: 404 });
  for (const handler of [POST, DELETE]) assert.equal((await handler(new Request("http://localhost/api/places/x/foursquare", { method: handler === POST ? "POST" : "DELETE" }), { params: Promise.resolve({ id: place.id }) })).status, 401);
});
test("取り込み情報は検索対象へ保存し、共通情報とバックフィルへ出さず、後の手修正を残して撤回", async () => {
  const { uid, place } = await setup();
  const saved = await updatePlace(uid, place.id, { name: origin.row.name, address: origin.row.address, genre: origin.row.genre,
    note: "本人メモ", expectedUpdatedAt: place.updatedAt }, origin);
  assert.equal(saved.foursquare?.id, origin.row.id);
  assert.equal(saved.genre, "sushi");
  assert.equal((await listPlaces(uid, false, null, "all", { q: "検証寿司", genre: "sushi", sort: "newest" })).places.length, 1);
  const shared = database().doc(`urlFacts/${createHash("sha256").update(place.url).digest("hex")}`);
  assert.equal((await shared.get()).exists, false);
  await backfillUrlFacts({ apply: true });
  assert.equal((await shared.get()).exists, false);
  const edited = await updatePlace(uid, place.id, { name: "本人が直した店名", address: saved.address, genre: saved.genre, note: "本人メモ", expectedUpdatedAt: saved.updatedAt });
  assert.equal((await database().doc(`users/${uid}/savedPlaces/${place.id}`).get()).get("foursquareSource.importedAt"), saved.updatedAt);
  assert.equal((await shared.get()).exists, false);
  process.env.FOURSQUARE_ENABLED = "false";
  try {
    const removed = await removeFoursquare(uid, place.id, edited.updatedAt);
    assert.equal(removed.name, "本人が直した店名"); assert.equal(removed.address, ""); assert.equal(removed.genre, null); assert.equal(removed.note, "本人メモ");
    assert.equal(removed.foursquare, undefined); assert.equal(removed.foursquareImported, true);
  } finally { process.env.FOURSQUARE_ENABLED = "true"; }
});
test("編集競合では保存せず、別ユーザーの撤回を拒否し、元の値を復元", async () => {
  const { uid, place } = await setup();
  const initial = await updatePlace(uid, place.id, { name: "元の店名", address: "元の住所", genre: "cafe", note: "" });
  const details = { name: origin.row.name, address: origin.row.address, genre: origin.row.genre, note: "" };
  await assert.rejects(updatePlace(uid, place.id, { ...details, expectedUpdatedAt: place.updatedAt }, origin), { status: 409 });
  const saved = await updatePlace(uid, place.id, { ...details, expectedUpdatedAt: initial.updatedAt }, origin);
  await assert.rejects(removeFoursquare("other", place.id), { status: 404 });
  await assert.rejects(removeFoursquare(uid, place.id, initial.updatedAt), { status: 409 });
  const restored = await removeFoursquare(uid, place.id, saved.updatedAt);
  assert.equal(restored.name, initial.name); assert.equal(restored.address, initial.address); assert.equal(restored.genre, initial.genre);
});
test("候補から何も取り込まなかった手入力は出典フラグを付けず、保存で候補表示枠を二重消費しない", async () => {
  const { uid, place } = await setup();
  await lookupSavedFsq(uid, place.id);
  const limit = database().doc(`users/${uid}/limits/foursquare`);
  const count = (await limit.get()).get("count");
  await selectedFsq(uid, place.id, { id: origin.row.id, version: catalog.version });
  assert.equal((await limit.get()).get("count"), count);
  const saved = await updatePlace(uid, place.id, { name: "本人入力", address: "本人が入力した住所", genre: "cafe", note: "", expectedUpdatedAt: place.updatedAt }, origin);
  assert.equal(saved.foursquareImported, undefined); assert.equal(saved.foursquare, undefined);
  assert.equal((await database().doc(`urlFacts/${createHash("sha256").update(place.url).digest("hex")}`).get()).get("name"), "本人入力");
});
