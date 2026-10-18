import { z } from "zod";
import type { Genre } from "../places/genres";
import type { Area } from "../areas/schema";

// similar_tastes: 保存が重なる他ユーザー（3人以上）が保存・高評価している。
// preferred_genre: 本人がよく保存するジャンルで、3人以上が保存している。
// popular: 本人の好みとは関係なく、3人以上が保存している。
export type RecommendationReason = "similar_tastes" | "preferred_genre" | "popular";
// 表示する店舗情報は共通店舗の検証済み情報だけ。idは共通店舗ID。
export type Recommendation = { id: string; name: string; address: string; genre: Genre | null; url: string; reason: RecommendationReason };
export type DismissedRecommendation = Omit<Recommendation, "reason">;
// personalized: 好みが近い人からの推薦を含む。fallback: ジャンル・人気の候補だけ。insufficient: 候補なし。
export type RecommendationMode = "personalized" | "fallback" | "insufficient";
// areaは推薦に使った利用エリア（nullは全国）。
export type RecommendationList = { items: Recommendation[]; nextCursor: string | null; generatedAt: number | null; mode: RecommendationMode; area: Area | null };
export type DismissedRecommendationList = { items: DismissedRecommendation[]; nextCursor: string | null };

export const recommendationIdSchema = z.string().regex(/^[a-f0-9]{64}$/, "おすすめが見つかりません。画面を再読み込みしてください。");
export const recommendationActionSchema = z.object({
  action: z.enum(["save", "dismiss", "restore"]),
  id: recommendationIdSchema,
}).strict();
export type RecommendationAction = z.infer<typeof recommendationActionSchema>;
