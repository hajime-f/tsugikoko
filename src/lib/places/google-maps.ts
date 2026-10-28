// URLの判定だけを共有する。Google由来の表示情報はSavedPlaceへ混ぜない。
export function googleMapsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || value.length > 2048) return null;
    const host = url.hostname;
    const valid = host === "maps.app.goo.gl" && /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
      || host === "goo.gl" && /^\/maps\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
      || ["www.google.com", "google.com", "www.google.co.jp", "google.co.jp"].includes(host) && /^\/maps(?:\/|$)/.test(url.pathname)
      || ["maps.google.com", "maps.google.co.jp"].includes(host) && (url.pathname === "/" || /^\/maps(?:\/|$)/.test(url.pathname));
    return valid ? url : null;
  } catch { return null; }
}

export const isGooglePlaceId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{10,255}$/.test(value);
export type GooglePlaceDetails = {
  id: string; name: string; address: string; uri: string;
  attributions: { name: string; uri: string }[];
};

export function googleMapsReference(value: string) {
  const url = googleMapsUrl(value);
  if (!url || ["maps.app.goo.gl", "goo.gl"].includes(url.hostname)) return null;
  // 経路・複数地点・ユーザー作成地図から店舗を推測しない。
  if (/\/maps\/(dir|d|list)(?:\/|$)/.test(url.pathname)) return null;
  const query = url.searchParams.get("query") || url.searchParams.get("q") || "";
  const explicit = url.searchParams.get("query_place_id") || url.searchParams.get("place_id") || query.match(/^place_id:(.+)$/)?.[1];
  if (explicit) return isGooglePlaceId(explicit) ? { id: explicit } : null;
  let path: string;
  try { path = decodeURIComponent(url.pathname.replaceAll("+", " ")); } catch { return null; }
  const embedded = path.match(/!1s(ChI[A-Za-z0-9_-]{7,255})(?:!|\/|$)/)?.[1];
  if (embedded && isGooglePlaceId(embedded)) return { id: embedded };
  const name = path.match(/\/maps\/place\/([^/]+)/)?.[1]?.trim();
  const text = name || query.trim();
  if (!text || text.length > 200 || /[\u0000-\u001f\u007f]/.test(text) || /^[-+\d.,\s]+$/.test(text) || /^(?:https?:|loc:|place_id:)/i.test(text)) return null;
  // CIDがある場合は検索結果のMaps URLとも照合する。近くの別店舗を自動選択しない。
  const hex = path.match(/!1s0x[\da-f]+:0x([\da-f]+)(?:!|\/|$)/i)?.[1];
  const rawCid = url.searchParams.get("cid") || (hex && hex.length <= 16 ? BigInt(`0x${hex}`).toString() : undefined);
  const cid = rawCid && /^\d{1,20}$/.test(rawCid) ? rawCid : undefined;
  // @は地図の表示中心なので使用せず、店舗ピンの座標のみ検索の偏りを調整する。
  const coords = path.match(/!3d(-?[\d.]+)!4d(-?[\d.]+)/);
  const lat = Number(coords?.[1]), lng = Number(coords?.[2]);
  const location = coords && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { latitude: lat, longitude: lng } : undefined;
  return { text, name, cid, location };
}
