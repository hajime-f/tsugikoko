// 共通のジャンル画像。実店舗の料理写真ではない。
export const genres = {
  sushi: { label: "寿司", image: "/images/genres/sushi-provided" },
  yakiniku: { label: "焼肉", image: "/images/genres/yakiniku-provided" },
  yakitori: { label: "焼き鳥", image: "/images/genres/yakitori-provided" },
  chinese: { label: "中華", image: "/images/genres/chinese-provided" },
  italian: { label: "イタリアン", image: "/images/genres/italian-provided" },
  french: { label: "フレンチ", image: "/images/genres/french-provided" },
  japanese: { label: "和食", image: "/images/genres/japanese-provided" },
  ramen: { label: "ラーメン", image: "/images/genres/ramen-photo" },
  curry: { label: "カレー", image: "/images/genres/curry-photo" },
  soba: { label: "そば", image: "/images/genres/soba-provided" },
  cafe: { label: "カフェ", image: "/images/landing/coffee-provided" },
  bakery: { label: "ベーカリー", image: "/images/genres/bakery-photo" },
  unagi: { label: "うなぎ", image: "/images/genres/unagi-provided" },
  okonomiyaki: { label: "お好み焼き", image: "/images/genres/okonomiyaki-provided" },
  afternoon_tea: { label: "アフタヌーンティー", image: "/images/genres/afternoon-tea-provided" },
  ethnic: { label: "エスニック料理", image: "/images/genres/ethnic-provided" },
  izakaya: { label: "居酒屋", image: "/images/genres/izakaya-provided" },
  kaiseki: { label: "懐石料理", image: "/images/genres/kaiseki-provided" },
  yoshoku: { label: "洋食", image: "/images/genres/yoshoku-provided" },
  teppanyaki: { label: "鉄板焼き", image: "/images/genres/teppanyaki-provided" },
} as const;
export type Genre = keyof typeof genres;
export function isGenre(value: unknown): value is Genre { return typeof value === "string" && Object.hasOwn(genres, value); }

// 料理分類や店名の明示的な語だけを対応付ける。曖昧な「飲食店」などは分類しない。
const patterns: [Genre, RegExp][] = [
  ["sushi", /寿司|鮨|すし|\bsushi\b/i],
  ["yakiniku", /焼肉|焼き肉|\byakiniku\b|korean barbecue/i],
  ["yakitori", /焼鳥|焼き鳥|やきとり|\byakitori\b/i],
  ["unagi", /うなぎ|ウナギ|鰻|\bunagi\b/i],
  ["okonomiyaki", /お好み焼き?|\bokonomiyaki\b/i],
  ["teppanyaki", /鉄板焼き?|\bteppanyaki\b/i],
  ["ramen", /ラーメン|らーめん|らぁめん|拉麺|中華そば|つけ麺|\bramen\b/i],
  ["soba", /蕎麦|そば|\bsoba\b/i],
  ["curry", /カレー|\bcurry\b/i],
  ["chinese", /中華|中国料理|広東料理|四川料理|\bchinese\b/i],
  ["italian", /イタリア|ピッツェリア|\bitalian\b|\bpizzeria\b/i],
  ["french", /フレンチ|フランス料理|\bfrench\b/i],
  ["afternoon_tea", /アフタヌーンティー?|\bafternoon\s+tea\b/i],
  ["kaiseki", /懐石|会席|\bkaiseki\b/i],
  ["yoshoku", /洋食|\byoshoku\b/i],
  ["ethnic", /エスニック|タイ料理|ベトナム料理|インド料理|インドネシア料理|\bethnic\b|\b(?:thai|vietnamese|indian|indonesian)\s+(?:food|cuisine)\b/i],
  ["izakaya", /居酒屋|\bizakaya\b/i],
  ["bakery", /ベーカリー|パン屋|パン専門|ブーランジェリー|\bbakery\b|\bboulangerie\b/i],
  ["cafe", /カフェ|喫茶|珈琲|コーヒー|\bcaf[eé]\b|\bcoffee\b/i],
  ["japanese", /日本料理|和食|割烹|\bjapanese\b/i],
];
export function genreFromText(text: string): Genre | null {
  const normalized = text.normalize("NFKC").replace(/焼き?そば|やきそば/g, "");
  return patterns.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}
