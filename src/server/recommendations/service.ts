import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { database } from "@/server/firebase/admin";
import { ApiError } from "@/server/auth/request";
import { extractionTarget } from "@/server/extraction/sources";
import { isGenre, type Genre } from "@/lib/places/genres";
import type { DismissedRecommendation, Recommendation, RecommendationList, RecommendationMode } from "@/lib/recommendations/schema";
import { fitModel, MIN_SHARED_PLACES, MIN_SUPPORTERS, MODEL_VERSION, rank, serializeModel, type Model, type Own, type Ranked } from "@/server/recommendations/model";
import { areaContains, areaFromAddress, areaKey } from "@/lib/areas/schema";
import { getArea } from "@/server/areas/service";

const MODEL_TTL_MS = 24 * 60 * 60_000, LOCK_MS = 2 * 60_000;
// 試作の上限。1回の集計で読む保存記録の数。
export const MAX_SCANNED_RECORDS = 20_000;
const PAGE_SIZE = 10, TOP_GENRES = 3;
const MAX_MODEL_PLACES = 5_000, MAX_MODEL_CANDIDATES = 1_000;
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

const modelRef = () => database().doc("recommendationModel/current");
const lockRef = () => database().doc("recommendationModel/lock");
const cacheRef = (uid: string) => database().doc(`users/${uid}/recommendations/current`);
const dismissed = (uid: string) => database().collection("users").doc(uid).collection("recommendationDismissed");
// 集計データにUIDを残さない。
const userKey = (uid: string) => createHash("sha256").update(`recommendation:${uid}`).digest("hex").slice(0, 32);

// 保存は1、星4以上の最新評価は加点。星2以下は支持に数えない。訪問回数では増幅しない。
type Signal = { positive: boolean; weight: number };
function signalOf(data: FirebaseFirestore.DocumentData): Signal {
  const rating = data.latestVisit?.rating;
  if (typeof rating === "number" && rating <= 2) return { positive: false, weight: 0 };
  return { positive: true, weight: typeof rating === "number" && rating >= 4 ? 1.5 : 1 };
}
const active = (data: FirebaseFirestore.DocumentData) => !data.deleted;

// 共通店舗IDを持つ保存記録をまとめて読み、1日1回の集計を作る。
export async function buildModel(now = Date.now()): Promise<Model> {
  const snapshot = await database().collectionGroup("savedPlaces").select("placeId", "deleted", "latestVisit").limit(MAX_SCANNED_RECORDS).get();
  const byUser = new Map<string, Map<string, number>>();
  const supporters = new Map<string, Set<string>>();
  for (const doc of snapshot.docs) {
    const data = doc.data(), placeId = data.placeId;
    const owner = doc.ref.parent.parent?.id;
    if (!owner || typeof placeId !== "string" || !/^[a-f0-9]{64}$/.test(placeId) || !active(data)) continue;
    const signal = signalOf(data);
    if (!signal.positive) continue;
    const key = userKey(owner);
    if (!byUser.has(key)) byUser.set(key, new Map());
    byUser.get(key)!.set(placeId, Math.max(byUser.get(key)!.get(placeId) ?? 0, signal.weight));
    if (!supporters.has(placeId)) supporters.set(placeId, new Set());
    supporters.get(placeId)!.add(key);
  }
  // 2人以上が支持する店舗だけが好みの重なりになる。多すぎる場合は支持の多い店舗を残す。
  const shared = [...supporters].filter(([, users]) => users.size >= 2).sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  let truncated = snapshot.size >= MAX_SCANNED_RECORDS || shared.length > MAX_MODEL_PLACES;
  const places = shared.slice(0, MAX_MODEL_PLACES).map(([id]) => id);
  const index = new Map(places.map((id, i) => [id, i]));
  const profiles: Record<string, number[]> = {};
  for (const [key, saved] of byUser) {
    const entries = [...saved].filter(([id]) => index.has(id)).flatMap(([id, weight]) => [index.get(id)!, weight]);
    // 重なりが2件未満のユーザーは、だれの「好みが近い人」にもならない。
    if (entries.length >= MIN_SHARED_PLACES * 2) profiles[key] = entries;
  }
  const popular = places.filter(id => supporters.get(id)!.size >= MIN_SUPPORTERS).slice(0, MAX_MODEL_CANDIDATES);
  const docs = popular.length ? await database().getAll(...popular.map(id => database().doc(`places/${id}`))) : [];
  const candidates = docs.flatMap(doc => {
    const info = safePlace(doc);
    const area = info ? areaFromAddress(info.address) : null;
    return info ? [{ id: doc.id, genre: info.genre, supporters: supporters.get(doc.id)!.size, url: info.url, prefectureCode: area?.prefectureCode ?? null, municipalityCode: area?.municipalityCode ?? null }] : [];
  });
  return fitModel({ generatedAt: now, truncated, candidates, places, profiles });
}

// 地域コードのない旧バージョンのモデルは使わず、作り直しを待つ（作り直し中は503）。
const parseModel = (snapshot: FirebaseFirestore.DocumentSnapshot): Model | null => {
  const generatedAt = snapshot.get("generatedAt"), data = snapshot.get("data");
  if (typeof generatedAt !== "number" || typeof data !== "string" || snapshot.get("version") !== MODEL_VERSION) return null;
  return { ...JSON.parse(data), generatedAt };
};

// 表示に使うのは共通店舗の検証済み情報と、自動入力の対象になる公開ページのURLだけ。除外サイト・SNSのURLは返さない。
function safePlace(doc: FirebaseFirestore.DocumentSnapshot): DismissedRecommendation | null {
  if (!doc.exists) return null;
  const name = doc.get("name"), address = doc.get("address"), source = doc.get("provenance.url");
  const target = typeof source === "string" ? extractionTarget(source) : undefined;
  // AIで補完していた旧方式の共通店舗は使わず、構造化データ（JSON-LD）で確認したものだけにする。
  if (doc.get("provenance.method") !== "json-ld-v1") return null;
  if (typeof name !== "string" || !name.trim() || typeof address !== "string" || !target) return null;
  const genre = doc.get("genre");
  return { id: doc.id, name, address, genre: isGenre(genre) ? genre : null, url: target.url };
}

// 期限切れなら1つのリクエストだけが作り直し、ほかは古い集計を使う。
// 集計がまだ一度もできていない（作成中・失敗後の待機中）場合は、データ不足ではなく一時的な障害として扱う。
async function currentModel(now = Date.now()): Promise<Model> {
  const model = parseModel(await modelRef().get());
  if (model && now - model.generatedAt < MODEL_TTL_MS) return model;
  const token = randomUUID();
  const claim = await database().runTransaction(async tx => {
    const [lock, latest] = await Promise.all([tx.get(lockRef()), tx.get(modelRef())]);
    // 先行する処理が作り直し終えていれば、それを使う。
    if (latest.get("version") === MODEL_VERSION && now - (latest.get("generatedAt") ?? 0) < MODEL_TTL_MS) return "fresh" as const;
    if ((lock.get("lockedUntil") ?? 0) > now) return "busy" as const;
    tx.set(lockRef(), { lockedUntil: now + LOCK_MS, token });
    return "claimed" as const;
  });
  if (claim === "fresh") {
    const latest = parseModel(await modelRef().get());
    if (latest) return latest;
  }
  if (claim !== "claimed") return model ?? unavailable();
  // 期限切れ後に別の処理が取ったロックは解除しない。失敗時は10分間は作り直さない。
  const release = (lockedUntil: number) => database().runTransaction(async tx => {
    const lock = await tx.get(lockRef());
    if (lock.get("token") === token) tx.set(lockRef(), { lockedUntil, token });
  });
  try {
    const fresh = await buildModel(now);
    await modelRef().set({ generatedAt: fresh.generatedAt, version: MODEL_VERSION, data: serializeModel(fresh) });
    await release(0);
    return fresh;
  } catch (error) {
    console.error("recommendation_model_failed", error instanceof Error ? error.name : "unknown");
    await release(Date.now() + RETRY_AFTER_FAILURE_MS).catch(() => undefined);
    return model ?? unavailable();
  }
}
function unavailable(): never {
  throw new ApiError(503, "おすすめを準備しています。少し待ってからもう一度お試しください。");
}

async function ownSignals(uid: string): Promise<Own> {
  const [saved, hidden] = await Promise.all([
    database().collection("users").doc(uid).collection("savedPlaces").select("placeId", "deleted", "latestVisit", "genre", "url", "sourceUrls").get(),
    dismissed(uid).select().get(),
  ]);
  const excluded = new Set(hidden.docs.map(doc => doc.id)), urls = new Set<string>(), profile = new Map<string, number>(), genreCount = new Map<Genre, number>();
  for (const doc of saved.docs) {
    const data = doc.data();
    // 店舗情報が未取得の保存も、同じ公開ページなら保存済みとして扱う。
    for (const url of [data.url, ...(data.sourceUrls ?? [])]) if (typeof url === "string") urls.add(url);
    // ごみ箱の記録も含め、保存したことのある店舗は推薦しない。
    if (typeof data.placeId === "string") excluded.add(data.placeId);
    if (!active(data)) continue;
    const signal = signalOf(data);
    if (typeof data.placeId === "string" && signal.positive) profile.set(data.placeId, signal.weight);
    if (signal.positive && isGenre(data.genre)) genreCount.set(data.genre, (genreCount.get(data.genre) ?? 0) + 1);
  }
  const genres = [...genreCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_GENRES).map(([genre]) => genre);
  return { excluded, urls, profile, genres };
}

// 推薦は1日1回作り直し、保存・評価・興味なしは表示時に除外へ反映する。
export async function listRecommendations(uid: string, cursor: string | null, now = Date.now()): Promise<RecommendationList> {
  const [model, own, cache, area] = await Promise.all([currentModel(now), ownSignals(uid), cacheRef(uid).get(), getArea(uid)]);
  const key = areaKey(area);
  // カーソルは利用エリアのキーを含み、別の地域の続きを混ぜない。
  const cursorMatch = cursor?.match(/^([\w]+):([a-f0-9]{64})$/);
  if (cursor && (!cursorMatch || cursorMatch[1] !== key)) throw new ApiError(400, "おすすめが更新されました。画面を再読み込みしてください。");
  let ranked = cache.get("items") as Ranked[] | undefined, generatedAt = cache.get("generatedAt") as number | undefined;
  if (!ranked || !generatedAt || now - generatedAt >= MODEL_TTL_MS || (cache.get("modelGeneratedAt") ?? 0) < model.generatedAt || cache.get("areaKey") !== key) {
    ranked = rank(model, own, userKey(uid), area); generatedAt = now;
    await cacheRef(uid).set({ items: ranked, generatedAt, modelGeneratedAt: model.generatedAt, areaKey: key });
  }
  const mode: RecommendationMode = ranked.some(item => item.reason === "similar_tastes") ? "personalized" : ranked.length ? "fallback" : "insufficient";
  // 除外済みの続きから読めるよう、カーソルは未除外の一覧での位置で解決する。
  const start = cursorMatch ? ranked.findIndex(item => item.id === cursorMatch[2]) + 1 : 0;
  if (cursor && start === 0) throw new ApiError(400, "おすすめが更新されました。画面を再読み込みしてください。");
  const savedByUrl = new Set(model.candidates.filter(candidate => own.urls.has(candidate.url)).map(candidate => candidate.id));
  const visible = ranked.slice(start).filter(item => !own.excluded.has(item.id) && !savedByUrl.has(item.id));
  const items: Recommendation[] = [];
  let last: string | null = null, consumed = 0;
  // 共通店舗が消えた・出典が使えなくなった候補は飛ばして10件を埋める。
  while (items.length < PAGE_SIZE && consumed < visible.length) {
    const batch = visible.slice(consumed, consumed + PAGE_SIZE - items.length);
    consumed += batch.length;
    const docs = await database().getAll(...batch.map(item => database().doc(`places/${item.id}`)));
    // 集計後に共通店舗の住所が変わった場合に備え、表示時にも現在の住所で地域を確かめる。
    batch.forEach((item, i) => {
      const info = safePlace(docs[i]);
      if (info && (!area || areaContains(area, areaFromAddress(info.address)))) items.push({ ...info, reason: item.reason });
      last = item.id;
    });
  }
  return { items, nextCursor: consumed < visible.length && last ? `${key}:${last}` : null, generatedAt, mode: items.length || cursor ? mode : "insufficient", area };
}

export async function listDismissed(uid: string, cursor: string | null) {
  let query = dismissed(uid).orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc").limit(PAGE_SIZE + 1);
  if (cursor) {
    const match = cursor.match(/^(\d{13}):([a-f0-9]{64})$/);
    if (!match) throw new ApiError(400, "一覧の続きが読み込めません。画面を再読み込みしてください。");
    query = query.startAfter(Number(match[1]), match[2]);
  }
  const snapshot = await query.get(), page = snapshot.docs.slice(0, PAGE_SIZE);
  const docs = page.length ? await database().getAll(...page.map(doc => database().doc(`places/${doc.id}`))) : [];
  // 共通店舗が使えなくなっても、解除できるようIDだけは返す。
  const items = page.map((doc, i) => safePlace(docs[i]) ?? { id: doc.id, name: "", address: "", genre: null, url: "" });
  const last = page.at(-1);
  return { items, nextCursor: snapshot.size > PAGE_SIZE && last ? `${last.get("createdAt")}:${last.id}` : null };
}

export async function setDismissed(uid: string, id: string, hidden: boolean) {
  const ref = dismissed(uid).doc(id);
  if (!hidden) { await ref.delete(); return; }
  const place = safePlace(await database().doc(`places/${id}`).get());
  if (!place) throw new ApiError(404, "おすすめが見つかりません。画面を再読み込みしてください。");
  await ref.set({ createdAt: Date.now() });
}

export async function recommendedPlace(id: string) {
  const place = safePlace(await database().doc(`places/${id}`).get());
  if (!place) throw new ApiError(404, "おすすめが見つかりません。画面を再読み込みしてください。");
  return place;
}
