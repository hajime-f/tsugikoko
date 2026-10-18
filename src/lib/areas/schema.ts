import { z } from "zod";
import { MUNICIPALITIES, PREFECTURES } from "./catalog";

// 利用エリア。municipalityCodeがnullなら都道府県全域。Area自体がnullなら全国。
// 保存するのは地域コードだけで、座標や移動履歴は扱わない。
export type Area = { prefectureCode: string; municipalityCode: string | null };

const compact = (text: string) => text.normalize("NFKC").replace(/\s+/g, "");
const prefectures = new Map(PREFECTURES.map(prefecture => [prefecture.code, { ...prefecture, key: compact(prefecture.name) }]));
const municipalities = new Map(MUNICIPALITIES.map(municipality => [municipality.code, { ...municipality, key: compact(municipality.name) }]));
// 政令指定都市の区は、市名で始まる同じ都道府県の「市」に含まれる。
const parentCity = new Map<string, string>();
for (const ward of municipalities.values()) {
  if (!ward.key.endsWith("区")) continue;
  const city = [...municipalities.values()].find(city => city.code !== ward.code && city.prefectureCode === ward.prefectureCode && city.key.endsWith("市") && ward.key.startsWith(city.key));
  if (city) parentCity.set(ward.code, city.code);
}

export const areaSchema = z.object({
  prefectureCode: z.string().regex(/^\d{2}$/),
  municipalityCode: z.string().regex(/^\d{5}$/).nullable(),
}).strict().refine(area => {
  if (!prefectures.has(area.prefectureCode)) return false;
  if (area.municipalityCode === null) return true;
  return municipalities.get(area.municipalityCode)?.prefectureCode === area.prefectureCode;
}, "地域を選び直してください。");
export const areaPreferenceSchema = z.object({ area: areaSchema.nullable() }).strict();

// キャッシュとカーソルを地域ごとに分けるためのキー。
export const areaKey = (area: Area | null) => area ? area.municipalityCode ?? area.prefectureCode : "all";

// 住所を地域コードに変換する。先頭の都道府県名と、その都道府県内の市区町村名の最長一致で判定し、
// 都道府県名がない住所は市区町村名が全国で1つに決まる場合だけ判定する。判定できなければnull。
export function areaFromAddress(address: string): Area | null {
  let rest = compact(address).replace(/^〒?\d{3}-?\d{4}/, "");
  const prefecture = [...prefectures.values()].find(prefecture => rest.startsWith(prefecture.key));
  if (prefecture) rest = rest.slice(prefecture.key.length);
  const match = (text: string) => [...municipalities.values()]
    .filter(municipality => (!prefecture || municipality.prefectureCode === prefecture.code) && text.startsWith(municipality.key))
    .sort((a, b) => b.key.length - a.key.length);
  // 郡名・島名を含む住所（例: 石狩郡当別町、八丈島八丈町）は、それを除いても照合する。
  let found = match(rest);
  if (!found.length) found = match(rest.replace(/^[^\d]{1,6}?[郡島]/, ""));
  const longest = found.filter(municipality => municipality.key.length === found[0]?.key.length);
  if (longest.length === 1) return { prefectureCode: longest[0].prefectureCode, municipalityCode: longest[0].code };
  return prefecture ? { prefectureCode: prefecture.code, municipalityCode: null } : null;
}

// 店舗の地域が利用エリアに含まれるか。全国なら常に含む。市を選んだ場合はその区も含む。
export function areaContains(area: Area | null, place: Area | null) {
  if (!area) return true;
  if (!place || place.prefectureCode !== area.prefectureCode) return false;
  if (!area.municipalityCode) return true;
  return place.municipalityCode === area.municipalityCode || (place.municipalityCode !== null && parentCity.get(place.municipalityCode) === area.municipalityCode);
}
