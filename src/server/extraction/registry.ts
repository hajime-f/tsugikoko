import "server-only";
import { createHash } from "node:crypto";
import { database } from "../firebase/admin";
import { normalizePlaceUrl } from "../../lib/places/schema";
import { reviewedSource, type ExtractionSource } from "./sources";

// 個人の登録URLを公開リポジトリへ列挙せず、管理者専用の設定として保持する。
export async function resolveSource(value: string): Promise<ExtractionSource | undefined> {
  const builtIn = reviewedSource(value);
  if (builtIn) return builtIn;
  let url: string;
  try { url = normalizePlaceUrl(value); } catch { return; }
  if (!url.startsWith("https://")) return;
  const config = (await database().doc(`extractionSources/${createHash("sha256").update(url).digest("hex")}`).get()).data();
  if (!config?.enabled || config.url !== url) return;
  return {
    url, kind: "page", version: "registered-page-json-ld-ai-v1", reviewDate: "2026-10-18", policyUrl: url,
    aiScope: "公開ページの店舗名・所在地・料理ジャンル候補のみ。紹介文・画像・口コミ・個人メモは保存しない。",
    basis: "ユーザーが登録済み店舗の再解析を明示的に依頼。URL単位の試作設定。運営者の許諾取得を意味しない。",
  };
}
