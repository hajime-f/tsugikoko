import "server-only";
import { adminApp, database } from "../firebase/admin";
import { AI_LIMITS, requestGemini } from "./gemini";
import { AiLimitError, AiUnavailableError } from "./parser";

export async function reserveAiCall(uid: string) {
  const now = new Date();
  // JST calendar boundaries, shared by all instances.
  const day = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10), month = day.slice(0, 7);
  const globalRef = database().doc("extractionLimits/ai"), userRef = database().doc(`users/${uid}/limits/ai`);
  await database().runTransaction(async tx => {
    const [global, user] = await Promise.all([tx.get(globalRef), tx.get(userRef)]);
    const daily = global.get("day") === day ? global.get("daily") ?? 0 : 0;
    const monthly = global.get("month") === month ? global.get("monthly") ?? 0 : 0;
    const userDaily = user.get("day") === day ? user.get("daily") ?? 0 : 0;
    if (daily >= AI_LIMITS.daily || monthly >= AI_LIMITS.monthly || userDaily >= AI_LIMITS.userDaily) throw new AiLimitError();
    // Reserve before the paid call. Failed/interrupted attempts also consume a slot.
    tx.set(globalRef, { day, month, daily: daily + 1, monthly: monthly + 1 });
    tx.set(userRef, { day, daily: userDaily + 1 });
  });
}

export async function extractWithAi(uid: string, text: string) {
  if (process.env.PLACE_AI_ENABLED !== "true" || process.env.FIRESTORE_EMULATOR_HOST) throw new AiUnavailableError();
  const projectId = process.env.PLACE_AI_PROJECT;
  if (!projectId) throw new AiUnavailableError();
  let token: string;
  try { token = (await adminApp().options.credential!.getAccessToken()).access_token; }
  catch { throw new AiUnavailableError(); }
  await reserveAiCall(uid);
  return requestGemini(text, token, projectId);
}
