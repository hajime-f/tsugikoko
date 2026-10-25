import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminAuth, database } from "../../src/server/firebase/admin";
import { authenticatedUid } from "../../src/server/auth/request";
import { DELETION_DRAIN_MS, deletePreparedAccount, inspectAccountDeletion, prepareAccountDeletion } from "../../src/server/accounts/deletion";
import { listRecommendations } from "../../src/server/recommendations/service";
import { createPlace, processExtraction } from "../../src/server/places/service";
import { requestAccountDeletion, processAccountDeletion } from "../../src/server/accounts/dispatch";
import { POST as requestDeletion } from "../../src/app/api/account/deletion/route";
import { POST as deletionWorker } from "../../src/app/api/internal/account-deletion/route";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.GCLOUD_PROJECT !== "demo-tsugikoko" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") throw new Error("Local demo emulators required");

test("退会APIは本人の直近認証と確認を必須にし、待機後のジョブで本人だけを削除する", async () => {
  const db = database(), uid = `self-${randomUUID()}`, other = `other-${randomUUID()}`;
  await adminAuth().createUser({ uid });
  await adminAuth().createUser({ uid: other });
  await db.doc(`users/${uid}/savedPlaces/self`).set({ note: "本人" });
  await db.doc(`users/${other}/savedPlaces/other`).set({ note: "他人" });
  const response = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=test", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: await adminAuth().createCustomToken(uid), returnSecureToken: true }),
  });
  assert.equal(response.status, 200);
  const { idToken } = await response.json() as { idToken: string };
  const request = (body: unknown, token = idToken) => new Request("http://localhost/api/account/deletion", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  assert.equal((await requestDeletion(request({ confirmation: "delete-account" }, "invalid"))).status, 401);
  assert.equal((await requestDeletion(request({ confirmation: "delete-account", uid: other }))).status, 400);
  assert.equal((await requestDeletion(request({}))).status, 400);
  // エミュレーターの署名なしトークンだけを編集して、期限切れの本人確認を再現する。
  const parts = idToken.split(".");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  payload.auth_time = Math.floor(Date.now() / 1000) - 600;
  parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
  assert.equal((await requestDeletion(request({ confirmation: "delete-account" }, parts.join(".")))).status, 401);
  assert.equal((await adminAuth().getUser(uid)).disabled, false);
  assert.equal((await db.doc(`accountDeletions/${uid}`).get()).exists, false);
  assert.equal((await deletionWorker(request({ uid, requestId: randomUUID() }))).status, 401);
  const accepted = await requestDeletion(request({ confirmation: "delete-account" }));
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { accepted: true });
  const job = await db.doc(`accountDeletions/${uid}`).get(), requestId = job.get("requestId");
  assert.equal(typeof requestId, "string");
  assert.equal((await adminAuth().getUser(uid)).disabled, true);
  assert.equal(await processAccountDeletion(uid, randomUUID()), "done");
  assert.equal(await processAccountDeletion(uid, requestId), "waiting");
  assert.equal((await db.doc(`users/${uid}/savedPlaces/self`).get()).exists, true);
  await db.doc(`accountDeletions/${uid}`).update({ preparedAt: Date.now() - DELETION_DRAIN_MS - 1 });
  assert.equal(await processAccountDeletion(uid, requestId), "done");
  assert.equal(await processAccountDeletion(uid, requestId), "done");
  assert.equal((await db.doc(`users/${uid}`).listCollections()).length, 0);
  await assert.rejects(adminAuth().getUser(uid), { code: "auth/user-not-found" });
  assert.equal((await db.doc(`users/${other}/savedPlaces/other`).get()).get("note"), "他人");
  assert.equal((await adminAuth().getUser(other)).disabled, false);
});

test("キュー登録失敗では停止せず、受付後の停止失敗はジョブが再開し、二重受付は元のジョブを維持する", async () => {
  const db = database(), uid = `dispatch-${randomUUID()}`;
  await adminAuth().createUser({ uid });
  await assert.rejects(requestAccountDeletion(uid, async () => { throw new Error("Queue unavailable"); }), /Queue unavailable/);
  assert.equal((await adminAuth().getUser(uid)).disabled, false);
  assert.equal((await db.doc(`accountDeletions/${uid}`).get()).exists, false);
  const original = adminAuth().updateUser.bind(adminAuth());
  adminAuth().updateUser = async () => { throw new Error("Temporary auth failure"); };
  try { assert.deepEqual(await requestAccountDeletion(uid), { accepted: true }); }
  finally { adminAuth().updateUser = original; }
  const job = await db.doc(`accountDeletions/${uid}`).get(), requestId = job.get("requestId");
  assert.equal(job.get("preparedAt"), undefined);
  assert.equal(await processAccountDeletion(uid, requestId), "waiting");
  const preparedAt = (await db.doc(`accountDeletions/${uid}`).get()).get("preparedAt");
  await requestAccountDeletion(uid);
  const retried = await db.doc(`accountDeletions/${uid}`).get();
  assert.equal(retried.get("requestId"), requestId);
  assert.equal(retried.get("preparedAt"), preparedAt);
  await db.doc(`accountDeletions/${uid}`).update({ preparedAt: Date.now() - DELETION_DRAIN_MS - 1 });
  assert.equal(await processAccountDeletion(uid, requestId), "done");
});

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
  await db.doc(`users/${uid}/settings/placeLists`).set({ items: [{ id: randomUUID(), name: "退会時に削除", createdAt: Date.now(), updatedAt: Date.now() }] });
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
