import "server-only";
import { after } from "next/server";
import { verifyServiceRequest } from "@/server/auth/request";
import { adminApp } from "@/server/firebase/admin";
import { claimDispatch, processExtraction } from "@/server/places/service";

// Cloud Tasksの設定がない環境（ローカル・エミュレーター）では、従来どおり応答後に処理する。
function tasksConfig() {
  const queue = process.env.PLACE_TASKS_QUEUE, invoker = process.env.PLACE_TASKS_INVOKER, url = process.env.PLACE_TASKS_URL;
  if (process.env.PLACE_TASKS_ENABLED !== "true" || !queue || !invoker || !url || process.env.FIRESTORE_EMULATOR_HOST) return null;
  if (!/^projects\/[a-z][a-z0-9-]+\/locations\/[a-z0-9-]+\/queues\/[A-Za-z0-9-]+$/.test(queue) || !url.startsWith("https://")) return null;
  return { queue, invoker, url };
}

async function enqueue(uid: string, id: string, config: NonNullable<ReturnType<typeof tasksConfig>>) {
  const token = (await adminApp().options.credential!.getAccessToken()).access_token;
  const response = await fetch(`https://cloudtasks.googleapis.com/v2/${config.queue}/tasks`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store",
    body: JSON.stringify({ task: {
      dispatchDeadline: "60s",
      httpRequest: {
        url: config.url, httpMethod: "POST", headers: { "Content-Type": "application/json" },
        body: Buffer.from(JSON.stringify({ uid, id })).toString("base64"),
        oidcToken: { serviceAccountEmail: config.invoker, audience: config.url },
      },
    } }),
  });
  if (!response.ok) throw new Error(`Cloud Tasks HTTP ${response.status}`);
}

// 取得待ちの記録を、応答後も確実に処理されるジョブとして登録する。
// 無効時はジョブ登録の記録を使わず、従来どおりリースの期限切れで再開する。
export async function dispatchExtraction(uid: string, id: string) {
  const config = tasksConfig();
  if (config) {
    if (!await claimDispatch(uid, id)) return;
    try { await enqueue(uid, id, config); return; }
    catch { console.error("place_dispatch_failed"); }
  }
  after(async () => { try { await processExtraction(uid, id); } catch { console.error("place_extraction_interrupted"); } });
}

export async function verifyTaskRequest(request: Request) {
  const config = tasksConfig();
  return config ? verifyServiceRequest(request, config.url, config.invoker) : false;
}
