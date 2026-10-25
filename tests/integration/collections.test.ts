import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminAuth, database } from "../../src/server/firebase/admin";
import { changeCollection, collectionsRef, getCollections, getMembership, setMembership } from "../../src/server/places/collections";
import { createPlace, listPlaces, updatePlace, updateVisit } from "../../src/server/places/service";
import { collectionActionSchema, membershipSchema } from "../../src/lib/places/schema";
import { GET, POST } from "../../src/app/api/places/lists/route";
import { PATCH } from "../../src/app/api/places/[id]/route";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.GCLOUD_PROJECT !== "demo-tsugikoko" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") throw new Error("Local demo emulators required");
const setup = async () => {
  const uid = `lists-${randomUUID()}`;
  const first = (await changeCollection(uid, { action: "create", name: "旅行" })).list!;
  const second = (await changeCollection(uid, { action: "create", name: "デート" })).list!;
  const place = (await createPlace(uid, "https://www.instagram.com/p/collection-test/")).place;
  return { uid, first, second, place };
};
const filters = (list: string) => ({ q: "", genre: "all" as const, sort: "newest" as const, list });

test("リスト名の検証、再試行、名前重複、古い画面からの変更を扱う", async () => {
  const { uid, first, second } = await setup();
  assert.equal(collectionActionSchema.safeParse({ action: "create", name: "   " }).success, false);
  assert.equal(collectionActionSchema.safeParse({ action: "create", name: "あ".repeat(41) }).success, false);
  assert.equal(membershipSchema.safeParse({ action: "setLists", listIds: [first.id, first.id], expectedListIds: [] }).success, false);
  assert.equal((await changeCollection(uid, { action: "create", name: first.name })).list!.id, first.id);
  const renamed = (await changeCollection(uid, { action: "rename", id: first.id, name: "京都旅行", updatedAt: first.updatedAt })).list!;
  await assert.rejects(changeCollection(uid, { action: "delete", id: first.id, updatedAt: first.updatedAt }), { status: 409 });
  await assert.rejects(changeCollection(uid, { action: "rename", id: first.id, name: second.name, updatedAt: renamed.updatedAt }), { status: 409 });
  await changeCollection(uid, { action: "delete", id: first.id, updatedAt: renamed.updatedAt });
  await changeCollection(uid, { action: "delete", id: first.id, updatedAt: renamed.updatedAt });
  assert.equal((await getCollections(uid)).length, 1);
});

test("同時作成でも50件を超えず、同じ名前は1件になる", async () => {
  const uid = `limit-${randomUUID()}`, now = Date.now();
  await collectionsRef(uid).set({ items: Array.from({ length: 49 }, (_, i) => ({ id: randomUUID(), name: `リスト${i}`, createdAt: now, updatedAt: now })) });
  const results = await Promise.allSettled(["追加A", "追加B"].map(name => changeCollection(uid, { action: "create", name })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await getCollections(uid)).length, 50);
  const another = `duplicate-${randomUUID()}`;
  const same = await Promise.all(["ＣＡＦＥ", "cafe"].map(name => changeCollection(another, { action: "create", name })));
  assert.equal(same[0].list!.id, same[1].list!.id);
});

test("複数所属・検索・訪問・ごみ箱復元・分類解除でも同じ保存記録を使う", async () => {
  const { uid, first, second, place } = await setup();
  assert.deepEqual((await getMembership(uid, place.id)).listIds, []);
  await setMembership(uid, place.id, { action: "setLists", listIds: [first.id, second.id], expectedListIds: [] });
  await updatePlace(uid, place.id, { name: "京都カフェ", address: "京都市", note: "窓際", genre: "cafe" });
  assert.equal((await listPlaces(uid, false, null, "saved", { ...filters(first.id), q: "京都 窓際", genre: "cafe", sort: "name" })).places.length, 1);
  assert.equal((await listPlaces(uid, false, null, "all", filters("unfiled"))).places.length, 0);
  await updateVisit(uid, place.id, { action: "addVisit", visitId: randomUUID(), visitedOn: "2024-01-01", rating: 5, comment: "また行きたい" });
  assert.equal((await listPlaces(uid, false, null, "saved", filters(first.id))).places.length, 0);
  assert.equal((await listPlaces(uid, false, null, "visited", filters(second.id))).places[0].visitCount, 1);
  await updatePlace(uid, place.id, { action: "trash" });
  await assert.rejects(setMembership(uid, place.id, { action: "setLists", listIds: [], expectedListIds: [first.id, second.id] }), { status: 409 });
  assert.equal((await listPlaces(uid, false, null, "all", filters(first.id))).places.length, 0);
  assert.equal((await listPlaces(uid, true, null, "all", filters(first.id))).places.length, 1);
  await changeCollection(uid, { action: "delete", id: first.id, updatedAt: first.updatedAt });
  await updatePlace(uid, place.id, { action: "restore" });
  assert.deepEqual((await getMembership(uid, place.id)).listIds, [second.id]);
  await changeCollection(uid, { action: "delete", id: second.id, updatedAt: second.updatedAt });
  const unfiled = (await listPlaces(uid, false, null, "all", filters("unfiled"))).places;
  assert.equal(unfiled.length, 1); assert.equal(unfiled[0].note, "窓際"); assert.equal(unfiled[0].visitCount, 1);
  assert.deepEqual(unfiled[0].listIds, []);
  const recreated = (await changeCollection(uid, { action: "create", name: second.name })).list!;
  assert.notEqual(recreated.id, second.id);
  assert.equal((await listPlaces(uid, false, null, "all", filters(recreated.id))).places.length, 0);
});

test("古い所属の上書きを拒否し、再試行では重複せず、削除済みリストを追加しない", async () => {
  const { uid, first, second, place } = await setup();
  const input = { action: "setLists" as const, listIds: [first.id], expectedListIds: [] };
  await setMembership(uid, place.id, input); await setMembership(uid, place.id, input);
  await assert.rejects(setMembership(uid, place.id, { ...input, listIds: [second.id] }), { status: 409 });
  const other = await setup();
  await assert.rejects(setMembership(uid, place.id, { ...input, listIds: [other.first.id], expectedListIds: [first.id] }), { status: 409 });
  await assert.rejects(getMembership(`absent-${randomUUID()}`, place.id), { status: 409 });
  assert.deepEqual((await getMembership(other.uid, other.place.id)).listIds, []);
  await changeCollection(uid, { action: "delete", id: first.id, updatedAt: first.updatedAt });
  await assert.rejects(setMembership(uid, place.id, input), { status: 409 });
});

test("特定リストで30件ずつ取得し、旧データも未分類に表示する", async () => {
  const { uid, first, place } = await setup();
  const batch = database().batch();
  for (let i = 0; i < 65; i++) batch.set(database().doc(`users/${uid}/savedPlaces/${i.toString(16).padStart(64, "0")}`), {
    ...place, name: `店${i}`, createdAt: Date.now() - i * 1000, listIds: [first.id],
  });
  await batch.commit();
  const ids: string[] = []; let cursor: string | null = null;
  do { const page = await listPlaces(uid, false, cursor, "all", filters(first.id)); ids.push(...page.places.map(place => place.id)); assert.ok(page.places.length <= 30); cursor = page.nextCursor; } while (cursor);
  assert.equal(ids.length, 65); assert.equal(new Set(ids).size, 65);
  assert.deepEqual((await listPlaces(uid, false, null, "all", filters("unfiled"))).places.map(p => p.id), [place.id]);
});

test("リストAPIは認証と本人の所有権・入力検証を必須にする", async () => {
  const { uid, first, place } = await setup();
  await adminAuth().createUser({ uid });
  const auth = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=test", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: await adminAuth().createCustomToken(uid), returnSecureToken: true }),
  });
  const { idToken } = await auth.json() as { idToken: string };
  const req = (body?: unknown) => new Request("http://localhost/api/places/lists", { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await GET(new Request("http://localhost/api/places/lists"))).status, 401);
  assert.equal((await POST(req({ action: "create", name: "test", uid: "other" }))).status, 400);
  assert.equal((await GET(req())).status, 200);
  const otherUid = `other-${randomUUID()}`, otherList = (await changeCollection(otherUid, { action: "create", name: "秘密" })).list!;
  assert.equal((await POST(req({ action: "delete", id: otherList.id, updatedAt: otherList.updatedAt }))).status, 200);
  assert.equal((await getCollections(otherUid)).length, 1);
  assert.equal((await PATCH(req({ action: "setLists", listIds: [otherList.id], expectedListIds: [] }), { params: Promise.resolve({ id: place.id }) })).status, 409);
  assert.equal((await PATCH(req({ action: "setLists", listIds: [first.id], expectedListIds: [] }), { params: Promise.resolve({ id: place.id }) })).status, 200);
});
