import { z } from "zod";
import { genreFromText, isGenre, type Genre } from "./genres";

export const fsqSelectionSchema = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/), version: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const fsqRowSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/), name: z.string().min(1).max(120), address: z.string().min(8).max(300),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  genre: z.custom<Genre>(isGenre).nullable(), refreshed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  flags: z.array(z.string().max(200)).max(30),
}).strict();
export type FsqRow = z.infer<typeof fsqRowSchema>;
export type FsqCandidate = FsqRow & { distance: number; exact: boolean; warnings: string[] };
export type FsqLookup = { enabled: boolean; version: string; candidates: FsqCandidate[]; automatic: boolean; more: boolean };
export type FsqField = "name" | "address" | "genre";
export type FsqProvenance = { id: string; version: string; importedAt: number;
  fields: Partial<Record<FsqField, { before: string | null; applied: string | null; editedBefore: boolean }>> };

export const fsqCatalogSchema = z.object({ format: z.literal(1), source: z.literal("Foursquare OS Places"),
  version: z.string().regex(/^[a-f0-9]{64}$/), generatedAt: z.string().datetime(), rows: z.array(fsqRowSchema).max(100_000),
}).strict();
export const fsqName = (value: string) => value.normalize("NFKC").replace(/[\s・]/g, "").toLowerCase();
export function fsqDistance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180, dlat = (a.latitude - b.latitude) * rad, dlon = (a.longitude - b.longitude) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
// 支店名の片側欠落は候補にするが、完全一致と区別して本人に確認を求める。
export function fsqNameMatch(a: string, b: string) {
  const left = fsqName(a), right = fsqName(b);
  if (left === right) return "exact";
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  return short.length >= 4 && long.startsWith(short) && /^.{1,30}店$/.test(long.slice(short.length)) ? "branch" : null;
}
export function fsqCandidates(rows: FsqRow[], name: string, point: { latitude: number; longitude: number }, now = Date.now()) {
  return rows.flatMap(row => {
    const match = fsqNameMatch(name, row.name), distance = fsqDistance(point, row);
    if (!match || distance > 100) return [];
    const refreshed = row.refreshed ? Date.parse(row.refreshed) : NaN;
    const warnings = [
      ...(match === "branch" ? ["支店名の表記が異なります。住所を確認してください。"] : []),
      ...(row.flags.length ? ["この店舗には未確認の報告があります。営業状況や住所を確認してください。"] : []),
      ...(!Number.isFinite(refreshed) || refreshed > now || now - refreshed > 365 * 86_400_000 ? ["情報の更新時期を確認できないか、更新から1年以上経過しています。"] : []),
    ];
    return [{ ...row, distance: Math.round(distance), exact: match === "exact", warnings }];
  }).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
}

// OSエクスポートだけを受け付ける。Googleの値を不足項目の補完に使わない。
export function prepareFsqRow(input: Record<string, unknown>): FsqRow | null {
  if (input.country !== "JP" || input.date_closed) return null;
  if (typeof input.region !== "string" || typeof input.locality !== "string" || typeof input.address !== "string") return null;
  if (!input.region.trim() || !input.locality.trim() || !input.address.trim()) return null;
  const labels = Array.isArray(input.fsq_category_labels) ? input.fsq_category_labels.filter((v): v is string => typeof v === "string") : [];
  if (!labels.some(label => label.startsWith("Dining and Drinking"))) return null;
  const parsed = fsqRowSchema.safeParse({ id: input.fsq_place_id, name: typeof input.name === "string" ? input.name.trim() : "",
    address: input.region + input.locality + input.address, latitude: input.latitude, longitude: input.longitude,
    genre: genreFromText(labels.join(" ")), refreshed: input.date_refreshed ?? null, flags: input.unresolved_flags ?? [] });
  return parsed.success ? parsed.data : null;
}
