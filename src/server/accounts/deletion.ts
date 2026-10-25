import "server-only";
import { createHash } from "node:crypto";
import { adminAuth, database } from "@/server/firebase/admin";

// 運営者のCLI専用。HTTPエンドポイントとして公開しない。
export const DELETION_DRAIN_MS = 5 * 60_000;
const validUid = (uid: string) => {
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) throw new Error("Invalid account UID");
  return uid;
};
const jobRef = (uid: string) => database().doc(`accountDeletions/${validUid(uid)}`);
const userRef = (uid: string) => database().doc(`users/${validUid(uid)}`);
const maintenanceKey = (uid: string) => createHash("sha256").update(`delete:${uid}`).digest("hex");
async function authUser(uid: string) {
  try { return await adminAuth().getUser(validUid(uid)); }
  catch (error) {
    if ((error as { code?: string }).code === "auth/user-not-found") return null;
    throw error;
  }
}

export async function inspectAccountDeletion(uid: string) {
  validUid(uid);
  const [user, job, saved, collections] = await Promise.all([
    authUser(uid), jobRef(uid).get(), userRef(uid).collection("savedPlaces").count().get(), userRef(uid).listCollections(),
  ]);
  return { authExists: Boolean(user), disabled: user?.disabled ?? false, savedPlaces: saved.data().count,
    collections: collections.map(collection => collection.id).sort(), prepared: job.exists,
    readyToDelete: job.exists && Date.now() - job.get("preparedAt") >= DELETION_DRAIN_MS && (!user || user.disabled) };
}

// 本人確認・削除範囲の合意は運営者が先に行う。既存のAPIは失効とdisabledを確認して拒否する。
export async function prepareAccountDeletion(uid: string) {
  const user = await authUser(uid);
  const ref = jobRef(uid), job = await ref.get();
  if (!user) {
    if (job.exists) return; // 前回の削除がAuth削除後に中断した場合も再開できる。
    throw new Error("Account not found; verify the target before proceeding");
  }
  await adminAuth().updateUser(uid, { disabled: true });
  await adminAuth().revokeRefreshTokens(uid);
  // 進行中リクエストを待つ。手動で再有効化されていた場合は待機時間を取り直す。
  if (!job.exists || !user.disabled) await ref.set({ preparedAt: Date.now() });
}

export async function deletePreparedAccount(uid: string) {
  const job = await jobRef(uid).get();
  if (!job.exists || typeof job.get("preparedAt") !== "number") throw new Error("Prepare deletion first");
  if (Date.now() - job.get("preparedAt") < DELETION_DRAIN_MS) throw new Error("Wait at least five minutes after preparation");
  const user = await authUser(uid);
  if (user && !user.disabled) throw new Error("Account is enabled; prepare deletion again");

  const db = database(), lockRef = db.doc("recommendationModel/lock"), key = maintenanceKey(uid);
  // 生のUIDやプロフィールを含む集計の再保存を防ぐ。失敗時は保守状態を維持し、同じUIDで再実行する。
  await db.runTransaction(async tx => {
    const lock = await tx.get(lockRef);
    if (lock.get("maintenance") && lock.get("maintenance") !== key) throw new Error("Another account deletion is in progress");
    tx.set(lockRef, { maintenance: key, token: key, lockedUntil: 0 });
    tx.delete(db.doc("recommendationModel/current"));
  });
  await db.recursiveDelete(userRef(uid));
  // 他の人の保存記録は触らず、削除対象者の傾向が影響した再生成可能なおすすめキャッシュだけを消す。
  let removedCaches = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    let query = db.collectionGroup("recommendations").limit(300);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    const batch = db.batch();
    for (const doc of snapshot.docs) {
      if (/^users\/[^/]+\/recommendations\/[^/]+$/.test(doc.ref.path)) { batch.delete(doc.ref); removedCaches++; }
    }
    await batch.commit();
    cursor = snapshot.docs.at(-1);
  }
  if (user) {
    try { await adminAuth().deleteUser(uid); }
    catch (error) { if ((error as { code?: string }).code !== "auth/user-not-found") throw error; }
  }
  await db.runTransaction(async tx => {
    const lock = await tx.get(lockRef);
    if (lock.get("maintenance") !== key) throw new Error("Deletion maintenance lock changed; inspect before retrying");
    tx.delete(db.doc("recommendationModel/current"));
    tx.delete(lockRef);
    tx.delete(jobRef(uid));
  });
  return { deleted: true, removedRecommendationCaches: removedCaches };
}
