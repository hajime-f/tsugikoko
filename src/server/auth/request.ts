import "server-only";
import { adminAuth } from "@/server/firebase/admin";
import { OAuth2Client } from "google-auth-library";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function authenticatedUser(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token || token.length > 8192) throw new ApiError(401, "ログインし直してください。");
  try { return await adminAuth().verifyIdToken(token, true); }
  catch { throw new ApiError(401, "ログインし直してください。"); }
}
export async function authenticatedUid(request: Request) {
  return (await authenticatedUser(request)).uid;
}
export async function recentlyAuthenticatedUid(request: Request) {
  const user = await authenticatedUser(request);
  const age = Date.now() / 1000 - user.auth_time;
  if (!Number.isFinite(age) || age < -60 || age > 5 * 60) throw new ApiError(401, "もう一度本人確認を行ってください。");
  return user.uid;
}
// Cloud Tasks・Cloud Schedulerからの呼び出しを、指定したサービスアカウントのOIDCトークンで確認する。
export async function verifyServiceRequest(request: Request, audience: string, invoker: string) {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return false;
  try {
    const payload = (await new OAuth2Client().verifyIdToken({ idToken: token, audience })).getPayload();
    return payload?.email === invoker && payload.email_verified === true;
  } catch { return false; }
}
export async function smallJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ApiError(415, "JSON形式で送信してください。");
  if (Number(request.headers.get("content-length")) > 12_000) throw new ApiError(413, "入力内容が長すぎます。");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "入力内容を確認してください。");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 12_000) { await reader.cancel(); throw new ApiError(413, "入力内容が長すぎます。"); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ApiError(400, "入力内容を確認してください。"); }
}
export function jsonResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Authorization" } });
}
export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return jsonResponse({ error: error.message }, error.status);
  if (error instanceof ZodError) return jsonResponse({ error: error.issues[0]?.message || "入力内容を確認してください。" }, 400);
  // トークン、入力URL、個人メモをログに出さない。
  console.error("places_api_failed", error instanceof Error ? error.name : "unknown");
  return jsonResponse({ error: "保存先に接続できませんでした。少し待ってからもう一度お試しください。" }, 503);
}
