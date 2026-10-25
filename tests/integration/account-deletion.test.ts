import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminAuth, database } from "../../src/server/firebase/admin";
import { authenticatedUid } from "../../src/server/auth/request";
import { DELETION_DRAIN_MS, deletePreparedAccount, inspectAccountDeletion, prepareAccountDeletion } from "../../src/server/accounts/deletion";
import { listRecommendations } from "../../src/server/recommendations/service";
import { createPlace, processExtraction } from "../../src/server/places/service";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.GCLOUD_PROJECT !== "demo-tsugikoko" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") throw new Error("Local demo emulators required");

test("削除前の本人確認用調査は書き込まず、停止・待機後に本人の認証と全階層の記録だけを削除する", async () => {
  const db = database(), uid = `delete-${randomUUID()}`, other = `keep-${randomUUID()}`;
  await adminAuth().createUser({ uid });
  await adminAuth().createUser({ uid: other });
  const customToken = await adminAuth().createCustomToken(uid);
  const response = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=test", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  assert.equal(response.status, 200);
  const { idToken } = await response.json() as { idToken: string };
  const request = new Request("http://localhost/api/places", { headers: { authorization: `Bearer ${idToken}` } });
  assert.equal(await authenticatedUid(request), uid);
  const { place } = await createPlace(uid, "https://example.com/delete-me");
  await db.doc(`users/${uid}/savedPlaces/${place.id}/nested/detail`).set({ note: "削除対象" });
  await db.doc(`users/${uid}/preferences/area`).set({ prefectureCode: "13" });
  await db.doc(`users/${uid}/recommendationDismissed/place`).set({ createdAt: Date.now() });
  await db.doc(`users/${uid}/milestones/state`).set({ shownThreshold: 1 });
  await db.doc(`users/${other}/savedPlaces/keep`).set({ note: "保持" });
  await db.doc("urlFacts/deletion-test-common").set({ name: "共有の店舗情報" });
  const report = await inspectAccountDeletion(uid);
  assert.equal(report.savedPlaces, 1);
  assert.equal(report.prepared, false);
  assert.equal((await adminAuth().getUser(uid)).disabled, false);
  await assert.rejects(deletePreparedAccount(uid), /Prepare/);
  await assert.rejects(inspectAccountDeletion("../users"), /Invalid/);
  await prepareAccountDeletion(uid);
  await assert.rejects(authenticatedUid(request), error => (error as { status: number }).status === 401);
  await assert.rejects(deletePreparedAccount(uid), /five minutes/);
  await db.doc(`accountDeletions/${uid}`).update({ preparedAt: Date.now() - DELETION_DRAIN_MS - 1 });
  // 管理者が停止を解除した場合には削除を拒否する。
  await adminAuth().updateUser(uid, { disabled: false });
  await assert.rejects(deletePreparedAccount(uid), /enabled/);
  await prepareAccountDeletion(uid);
  await assert.rejects(deletePreparedAccount(uid), /five minutes/);
  await db.doc(`accountDeletions/${uid}`).update({ preparedAt: Date.now() - DELETION_DRAIN_MS - 1 });
  const batch = db.batch();
  for (let i = 0; i < 301; i++) batch.set(db.doc(`users/cache-${i}/recommendations/current`), { items: [] });
  await batch.commit();
  await db.doc("recommendationModel/current").set({ data: uid });
  await db.doc("recommendationModel/lock").delete();
  const result = await deletePreparedAccount(uid);
  assert.ok(result.removedRecommendationCaches >= 301);
  await assert.rejects(adminAuth().getUser(uid), error => (error as { code: string }).code === "auth/user-not-found");
  assert.equal((await db.doc(`users/${uid}/savedPlaces/${place.id}/nested/detail`).get()).exists, false);
  assert.equal((await db.doc(`users/${uid}`).listCollections()).length, 0);
  assert.equal((await db.doc(`accountDeletions/${uid}`).get()).exists, false);
  assert.equal((await db.doc("recommendationModel/current").get()).exists, false);
  assert.equal((await db.doc("recommendationModel/lock").get()).exists, false);
  assert.equal((await db.doc(`users/${other}/savedPlaces/keep`).get()).get("note"), "保持");
  assert.equal((await adminAuth().getUser(other)).disabled, false);
  assert.equal((await db.doc("urlFacts/deletion-test-common").get()).exists, true);
  // 遅れて届いた取得ジョブが削除済みの保存記録を作り直さない。
  assert.equal(await processExtraction(uid, place.id, { fetcher: async () => { throw new Error("Must not fetch"); } }), "done");
  assert.equal((await db.doc(`users/${uid}`).listCollections()).length, 0);
});

test("削除前に読み取りを始めたおすすめ集計が、削除後に本人のデータを再保存しない", async () => {
  const db = database(), uid = `racing-${randomUUID()}`;
  await adminAuth().createUser({ uid });
  await db.doc(`users/${uid}/savedPlaces/test`).set({ placeId: "a".repeat(64), deleted: false });
  await prepareAccountDeletion(uid);
  await db.doc(`accountDeletions/${uid}`).update({ preparedAt: Date.now() - DELETION_DRAIN_MS - 1 });
  await db.doc("recommendationModel/current").delete();
  await db.doc("recommendationModel/lock").delete();
  let readStarted!: () => void, resume!: () => void;
  const started = new Promise<void>(resolve => { readStarted = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const original = db.collectionGroup.bind(db);
  db.collectionGroup = ((name: string) => {
    const group = original(name);
    if (name === "savedPlaces") {
      const originalSelect = group.select.bind(group);
      group.select = (...fields) => {
        const selected = originalSelect(...fields), originalLimit = selected.limit.bind(selected);
        selected.limit = count => {
          const limited = originalLimit(count), originalGet = limited.get.bind(limited);
          limited.get = async () => { const snapshot = await originalGet(); readStarted(); await gate; return snapshot; };
          return limited;
        };
        return selected;
      };
    }
    return group;
  }) as typeof db.collectionGroup;
  const pending = listRecommendations("reader", null);
  const rejected = assert.rejects(pending, error => (error as { status: number }).status === 503);
  try {
    await started;
    await deletePreparedAccount(uid);
  } finally {
    db.collectionGroup = original;
    resume();
  }
  await rejected;
  assert.equal((await db.doc("recommendationModel/current").get()).exists, false);
});

test("削除中断後の保守状態では推薦を止め、認証情報削除後でも同じ処理を再開できる", async () => {
  const db = database(), uid = `retry-${randomUUID()}`;
  await adminAuth().createUser({ uid });
  await prepareAccountDeletion(uid);
  await db.doc(`accountDeletions/${uid}`).update({ preparedAt: Date.now() - DELETION_DRAIN_MS - 1 });
  const original = db.recursiveDelete.bind(db);
  db.recursiveDelete = async () => { throw new Error("Simulated failure"); };
  try { await assert.rejects(deletePreparedAccount(uid), /Simulated failure/); }
  finally { db.recursiveDelete = original; }
  await assert.rejects(listRecommendations("reader", null), error => (error as { status: number }).status === 503);
  assert.equal((await db.doc(`accountDeletions/${uid}`).get()).exists, true);
  await adminAuth().deleteUser(uid);
  await prepareAccountDeletion(uid);
  await deletePreparedAccount(uid);
  assert.equal((await db.doc("recommendationModel/lock").get()).exists, false);
  assert.equal((await db.doc(`accountDeletions/${uid}`).get()).exists, false);
});
