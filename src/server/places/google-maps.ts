import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { database } from "@/server/firebase/admin";
import { ApiError } from "@/server/auth/request";
import { safeFetch, type PageFetcher } from "@/server/extraction/sources";
import { googleMapsUrl, googleMapsReference, isGooglePlaceId, type GooglePlaceDetails } from "@/lib/places/google-maps";

const unavailable = () => new ApiError(422, "Googleマップの店舗を特定できませんでした。「編集」から店名・住所を入力できます。");
const limited = () => new ApiError(429, "Googleマップの情報取得は利用上限に達しました。URLは保存済みです。時間をおいて開き直してください。");
const fields = "id,displayName,formattedAddress,googleMapsUri,attributions";
const placeSchema = z.object({
  id: z.string().refine(isGooglePlaceId), displayName: z.object({ text: z.string().min(1).max(500) }),
  formattedAddress: z.string().max(1000).optional(), googleMapsUri: z.string().refine(value => Boolean(googleMapsUrl(value))),
  attributions: z.array(z.object({ provider: z.string().max(500), providerUri: z.string().url() })).max(30).optional(),
});
function details(value: unknown): GooglePlaceDetails {
  const data = placeSchema.parse(value);
  return { id: data.id, name: data.displayName.text, address: data.formattedAddress ?? "", uri: data.googleMapsUri,
    attributions: (data.attributions ?? []).map(item => {
      const url = new URL(item.providerUri);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw unavailable();
      return { name: item.provider, uri: item.providerUri };
    }) };
}

// 短縮URLのLocationヘッダーだけを読む。本文のスクレイピングやGoogle以外への転送はしない。
export async function resolveGoogleMapsUrl(value: string, fetcher: PageFetcher = safeFetch) {
  let url = googleMapsUrl(value);
  const seen = new Set<string>();
  for (let i = 0; url && i < 5; i++) {
    url.protocol = "https:";
    if (!["maps.app.goo.gl", "goo.gl"].includes(url.hostname)) return url.toString();
    if (seen.has(url.toString())) break;
    seen.add(url.toString());
    const response = await fetcher(url.toString(), "text/html", 0);
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.location) throw new ApiError(503, "Googleマップの短縮リンクを確認できませんでした。時間をおいて開き直してください。");
    if (response.location.length > 2048) break;
    url = googleMapsUrl(new URL(response.location, url).toString());
  }
  throw unavailable();
}

// 1回の表示につきPlaces APIは最大1回。内容は返却だけでキャッシュ・ログに保存しない。
export async function lookupGooglePlace(url: string, storedId: string | undefined, key: string,
  options: { fetcher?: PageFetcher; request?: typeof fetch } = {}): Promise<GooglePlaceDetails> {
  const reference: ReturnType<typeof googleMapsReference> = storedId && isGooglePlaceId(storedId) ? { id: storedId } : googleMapsReference(await resolveGoogleMapsUrl(url, options.fetcher));
  if (!reference) throw unavailable();
  const id = reference.id;
  const endpoint = id ? `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=ja` : "https://places.googleapis.com/v1/places:searchText";
  const response = await (options.request ?? fetch)(endpoint, {
    method: id ? "GET" : "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": id ? fields : fields.split(",").map(field => `places.${field}`).join(","), "Content-Type": "application/json" },
    ...(id ? {} : { body: JSON.stringify({ textQuery: reference.text, languageCode: "ja", pageSize: 10,
      ...(reference.location ? { locationBias: { circle: { center: reference.location, radius: 500 } } } : {}) }) }),
  });
  if (!response.ok) throw new ApiError(response.status === 429 ? 429 : 503, "Googleマップの情報を取得できませんでした。URLは保存済みです。時間をおいて開き直してください。");
  const body = await response.json();
  if (id) {
    const place = details(body);
    if (place.id !== id) throw unavailable();
    return place;
  }
  const candidates = z.array(placeSchema).max(10).parse(body.places ?? []).map(details);
  const matches = reference.cid ? candidates.filter(place => new URL(place.uri).searchParams.get("cid") === reference.cid)
    : candidates.filter(place => !reference.name || place.name.normalize("NFKC").replace(/\s/g, "").toLowerCase() === reference.name.normalize("NFKC").replace(/\s/g, "").toLowerCase());
  if (matches.length !== 1) throw unavailable();
  return matches[0];
}

// サイト全体で日100回・月4000回まで（失敗も消費）。個人は分6回・日30回。
// 上限を下げる設定だけ許可し、無料枠を前提とする運用で設定ミスによる増額を防ぐ。
const cap = (value: string | undefined, maximum: number) => value && /^\d+$/.test(value) ? Math.min(Number(value), maximum) : maximum;
export async function readGooglePlace(uid: string, id: string, options: { lookup?: typeof lookupGooglePlace; now?: number } = {}) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new ApiError(400, "店舗を選び直してください。");
  const ref = database().doc(`users/${uid}/savedPlaces/${id}`);
  const initial = await ref.get();
  if (!initial.exists || initial.get("deleted")) throw new ApiError(404, "保存した店舗が見つかりません。");
  if (initial.get("googleLookupFailedAt")) throw unavailable();
  if (!googleMapsUrl(initial.get("url"))) throw unavailable();
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new ApiError(503, "Googleマップの情報取得は準備中です。URLは保存済みです。「編集」から店名・住所を入力できます。");
  const now = options.now ?? Date.now(), day = new Date(now).toISOString().slice(0, 10), month = day.slice(0, 7), minute = Math.floor(now / 60_000);
  const nonce = randomUUID();
  const globalRef = database().doc("serviceLimits/googlePlaces"), userRef = database().doc(`users/${uid}/limits/googlePlaces`);
  const stored = await database().runTransaction(async tx => {
    const [record, total, personal] = await tx.getAll(ref, globalRef, userRef);
    if (!record.exists || record.get("deleted")) throw new ApiError(404, "保存した店舗が見つかりません。");
    if (record.get("googleLookupFailedAt")) throw unavailable();
    if (now - (record.get("googleLookupAt") ?? 0) < 30_000) throw new ApiError(429, "店舗情報を確認した直後です。30秒ほど待ってから開き直してください。URLは保存済みです。");
    const daily = total.get("day") === day ? total.get("daily") ?? 0 : 0;
    const monthly = total.get("month") === month ? total.get("monthly") ?? 0 : 0;
    const perMinute = personal.get("minute") === minute ? personal.get("perMinute") ?? 0 : 0;
    const perDay = personal.get("day") === day ? personal.get("perDay") ?? 0 : 0;
    if (daily >= cap(process.env.GOOGLE_PLACES_DAILY_LIMIT, 100) || monthly >= cap(process.env.GOOGLE_PLACES_MONTHLY_LIMIT, 4000) || perMinute >= 6 || perDay >= 30) throw limited();
    tx.set(globalRef, { day, month, daily: daily + 1, monthly: monthly + 1 });
    tx.set(userRef, { day, minute, perMinute: perMinute + 1, perDay: perDay + 1 });
    tx.update(ref, { googleLookupAt: now, googleLookupNonce: nonce });
    return { url: record.get("url") as string, id: record.get("googlePlaceId") as string | undefined };
  });
  let place: GooglePlaceDetails;
  try { place = await (options.lookup ?? lookupGooglePlace)(stored.url, stored.id, key); }
  catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      await database().runTransaction(async tx => {
        const current = await tx.get(ref);
        if (current.exists && !current.get("deleted") && current.get("googleLookupNonce") === nonce) tx.update(ref, { googleLookupFailedAt: now });
      });
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "Googleマップの情報を取得できませんでした。URLは保存済みです。時間をおいて開き直してください。");
  }
  await database().runTransaction(async tx => {
    const current = await tx.get(ref);
    if (!current.exists || current.get("deleted") || current.get("googleLookupNonce") !== nonce) throw new ApiError(409, "店舗の記録が更新されました。画面を開き直してください。");
    // 永続化するGoogle由来情報はPlace IDだけ。通常のname/address/genreや共通情報には一切書かない。
    tx.update(ref, { googlePlaceId: place.id });
  });
  return { place };
}
