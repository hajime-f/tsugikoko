import { z } from "zod";
import { isGenre, normalizeGenre, type Genre } from "./genres";
// 旧ジャンルID（kissatenなど）を送る古い画面からの入力も、統合後のIDに置き換えて受け付ける。
const genreInput = (message: string) => z.preprocess(value => typeof value === "string" ? normalizeGenre(value) ?? value : value, z.custom<Genre>(isGenre, message));

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
  // 省略時は現在のジャンルを維持し、nullは本人が明示的に未設定へ戻したことを表す。
  genre: genreInput("ジャンルを選び直してください。").nullable().optional(),
}).strict();
export const actionSchema = z.object({ action: z.enum(["retry", "trash", "restore"]) }).strict();

export const MAX_PLACE_LISTS = 50;
export type PlaceCollection = { id: string; name: string; createdAt: number; updatedAt: number };
const listName = z.string().trim().min(1, "リスト名を入力してください。").max(40, "リスト名は40文字以内で入力してください。");
export const collectionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: listName }).strict(),
  z.object({ action: z.literal("rename"), id: z.uuid(), name: listName, updatedAt: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal("delete"), id: z.uuid(), updatedAt: z.number().int().nonnegative() }).strict(),
]);
export type CollectionAction = z.infer<typeof collectionActionSchema>;
const listIdsSchema = z.array(z.uuid()).max(MAX_PLACE_LISTS).refine(ids => new Set(ids).size === ids.length, "同じリストを重複して指定できません。");
export const membershipSchema = z.object({
  action: z.literal("setLists"), listIds: listIdsSchema, expectedListIds: listIdsSchema,
}).strict();
export type MembershipAction = z.infer<typeof membershipSchema>;

export const MAX_VISITS = 100;
export function todayInJapan() { return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }
export const visitFieldsSchema = z.object({
  visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "訪問日を入力してください。").refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= todayInJapan();
  }, "訪問日は1900年以降の実在する日付で、今日以前を指定してください。"),
  rating: z.number().int().min(1).max(5).nullable(),
  comment: z.string().trim().max(2000, "感想は2,000文字以内で入力してください。"),
}).strict();
export const visitActionSchema = z.discriminatedUnion("action", [
  visitFieldsSchema.extend({ action: z.literal("addVisit"), visitId: z.uuid() }).strict(),
  visitFieldsSchema.extend({ action: z.literal("editVisit"), visitId: z.uuid(), updatedAt: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal("deleteVisit"), visitId: z.uuid(), updatedAt: z.number().int().nonnegative() }).strict(),
]);
export type VisitAction = z.infer<typeof visitActionSchema>;
export type Visit = z.infer<typeof visitFieldsSchema> & { id: string; createdAt: number; updatedAt: number };
export type VisitSummary = Pick<Visit, "id" | "visitedOn" | "rating">;
export function sortVisits(visits: Visit[]): Visit[] {
  return [...visits].sort((a, b) => b.visitedOn.localeCompare(a.visitedOn) || b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export type SavedPlace = {
  id: string; placeId: string | null; url: string; sourceUrls: string[];
  name: string; address: string; note: string; customDetails: boolean;
  extraction: "pending" | "ready" | "needs_review" | "failed";
  reason: "unsupported" | "not_found" | "fetch_failed" | "ai_unavailable" | "ai_limit" | null;
  sourceLabel: string; fetchedAt: number | null; createdAt: number; updatedAt: number;
  lastAttemptAt: number | null; deleted: boolean; deleteAt: number | null; visibility: "private";
  visitCount: number; latestVisit: VisitSummary | null; genre: Genre | null;
  listIds?: string[];
};
export type PlaceList = { places: SavedPlace[]; nextCursor: string | null };
// マイリストの検索条件。qは店名・住所・メモの部分一致、genreの"unset"はジャンル未設定。
export const placeListQuerySchema = z.object({
  status: z.enum(["all", "saved", "visited"]).default("all"),
  q: z.string().trim().max(100, "検索語は100文字以内で入力してください。").default(""),
  genre: z.union([z.enum(["all", "unset"]), genreInput("ジャンルを選び直してください。")]).default("all"),
  sort: z.enum(["newest", "name"]).default("newest"),
  list: z.union([z.enum(["all", "unfiled"]), z.uuid()]).default("all"),
});
export type PlaceListQuery = z.infer<typeof placeListQuerySchema>;
export type VisitList = { visits: Visit[]; nextCursor: string | null };

export function sourceLabel(url: string) {
  const host = new URL(url).hostname;
  if (host === "tabelog.com") return "食べログ";
  if (host === "restaurant.ikyu.com") return "一休レストラン";
  if (host === "x.com") return "X";
  if (host === "www.instagram.com") return "Instagram";
  if (host === "gnavi.co.jp" || host.endsWith(".gnavi.co.jp")) return "ぐるなび";
  if (host === "hotpepper.jp" || host.endsWith(".hotpepper.jp")) return "ホットペッパーグルメ";
  if (host === "retty.me" || host.endsWith(".retty.me")) return "Retty";
  if (/^(maps\.)?google\.(com|co\.jp)$|^maps\.app\.goo\.gl$/.test(host.replace(/^www\./, ""))) return "Googleマップ";
  return host.replace(/^www\./, "");
}
