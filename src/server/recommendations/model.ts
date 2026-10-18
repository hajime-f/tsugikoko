// 推薦の計算。Firestoreに依存せず、単体テストから使える。
import type { Genre } from "../../lib/places/genres";
import type { RecommendationReason } from "../../lib/recommendations/schema";
import { areaContains, type Area } from "../../lib/areas/schema";

// 他ユーザーの記録が特定されないよう、3人以上が支持する店舗だけを候補にする。
export const MIN_SUPPORTERS = 3;
// 好みが近いとみなすのは、肯定的に保存した共通店舗が2件以上重なる場合だけ。
export const MIN_SHARED_PLACES = 2;
// 1ドキュメント（1MiB）に確実に収める上限。
export const MAX_MODEL_BYTES = 900_000;
const MAX_CACHED_ITEMS = 100;
// 候補の地域コードを持たない旧モデルは作り直す。
export const MODEL_VERSION = 2;

export type Model = {
  generatedAt: number; truncated: boolean;
  // 推薦できる共通店舗（3人以上が支持し、安全な出典がある）。
  // 地域コードは共通店舗の住所から判定したもの。判定できない店舗はnull。
  candidates: { id: string; genre: Genre | null; supporters: number; url: string; prefectureCode?: string | null; municipalityCode?: string | null }[];
  // 好みの近さの計算に使う店舗と、匿名化したユーザーごとの [店舗の番号, 重み] の並び。
  places: string[]; profiles: Record<string, number[]>;
};


export type Own = { excluded: Set<string>; urls: Set<string>; profile: Map<string, number>; genres: Genre[] };

// モデルは1つの文字列フィールドとして保存する。重なりの少ないユーザー、支持の少ない候補の順に外し、
// 保存する文字列が必ずMAX_MODEL_BYTES以下になるようにする。
export function fitModel(model: Model): Model {
  const serialized = () => Buffer.byteLength(serializeModel(model));
  if (serialized() <= MAX_MODEL_BYTES) return model;
  model.truncated = true;
  const smallestFirst = Object.entries(model.profiles).sort((a, b) => a[1].length - b[1].length).map(([key]) => key);
  while (serialized() > MAX_MODEL_BYTES && smallestFirst.length) {
    for (const key of smallestFirst.splice(0, Math.ceil(smallestFirst.length / 10))) delete model.profiles[key];
  }
  if (!Object.keys(model.profiles).length) model.places = [];
  // 候補は支持の多い順に並んでいるので、末尾から外す。
  while (serialized() > MAX_MODEL_BYTES && model.candidates.length) model.candidates.splice(-Math.ceil(model.candidates.length / 10));
  return model;
}
export const serializeModel = (model: Model) => JSON.stringify({ truncated: model.truncated, candidates: model.candidates, places: model.places, profiles: model.profiles });

export type Ranked = { id: string; reason: RecommendationReason };
// 保存が重なる他ユーザー（コサイン類似度）の支持を合計し、支持者が3人以上の店舗だけを好みの近い推薦にする。
export function rank(model: Model, own: Own, self: string, area: Area | null = null): Ranked[] {
  const index = new Map(model.places.map((id, i) => [id, i]));
  const mine = new Map<number, number>();
  for (const [id, weight] of own.profile) if (index.has(id)) mine.set(index.get(id)!, weight);
  const norm = (entries: Iterable<number>) => Math.sqrt([...entries].reduce((sum, w) => sum + w * w, 0));
  const myNorm = norm(mine.values());
  const scores = new Map<number, number>(), backers = new Map<number, number>();
  if (myNorm > 0) {
    for (const [key, flat] of Object.entries(model.profiles)) {
      if (key === self) continue;
      let dot = 0; const theirs: [number, number][] = [];
      for (let i = 0; i < flat.length; i += 2) { theirs.push([flat[i], flat[i + 1]]); dot += (mine.get(flat[i]) ?? 0) * flat[i + 1]; }
      if (theirs.filter(([place]) => mine.has(place)).length < MIN_SHARED_PLACES) continue;
      const similarity = dot / (myNorm * norm(theirs.map(([, w]) => w)));
      for (const [place, weight] of theirs) {
        if (mine.has(place)) continue;
        scores.set(place, (scores.get(place) ?? 0) + similarity * weight);
        backers.set(place, (backers.get(place) ?? 0) + 1);
      }
    }
  }
  // 地域で先に絞ってから上限件数を適用する。住所から地域が分からない店舗は、地域を指定したときは除外する。
  const candidates = model.candidates.filter(candidate => !own.excluded.has(candidate.id) && !own.urls.has(candidate.url) &&
    areaContains(area, candidate.prefectureCode ? { prefectureCode: candidate.prefectureCode, municipalityCode: candidate.municipalityCode ?? null } : null));
  const used = new Set<string>(), ranked: Ranked[] = [];
  const personalized = candidates.filter(c => index.has(c.id) && (backers.get(index.get(c.id)!) ?? 0) >= MIN_SUPPORTERS)
    .sort((a, b) => scores.get(index.get(b.id)!)! - scores.get(index.get(a.id)!)! || b.supporters - a.supporters || a.id.localeCompare(b.id));
  for (const c of personalized) { ranked.push({ id: c.id, reason: "similar_tastes" }); used.add(c.id); }
  const byPopularity = (a: Model["candidates"][number], b: Model["candidates"][number]) => b.supporters - a.supporters || a.id.localeCompare(b.id);
  for (const c of candidates.filter(c => !used.has(c.id) && c.genre && own.genres.includes(c.genre)).sort(byPopularity)) { ranked.push({ id: c.id, reason: "preferred_genre" }); used.add(c.id); }
  for (const c of candidates.filter(c => !used.has(c.id)).sort(byPopularity)) ranked.push({ id: c.id, reason: "popular" });
  return ranked.slice(0, MAX_CACHED_ITEMS);
}
