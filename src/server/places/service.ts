import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { database } from "@/server/firebase/admin";
import { ApiError } from "@/server/auth/request";
import { MAX_VISITS, sortVisits, sourceLabel, type SavedPlace, type Visit, type VisitAction } from "@/lib/places/schema";
import { extractionTarget, fetchPageFacts, type PageFetcher } from "@/server/extraction/sources";
import { factsSchema } from "@/server/extraction/parser";
import { genreFromText, isGenre, type Genre } from "@/lib/places/genres";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const records = (uid: string) => database().collection("users").doc(uid).collection("savedPlaces");
const urlKeys = (uid: string) => database().collection("users").doc(uid).collection("urlKeys");
const placeKeys = (uid: string) => database().collection("users").doc(uid).collection("placeKeys");
const expired = (place: SavedPlace) => place.deleted && (place.deleteAt ?? 0) <= Date.now();
const CACHE_MS = 86_400_000, REFRESH_CACHE_MS = 10 * 60_000;
const LEASE_MS = 90_000, REDISPATCH_MS = 10 * 60_000;
const MAX_NOTE = 2000, MAX_SOURCE_URLS = 20;
const editedFieldsOf = (doc: FirebaseFirestore.DocumentSnapshot): string[] =>
  doc.get("editedFields") ?? (doc.get("customDetails") ? ["name", "address"] : []);
// 統合先・統合元の順に本人が選んだジャンルを優先し、なければ統合先の判定済みジャンル、自動判定の順に使う。
function mergedGenre(target: FirebaseFirestore.DocumentSnapshot, source: FirebaseFirestore.DocumentSnapshot, extracted: Genre | null | undefined): Genre | null {
  for (const doc of [target, source]) if (editedFieldsOf(doc).includes("genre")) return isGenre(doc.get("genre")) ? doc.get("genre") : null;
  return isGenre(target.get("genre")) ? target.get("genre") : extracted ?? null;
}
function publicRecord(id: string, data: FirebaseFirestore.DocumentData): SavedPlace {
  return {
    id, placeId: data.placeId, url: data.url, sourceUrls: data.sourceUrls,
    name: data.name, address: data.address, note: data.note, customDetails: data.customDetails,
    extraction: data.extraction, reason: data.reason, sourceLabel: data.sourceLabel,
    fetchedAt: data.fetchedAt, createdAt: data.createdAt, updatedAt: data.updatedAt,
    lastAttemptAt: data.lastAttemptAt, deleted: data.deleted, deleteAt: data.deleteAt, visibility: "private",
    visitCount: data.visitCount ?? 0, latestVisit: data.latestVisit ?? null,
    // 本人が選んだジャンル（未設定を含む）は店名からの推測で置き換えない。
    genre: isGenre(data.genre) ? data.genre : (data.editedFields ?? []).includes("genre") ? null : genreFromText(data.name ?? ""),
  };
}

export async function limitWrites(uid: string) {
  const ref = database().doc(`users/${uid}/limits/writes`);
  const now = Date.now(), minute = Math.floor(now / 60_000), day = Math.floor(now / 86_400_000);
  await database().runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    const perMinute = current?.minute === minute ? current.perMinute : 0;
    const perDay = current?.day === day ? current.perDay : 0;
    if (perMinute >= 20 || perDay >= 200) throw new ApiError(429, "登録・更新の回数が上限に達しました。時間をおいてお試しください。");
    tx.set(ref, { minute, day, perMinute: perMinute + 1, perDay: perDay + 1 });
  });
}

export async function createPlace(uid: string, url: string) {
  const key = urlKeys(uid).doc(hash(url));
  const supported = Boolean(extractionTarget(url));
  return database().runTransaction(async (tx) => {
    const mapping = await tx.get(key);
    const id = mapping.data()?.id || hash(url);
    const ref = records(uid).doc(id);
    const existing = await tx.get(ref);
    const now = Date.now();
    if (existing.exists && !expired(publicRecord(id, existing.data()!))) {
      const place = publicRecord(id, existing.data()!);
      if (place.deleted) {
        tx.update(ref, { deleted: false, deleteAt: null, purgeAt: null, updatedAt: now });
        return { place: { ...place, deleted: false, deleteAt: null, updatedAt: now }, duplicate: true, restored: true };
      }
      return { place, duplicate: true, restored: false };
    }
    const place: SavedPlace = {
      id, placeId: null, url, sourceUrls: [url], name: "", address: "", note: "", customDetails: false,
      extraction: supported ? "pending" : "needs_review", reason: supported ? null : "unsupported",
      sourceLabel: sourceLabel(url), fetchedAt: null, createdAt: now, updatedAt: now, lastAttemptAt: null,
      deleted: false, deleteAt: null, visibility: "private", visitCount: 0, latestVisit: null, genre: null,
    };
    tx.set(ref, { ...place, attempts: 0, purgeAt: null });
    tx.set(key, { id });
    return { place, duplicate: false, restored: false };
  });
}

export async function listPlaces(uid: string, trash: boolean, cursor: string | null, status: "all" | "saved" | "visited" = "all") {
  let query = records(uid).where("deleted", "==", trash).orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc").limit(31);
  if (cursor) {
    const match = cursor.match(/^(\d{13}):([a-f0-9]{64})$/);
    if (!match) throw new ApiError(400, "一覧の続きが読み込めません。画面を再読み込みしてください。");
    query = query.startAfter(Number(match[1]), match[2]);
  }
  const snapshot = await query.get();
  const docs = snapshot.docs.slice(0, 30);
  // 旧データには訪問件数がないため、移行不要で読めるよう取得した30件を分類する。
  // 空ページにも次カーソルを返し、クライアントが続きの範囲を遅延取得する。
  const places = docs.map((doc) => publicRecord(doc.id, doc.data())).filter((place) => !expired(place) &&
    (trash || status === "all" || (status === "visited" ? place.visitCount > 0 : place.visitCount === 0)));
  const last = docs.at(-1);
  return { places, nextCursor: snapshot.size > 30 && last ? `${last.get("createdAt")}:${last.id}` : null };
}

function visitSummary(visits: Visit[]) {
  const latest = sortVisits(visits)[0];
  return { visitCount: visits.length, latestVisit: latest ? { id: latest.id, visitedOn: latest.visitedOn, rating: latest.rating } : null };
}

export async function listVisits(uid: string, id: string, cursor: string | null) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new ApiError(404, "保存したお店が見つかりません。");
  const doc = await records(uid).doc(id).get();
  if (!doc.exists || expired(publicRecord(id, doc.data()!))) throw new ApiError(404, "保存したお店が見つかりません。");
  const visits = sortVisits((doc.get("visits") ?? []) as Visit[]);
  const offset = cursor ? visits.findIndex(visit => visit.id === cursor) + 1 : 0;
  if (cursor && offset === 0) throw new ApiError(400, "履歴が更新されました。一度閉じて、開き直してください。");
  const page = visits.slice(offset, offset + 10);
  return { visits: page, nextCursor: offset + page.length < visits.length ? page.at(-1)!.id : null };
}

export async function updateVisit(uid: string, id: string, input: VisitAction) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new ApiError(404, "保存したお店が見つかりません。");
  return database().runTransaction(async tx => {
    const ref = records(uid).doc(id), doc = await tx.get(ref);
    if (!doc.exists || expired(publicRecord(id, doc.data()!))) throw new ApiError(404, "保存したお店が見つかりません。");
    const data = doc.data()!;
    if (data.deleted) throw new ApiError(409, "ごみ箱から戻してから記録してください。");
    let visits = (data.visits ?? []) as Visit[];
    const existing = visits.find(visit => visit.id === input.visitId);
    const now = Date.now();
    if (input.action === "addVisit") {
      // 応答を受け取れず再送しても、同じ操作の記録を増やさない。
      if (existing) {
        if (existing.visitedOn !== input.visitedOn || existing.rating !== input.rating || existing.comment !== input.comment) throw new ApiError(409, "この記録は保存済みです。一度閉じて履歴を確認してください。");
        return publicRecord(id, data);
      }
      if (visits.length >= MAX_VISITS) throw new ApiError(409, `試作版では1店舗につき${MAX_VISITS}回まで記録できます。`);
      visits = [...visits, { id: input.visitId, visitedOn: input.visitedOn, rating: input.rating, comment: input.comment, createdAt: now, updatedAt: now }];
    } else {
      if (!existing) {
        if (input.action === "deleteVisit") return publicRecord(id, data);
        throw new ApiError(404, "訪問記録が見つかりません。一度閉じて履歴を確認してください。");
      }
      if (existing.updatedAt !== input.updatedAt) throw new ApiError(409, "別の画面で記録が更新されました。一度閉じて履歴を確認してください。");
      visits = input.action === "deleteVisit" ? visits.filter(visit => visit.id !== input.visitId) : visits.map(visit => visit.id === input.visitId
        ? { ...visit, visitedOn: input.visitedOn, rating: input.rating, comment: input.comment, updatedAt: Math.max(now, visit.updatedAt + 1) } : visit);
    }
    const patch = { visits, ...visitSummary(visits), updatedAt: now };
    tx.update(ref, patch);
    return publicRecord(id, { ...data, ...patch });
  });
}

export async function updatePlace(uid: string, id: string, changes: { name: string; address: string; note: string; genre?: Genre | null } | { action: "retry" | "trash" | "restore" }) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new ApiError(404, "保存したお店が見つかりません。");
  return database().runTransaction(async (tx) => {
    const ref = records(uid).doc(id), doc = await tx.get(ref);
    if (!doc.exists) throw new ApiError(404, "保存したお店が見つかりません。");
    const place = publicRecord(id, doc.data()!);
    if (expired(place)) throw new ApiError(404, "ごみ箱の保存期間が過ぎています。");
    const now = Date.now();
    if (place.deleted && (!("action" in changes) || changes.action !== "restore")) throw new ApiError(409, "ごみ箱から戻してから編集してください。");
    let patch: Partial<SavedPlace> & { purgeAt?: Timestamp | null; attempts?: number; editedFields?: string[]; refresh?: boolean; queuedAt?: number | null } = { updatedAt: now };
    if ("action" in changes) {
      if (changes.action === "retry") {
        if (!extractionTarget(place.url)) throw new ApiError(422, "このサイトは自動入力の対象外です。店名・住所を入力してください。");
        if (place.lastAttemptAt && now - place.lastAttemptAt < 60_000) throw new ApiError(429, "再取得は1分ほど待ってからお試しください。");
        patch = { ...patch, extraction: "pending", reason: null, attempts: 0, lastAttemptAt: null, refresh: true, queuedAt: null };
      } else if (changes.action === "trash") {
        patch = { ...patch, deleted: true, deleteAt: now + 30 * 86_400_000, purgeAt: Timestamp.fromMillis(now + 30 * 86_400_000) };
      } else patch = { ...patch, deleted: false, deleteAt: null, purgeAt: null };
    } else {
      const editedFields = new Set<string>(doc.get("editedFields") ?? (place.customDetails ? ["name", "address"] : []));
      for (const field of ["name", "address"] as const) if (changes[field] !== place[field]) editedFields.add(field);
      const { genre, ...fields } = changes;
      patch = { ...patch, ...fields, customDetails: true };
      if (genre !== undefined) { patch.genre = genre; editedFields.add("genre"); }
      patch.editedFields = [...editedFields];
    }
    tx.update(ref, patch);
    return publicRecord(id, { ...place, ...patch });
  });
}

// 取得待ちの記録を1回だけジョブ登録する。登録済みでも10分処理されなければ登録し直す。
export async function claimDispatch(uid: string, id: string) {
  const ref = records(uid).doc(id);
  return database().runTransaction(async (tx) => {
    const doc = await tx.get(ref), now = Date.now();
    if (!doc.exists || doc.get("deleted") || doc.get("extraction") !== "pending") return false;
    const lastAttemptAt = doc.get("lastAttemptAt"), queuedAt = doc.get("queuedAt");
    if ((lastAttemptAt && now - lastAttemptAt < LEASE_MS) || (queuedAt && now - queuedAt < REDISPATCH_MS)) return false;
    tx.update(ref, { queuedAt: now });
    return true;
  });
}

// "busy" は別の実行が処理中で、ジョブ側で時間をおいて再試行する。
export async function processExtraction(uid: string, id: string, options: { forceRefresh?: boolean; fetcher?: PageFetcher } = {}): Promise<"done" | "busy"> {
  const ref = records(uid).doc(id);
  const attemptId = randomUUID();
  // 永続化した状態とリースで重複実行を防止。中断時はジョブの再試行と一覧の再表示で再開する。
  const leased = await database().runTransaction(async (tx) => {
    const doc = await tx.get(ref); if (!doc.exists) return null;
    const data = doc.data()!;
    if (data.deleted || data.extraction !== "pending") return null;
    if (data.lastAttemptAt && Date.now() - data.lastAttemptAt < LEASE_MS) return "busy" as const;
    if ((data.attempts ?? 0) >= 3) { tx.update(ref, { extraction: "failed", reason: "fetch_failed", refresh: false }); return null; }
    tx.update(ref, { lastAttemptAt: Date.now(), attemptId, attempts: (data.attempts ?? 0) + 1 });
    return { place: publicRecord(id, data), refresh: data.refresh === true };
  });
  if (leased === "busy") return "busy";
  if (!leased) return "done";
  const { place } = leased;
  const source = extractionTarget(place.url);
  async function finishWithoutFacts(reason: SavedPlace["reason"], failed = false) {
    await database().runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.exists && !current.get("deleted") && current.get("extraction") === "pending" && current.get("attemptId") === attemptId) {
        tx.update(ref, { extraction: failed ? "failed" : "needs_review", reason, refresh: false, updatedAt: Date.now() });
      }
    });
  }
  if (!source) { await finishWithoutFacts("unsupported"); return "done"; }
  let stage: "cache" | "fetch" | "save" = "cache";
  try {
    const cacheRef = database().doc(`placeSources/${hash(source.url)}`);
    const cache = (await cacheRef.get()).data();
    const cachedFacts = factsSchema.safeParse({ name: cache?.name, address: cache?.address, ...(cache?.genre !== undefined ? { genre: cache.genre } : {}) });
    // 本人の「再取得」は元ページを読み直す。連打や複数人の同時依頼は10分以内の結果で吸収する。
    const maxAge = options.forceRefresh ? 0 : leased.refresh ? REFRESH_CACHE_MS : CACHE_MS;
    const fresh = cache && cache.genre !== undefined && cache.provenance?.version === source.version && Date.now() - cache.fetchedAt >= 0 && Date.now() - cache.fetchedAt < maxAge && cachedFacts.success;
    stage = "fetch";
    const result = fresh ? { facts: cachedFacts.data, method: cache.provenance.method } : await fetchPageFacts(place.url, options.fetcher);
    if (!result.facts) {
      await finishWithoutFacts(result.reason);
      return "done";
    }
    const facts = { ...result.facts, genre: result.facts.genre ?? genreFromText(result.facts.name) };
    const fetchedAt = fresh ? cache.fetchedAt : Date.now();
    const placeId = hash(`${facts.name.normalize("NFKC").toLowerCase().replace(/\s/g, "")}|${facts.address.normalize("NFKC").replace(/\s/g, "")}`);
    const provenance = fresh ? cache.provenance : { ...source, method: result.method, fetchedAt };
    stage = "save";
    await database().runTransaction(async (tx) => {
      const current = await tx.get(ref), keyRef = placeKeys(uid).doc(placeId), key = await tx.get(keyRef);
      if (!current.exists || current.get("deleted") || current.get("extraction") !== "pending" || current.get("attemptId") !== attemptId) return;
      const otherRef = key.exists && key.get("id") !== id ? records(uid).doc(key.get("id")) : null;
      const other = otherRef ? await tx.get(otherRef) : null;
      tx.set(cacheRef, { ...facts, fetchedAt, placeId, provenance });
      tx.set(database().doc(`places/${placeId}`), { ...facts, provenance }, { merge: true });
      const otherActive = Boolean(other?.exists && !expired(publicRecord(other.id, other.data()!)));
      if (otherActive) {
        // 同じ店舗の記録は1件にまとめ、本人のメモ・修正は統合先へ移す。
        const urls = [...new Set<string>([...other!.get("sourceUrls"), ...current.get("sourceUrls")])];
        const note = [...new Set([other!.get("note"), current.get("note")].map((value) => (value ?? "").trim()).filter(Boolean))].join("\n\n");
        const visits = [...(other!.get("visits") ?? []), ...(current.get("visits") ?? [])] as Visit[];
        const uniqueVisits = new Set(visits.map(visit => visit.id)).size === visits.length;
        if (urls.length <= MAX_SOURCE_URLS && note.length <= MAX_NOTE && visits.length <= MAX_VISITS && uniqueVisits) {
          const otherEdited = editedFieldsOf(other!), currentEdited = editedFieldsOf(current);
          const patch: Record<string, unknown> = {
            sourceUrls: urls, note, customDetails: Boolean(other!.get("customDetails") || current.get("customDetails")),
            deleted: false, deleteAt: null, purgeAt: null, updatedAt: Date.now(),
            visits, ...visitSummary(visits),
            genre: mergedGenre(other!, current, facts.genre),
          };
          // 統合先で本人が直した項目を優先し、統合元だけで直した項目を引き継ぐ。
          for (const field of ["name", "address"] as const) {
            if (currentEdited.includes(field) && !otherEdited.includes(field)) patch[field] = current.get(field);
          }
          patch.editedFields = [...new Set([...otherEdited, ...currentEdited])];
          tx.update(otherRef!, patch);
          for (const url of current.get("sourceUrls") as string[]) tx.set(urlKeys(uid).doc(hash(url)), { id: other!.id });
          tx.delete(ref);
          return;
        }
      }
      // 統合できない場合も別の記録として残し、未編集の店名・住所は補完する。
      const edited = editedFieldsOf(current);
      tx.update(ref, {
        name: edited.includes("name") ? current.get("name") : facts.name,
        address: edited.includes("address") ? current.get("address") : facts.address,
        placeId, extraction: "ready", reason: null, refresh: false, fetchedAt, updatedAt: Date.now(),
        genre: edited.includes("genre") ? (isGenre(current.get("genre")) ? current.get("genre") : null) : facts.genre,
      });
      if (!otherActive) tx.set(keyRef, { id });
    });
  } catch (error) {
    // 外部ページの失敗でも登録URL・個人メモは保持する。
    // 原因の切り分け用。URL・メモ・本文は出さず、自前のエラー文だけを記録する。
    const detail = error instanceof Error ? {
      name: error.name, code: (error as { code?: unknown }).code ?? null,
      cause: ((error.cause as { code?: unknown } | undefined)?.code) ?? null,
      message: error.message.startsWith("Source ") ? error.message : null,
    } : { name: typeof error };
    console.error("place_extraction_failed", JSON.stringify({ stage, host: new URL(source.url).hostname, ...detail }));
    await finishWithoutFacts("fetch_failed", true);
  }
  return "done";
}
