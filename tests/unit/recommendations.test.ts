import { test } from "node:test";
import assert from "node:assert/strict";
import { fitModel, MAX_MODEL_BYTES, rank, serializeModel, type Model, type Own } from "../../src/server/recommendations/model";
import { recommendationActionSchema } from "../../src/lib/recommendations/schema";

const id = (n: number) => n.toString(16).padStart(64, "0");
const own = (profile: [number, number][], extra: Partial<Own> = {}): Own => ({ excluded: new Set(profile.map(([n]) => id(n))), urls: new Set(), profile: new Map(profile.map(([n, w]) => [id(n), w])), genres: [], ...extra });
const candidate = (n: number, supporters = 3, genre: Own["genres"][number] | null = null) => ({ id: id(n), genre, supporters, url: `https://shop${n}.example.com/` });

test("2店舗以上重なる人が3人以上支持する店舗だけを好みが近い推薦にする", () => {
  // 店舗1・2は本人も保存。店舗3は2店舗重なる3人、店舗4は1店舗だけ重なる3人が支持。
  const model: Model = {
    generatedAt: 0, truncated: false, places: [1, 2, 3, 4].map(id),
    candidates: [candidate(3), candidate(4)],
    profiles: { a: [0, 1, 1, 1, 2, 1], b: [0, 1, 1, 1.5, 2, 1], c: [0, 1, 1, 1, 2, 1], d: [0, 1, 3, 1], e: [0, 1, 3, 1], f: [1, 1, 3, 1], self: [0, 1, 1, 1, 3, 1] },
  };
  assert.deepEqual(rank(model, own([[1, 1], [2, 1]]), "self"), [{ id: id(3), reason: "similar_tastes" }, { id: id(4), reason: "popular" }]);
  // 本人の重なりが1店舗だけなら、好みが近い推薦を名乗らない。
  assert.deepEqual(rank(model, own([[1, 1]]), "self").map(item => item.reason), ["popular", "popular"]);
  // 好きなジャンル、URLだけの保存・興味なしの除外。
  const genreModel = { ...model, candidates: [candidate(3, 4), candidate(4, 3, "sushi")] };
  assert.deepEqual(rank(genreModel, own([], { genres: ["sushi"] }), "self"), [{ id: id(4), reason: "preferred_genre" }, { id: id(3), reason: "popular" }]);
  assert.deepEqual(rank(genreModel, own([], { urls: new Set(["https://shop3.example.com/"]), excluded: new Set([id(4)]) }), "self"), []);
});

test("長いURL・多数の店舗とユーザーでも、保存するモデルを1MiB未満に収める", () => {
  const model: Model = {
    generatedAt: 0, truncated: false,
    candidates: Array.from({ length: 1000 }, (_, n) => ({ ...candidate(n, 1000 - n), url: `https://example.com/${"a".repeat(2000)}${n}` })),
    places: Array.from({ length: 5000 }, (_, n) => id(n)),
    profiles: Object.fromEntries(Array.from({ length: 3000 }, (_, n) => [`user${n}`, Array.from({ length: 40 }, (_, i) => i % 2 ? 1.5 : (n + i) % 5000)])),
  };
  const fitted = fitModel(model);
  assert.ok(Buffer.byteLength(serializeModel(fitted)) <= MAX_MODEL_BYTES);
  assert.equal(fitted.truncated, true);
  assert.ok(fitted.candidates.length > 0);
  // 支持の多い候補から残す。
  assert.equal(fitted.candidates[0].id, id(0));
  assert.deepEqual(JSON.parse(serializeModel(fitted)).candidates.length, fitted.candidates.length);
  const small: Model = { generatedAt: 0, truncated: false, candidates: [candidate(1)], places: [id(1)], profiles: { a: [0, 1] } };
  assert.equal(fitModel(small).truncated, false);
});

test("おすすめの操作は定義済みの操作と共通店舗IDだけを受け付ける", () => {
  assert.equal(recommendationActionSchema.safeParse({ action: "save", id: id(1) }).success, true);
  for (const input of [{ action: "save", id: "x" }, { action: "delete", id: id(1) }, { action: "save", id: id(1), name: "偽の店名" }, { action: "save", id: id(1), url: "https://evil.example/" }]) {
    assert.equal(recommendationActionSchema.safeParse(input).success, false, JSON.stringify(input));
  }
});
