// 共通のジャンル画像。実店舗の料理写真ではない。
export const genres = {
  sushi: { label: "寿司", image: "/images/genres/sushi" },
  yakiniku: { label: "焼肉", image: "/images/genres/yakiniku" },
  yakitori: { label: "焼き鳥", image: "/images/genres/yakitori" },
  chinese: { label: "中華", image: "/images/genres/chinese" },
  italian: { label: "イタリアン", image: "/images/genres/italian" },
  french: { label: "フレンチ", image: "/images/genres/french" },
  japanese: { label: "和食", image: "/images/genres/japanese" },
  ramen: { label: "ラーメン", image: "/images/genres/ramen" },
  curry: { label: "カレー", image: "/images/genres/curry" },
  soba: { label: "そば", image: "/images/genres/soba" },
  cafe: { label: "カフェ", image: "/images/landing/coffee-provided" },
  bakery: { label: "ベーカリー", image: "/images/genres/bakery" },
} as const;
export type Genre = keyof typeof genres;
export function isGenre(value: unknown): value is Genre { return typeof value === "string" && Object.hasOwn(genres, value); }

// 料理分類や店名の明示的な語だけを対応付ける。曖昧な「飲食店」などは分類しない。
const patterns: [Genre, RegExp][] = [
  ["sushi", /寿司|鮨|すし|\bsushi\b/i],
  ["yakiniku", /焼肉|焼き肉|\byakiniku\b|korean barbecue/i],
  ["yakitori", /焼鳥|焼き鳥|やきとり|\byakitori\b/i],
  ["ramen", /ラーメン|らーめん|らぁめん|拉麺|中華そば|つけ麺|\bramen\b/i],
  ["soba", /蕎麦|そば|\bsoba\b/i],
  ["curry", /カレー|\bcurry\b/i],
  ["chinese", /中華|中国料理|広東料理|四川料理|\bchinese\b/i],
  ["italian", /イタリア|ピッツェリア|\bitalian\b|\bpizzeria\b/i],
  ["french", /フレンチ|フランス料理|\bfrench\b/i],
  ["bakery", /ベーカリー|パン屋|パン専門|ブーランジェリー|\bbakery\b|\bboulangerie\b/i],
  ["cafe", /カフェ|喫茶|珈琲|コーヒー|\bcaf[eé]\b|\bcoffee\b/i],
  ["japanese", /日本料理|和食|割烹|懐石|会席|\bjapanese\b|\bkaiseki\b/i],
];
export function genreFromText(text: string): Genre | null {
  const normalized = text.normalize("NFKC").replace(/焼き?そば|やきそば/g, "");
  return patterns.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}
