import { z } from "zod";

export function normalizePlaceUrl(value: string): string {
  const url = new URL(value.trim());
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || value.length > 2048) throw new Error("invalid-url");
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || /^[\d.]+$/.test(host) || host.includes(":")) throw new Error("invalid-url");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|igsh|igshid)$/.test(key)) url.searchParams.delete(key);
  // 店舗・投稿を示すIDは維持し、同じ店舗の写真・口コミページも同一視する。
  if (["tabelog.com", "www.tabelog.com", "s.tabelog.com"].includes(host)) {
    const match = url.pathname.match(/^\/(\w+)\/(A\d+)\/(A\d+)\/(\d{8})(?:\/|$)/);
    if (match) return `https://tabelog.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}/`;
  }
  if (host === "restaurant.ikyu.com") {
    const match = url.pathname.match(/^\/(\d{6})(?:\/|$)/);
    if (match) return `https://restaurant.ikyu.com/${match[1]}`;
  }
  if (["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(host)) {
    const match = url.pathname.match(/^\/[^/]+\/status\/(\d+)/);
    if (match) return `https://x.com/i/status/${match[1]}`;
  }
  if (["instagram.com", "www.instagram.com"].includes(host)) {
    const match = url.pathname.match(/^\/(p|reel)\/([\w-]+)/);
    if (match) return `https://www.instagram.com/${match[1]}/${match[2]}/`;
  }
  if (["tabisurucafe.com", "www.tabisurucafe.com"].includes(host)) {
    url.protocol = "https:"; url.hostname = "www.tabisurucafe.com";
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
  }
  return url.href;
}

export const createPlaceSchema = z.object({ url: z.string().max(2048).transform((value, ctx) => {
  try { return normalizePlaceUrl(value); }
  catch { ctx.addIssue({ code: "custom", message: "お店や投稿のURL（https://...）を入力してください。" }); return z.NEVER; }
}) }).strict();
export const editPlaceSchema = z.object({
  name: z.string().trim().max(120), address: z.string().trim().max(300), note: z.string().trim().max(2000),
}).strict();
export const actionSchema = z.object({ action: z.enum(["retry", "trash", "restore"]) }).strict();

export type SavedPlace = {
  id: string; placeId: string | null; url: string; sourceUrls: string[];
  name: string; address: string; note: string; customDetails: boolean;
  extraction: "pending" | "ready" | "needs_review" | "failed";
  reason: "unsupported" | "not_found" | "fetch_failed" | "ai_unavailable" | "ai_limit" | null;
  sourceLabel: string; fetchedAt: number | null; createdAt: number; updatedAt: number;
  lastAttemptAt: number | null; deleted: boolean; deleteAt: number | null; visibility: "private";
};
export type PlaceList = { places: SavedPlace[]; nextCursor: string | null };

export function sourceLabel(url: string) {
  const host = new URL(url).hostname;
  if (host === "tabelog.com") return "食べログ";
  if (host === "restaurant.ikyu.com") return "一休レストラン";
  if (host === "x.com") return "X";
  if (host === "www.instagram.com") return "Instagram";
  return host.replace(/^www\./, "");
}
