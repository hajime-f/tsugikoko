import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { adminApp, database } from "@/server/firebase/admin";
import { ApiError, verifyServiceRequest } from "@/server/auth/request";
import { DELETION_DRAIN_MS, deletePreparedAccount, prepareAccountDeletion } from "./deletion";

function config() {
  if (process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8080" && process.env.FIREBASE_AUTH_EMULATOR_HOST === "127.0.0.1:9099" && process.env.GCLOUD_PROJECT === "demo-tsugikoko") return "emulator" as const;
  const queue = process.env.ACCOUNT_DELETION_QUEUE, invoker = process.env.ACCOUNT_DELETION_INVOKER, url = process.env.ACCOUNT_DELETION_URL;
  if (process.env.ACCOUNT_DELETION_ENABLED !== "true" || !queue || !invoker || !url || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) return null;
  if (!/^projects\/[a-z][a-z0-9-]+\/locations\/[a-z0-9-]+\/queues\/[A-Za-z0-9-]+$/.test(queue) || !url.startsWith("https://")) return null;
  return { queue, invoker, url };
}

async function enqueue(uid: string, requestId: string) {
  const settings = config();
  if (!settings) throw new ApiError(503, "退会の受付に接続できませんでした。少し待って再試行するか、データ削除の窓口へご連絡ください。");
  // エミュレーターでは外部キューを使わず、テストからワーカーを呼び出して検証する。
  if (settings === "emulator") return;
  const token = (await adminApp().options.credential!.getAccessToken()).access_token;
  const taskId = createHash("sha256").update(`${uid}:${requestId}`).digest("hex");
  const response = await fetch(`https://cloudtasks.googleapis.com/v2/${settings.queue}/tasks`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store",
    body: JSON.stringify({ task: {
      name: `${settings.queue}/tasks/${taskId}`, dispatchDeadline: "60s",
      scheduleTime: new Date(Date.now() + DELETION_DRAIN_MS + 60_000).toISOString(),
      httpRequest: {
        url: settings.url, httpMethod: "POST", headers: { "Content-Type": "application/json" },
        body: Buffer.from(JSON.stringify({ uid, requestId })).toString("base64"),
        oidcToken: { serviceAccountEmail: settings.invoker, audience: settings.url },
      },
    } }),
  });
  if (!response.ok) throw new Error(`Account deletion task HTTP ${response.status}`);
}

export async function requestAccountDeletion(uid: string, enqueueTask = enqueue) {
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) throw new ApiError(400, "アカウントを確認できませんでした。");
  const requestId = randomUUID();
  // 必ずキューの登録成功後に受付を確定する。キュー失敗時はユーザーを停止しない。
  // 登録後にFirestoreへ保存できなかったジョブは、ワーカーが照合して無視する。
  await enqueueTask(uid, requestId);
  const ref = database().doc(`accountDeletions/${uid}`);
  await database().runTransaction(async tx => {
    const job = await tx.get(ref);
    if (job.exists) {
      if (job.get("requestId")) return;
      throw new ApiError(409, "すでに削除の対応中です。お問い合わせ窓口へご連絡ください。");
    }
    tx.create(ref, { requestId, requestedAt: Date.now() });
  });
  // 受付は永続化済み。停止処理が失敗してもジョブが後から再実行する。
  try { await prepareAccountDeletion(uid); }
  catch { console.error("account_deletion_prepare_pending"); }
  return { accepted: true };
}

export async function processAccountDeletion(uid: string, requestId: string) {
  const job = await database().doc(`accountDeletions/${uid}`).get();
  if (!job.exists || job.get("requestId") !== requestId) return "done";
  await prepareAccountDeletion(uid);
  const prepared = await database().doc(`accountDeletions/${uid}`).get();
  if (Date.now() - prepared.get("preparedAt") < DELETION_DRAIN_MS) return "waiting";
  await deletePreparedAccount(uid);
  return "done";
}

export async function verifyAccountDeletionTask(request: Request) {
  const settings = config();
  return settings && settings !== "emulator" ? verifyServiceRequest(request, settings.url, settings.invoker) : false;
}
