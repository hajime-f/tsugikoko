import "server-only";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { database } from "@/server/firebase/admin";
import { ApiError } from "@/server/auth/request";
import { googleMapsReference, googleMapsUrl } from "@/lib/places/google-maps";
import { fsqCatalogSchema, fsqCandidates, type FsqLookup, type FsqRow } from "@/lib/places/foursquare";
import { resolveGoogleMapsUrl } from "./google-maps";

export const foursquareEnabled = () => process.env.FOURSQUARE_ENABLED === "true" && Boolean(process.env.FOURSQUARE_CATALOG_PATH);
let cached: { path: string; stamp: number; catalog: ReturnType<typeof fsqCatalogSchema.parse> } | undefined;
export async function loadFsqCatalog() {
  if (!foursquareEnabled()) throw new ApiError(503, "店舗情報の入力補助は停止中です。手入力で保存できます。");
  const path = resolve(process.env.FOURSQUARE_CATALOG_PATH!);
  const info = await stat(path);
  if (!info.isFile() || info.size > 50_000_000) throw new Error("Invalid Foursquare catalog size");
  if (cached?.path === path && cached.stamp === info.mtimeMs) return cached.catalog;
  const catalog = fsqCatalogSchema.parse(JSON.parse(await readFile(path, "utf8")));
  if (new Set(catalog.rows.map(row => row.id)).size !== catalog.rows.length ||
      createHash("sha256").update(JSON.stringify(catalog.rows)).digest("hex") !== catalog.version) throw new Error("Invalid Foursquare catalog integrity");
  cached = { path, stamp: info.mtimeMs, catalog };
  return catalog;
}
export async function lookupFsqUrl(url: string, options: { rows: FsqRow[]; version: string; resolve?: typeof resolveGoogleMapsUrl; now?: number }) {
  const reference = googleMapsReference(await (options.resolve ?? resolveGoogleMapsUrl)(url));
  if (!reference || !("location" in reference) || !reference.location || !reference.name) return { candidates: [], automatic: false, more: false };
  const candidates = fsqCandidates(options.rows, reference.name, reference.location, options.now);
  // 1候補なら入力欄へ反映できる。ただし警告のある古い/報告付きデータは選択を必須にする。
  const automatic = candidates.length === 1 && !candidates[0].flags.length &&
    !candidates[0].warnings.some(warning => warning.includes("更新"));
  return { candidates: candidates.slice(0, 10), automatic, more: candidates.length > 10 };
}
async function ownedRecord(uid: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new ApiError(404, "保存したお店が見つかりません。");
  const doc = await database().doc(`users/${uid}/savedPlaces/${id}`).get();
  if (!doc.exists || doc.get("deleted")) throw new ApiError(404, "保存したお店が見つかりません。");
  if (!googleMapsUrl(doc.get("url"))) throw new ApiError(422, "Googleマップのリンクを選んでください。");
  return doc;
}
export async function lookupSavedFsq(uid: string, id: string, consumeLookupLimit = true): Promise<FsqLookup> {
  const doc = await ownedRecord(uid, id);
  if (!foursquareEnabled()) return { enabled: false, version: "", candidates: [], automatic: false, more: false };
  const catalog = await loadFsqCatalog();
  // 取得は個人単位で制限。URLやGoogleの店名・座標を保存しない。
  const limit = database().doc(`users/${uid}/limits/foursquare`), minute = Math.floor(Date.now() / 60_000);
  if (consumeLookupLimit) await database().runTransaction(async tx => {
    const current = await tx.get(limit), count = current.get("minute") === minute ? current.get("count") ?? 0 : 0;
    if (count >= 10) throw new ApiError(429, "店舗候補の確認は少し時間をおいてお試しください。");
    tx.set(limit, { minute, count: count + 1 });
  });
  return { enabled: true, version: catalog.version, ...await lookupFsqUrl(doc.get("url"), catalog) };
}
export async function selectedFsq(uid: string, id: string, selection: { id: string; version: string }) {
  // PATCH側のlimitWritesで制限済み。候補表示の枠を保存時に二重消費しない。
  const found = await lookupSavedFsq(uid, id, false);
  if (!found.enabled) throw new ApiError(503, "店舗情報の入力補助は停止中です。画面を開き直してください。");
  if (found.version !== selection.version) throw new ApiError(409, "店舗候補が更新されました。画面を開き直してください。");
  const row = found.candidates.find(candidate => candidate.id === selection.id);
  if (!row) throw new ApiError(409, "店舗候補を確認できませんでした。画面を開き直してください。");
  return { row, version: found.version };
}
