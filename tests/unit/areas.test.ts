import { test } from "node:test";
import assert from "node:assert/strict";
import { areaContains, areaFromAddress, areaKey, areaPreferenceSchema } from "../../src/lib/areas/schema";
import { rank, type Model, type Own } from "../../src/server/recommendations/model";

const area = (prefectureCode: string, municipalityCode: string | null = null) => ({ prefectureCode, municipalityCode });

test("利用エリアは存在する都道府県・市区町村コードの組み合わせだけを受け付ける", () => {
  for (const value of [null, area("13"), area("13", "13113"), area("14", "14100"), area("14", "14104")]) {
    assert.equal(areaPreferenceSchema.safeParse({ area: value }).success, true, JSON.stringify(value));
  }
  for (const value of [area("48"), area("1"), area("13", "14104"), area("13", "99999"), { ...area("13"), lat: 35.6 }, { prefectureCode: "13" }]) {
    assert.equal(areaPreferenceSchema.safeParse({ area: value }).success, false, JSON.stringify(value));
  }
  assert.equal(areaPreferenceSchema.safeParse({ area: null, location: [35.6, 139.7] }).success, false);
  assert.deepEqual([areaKey(null), areaKey(area("13")), areaKey(area("13", "13113"))], ["all", "13", "13113"]);
});

test("住所は都道府県名と市区町村名の最長一致で厳密に地域へ変換し、曖昧なら判定しない", () => {
  assert.deepEqual(areaFromAddress("東京都渋谷区恵比寿1-2-3"), area("13", "13113"));
  assert.deepEqual(areaFromAddress("〒150-0013 東京都 渋谷区恵比寿1-2-3"), area("13", "13113"));
  assert.deepEqual(areaFromAddress("神奈川県横浜市中区山下町1"), area("14", "14104"));
  assert.deepEqual(areaFromAddress("北海道札幌市中央区北1条西2"), area("01", "01101"));
  assert.deepEqual(areaFromAddress("北海道石狩郡当別町白樺町1"), area("01", "01303"));
  assert.deepEqual(areaFromAddress("東京都八丈島八丈町三根1"), area("13", "13401"));
  // 同名の市は都道府県名で区別し、都道府県名がなければ判定しない。
  assert.deepEqual(areaFromAddress("東京都府中市宮町1"), area("13", "13206"));
  assert.deepEqual(areaFromAddress("広島県府中市府川町1"), area("34", "34208"));
  assert.equal(areaFromAddress("府中市宮町1"), null);
  assert.equal(areaFromAddress("伊達市梁川町1"), null);
  // 都道府県名がなくても全国で1つに決まる市区町村は判定する。
  assert.deepEqual(areaFromAddress("渋谷区恵比寿1-2-3"), area("13", "13113"));
  assert.deepEqual(areaFromAddress("大和郡山市北郡山町1"), area("29", "29203"));
  // 都道府県名だけ分かる住所は県全域の店舗として扱う。
  assert.deepEqual(areaFromAddress("東京都某所1-2-3"), area("13"));
  assert.equal(areaFromAddress("住所非公開"), null);
});

test("市を選ぶと区を含み、県全域・全国に広げられる。地域不明の店舗は地域指定では含めない", () => {
  assert.equal(areaContains(area("14", "14100"), area("14", "14104")), true);
  assert.equal(areaContains(area("14", "14104"), area("14", "14100")), false);
  assert.equal(areaContains(area("13", "13206"), area("34", "34208")), false);
  assert.equal(areaContains(area("13"), area("13", "13113")), true);
  assert.equal(areaContains(area("13"), area("13")), true);
  assert.equal(areaContains(area("13", "13113"), area("13")), false);
  assert.equal(areaContains(area("13"), null), false);
  assert.equal(areaContains(null, null), true);
});

test("おすすめは地域で絞ってから順位を付け、件数の上限を適用する", () => {
  const id = (n: number) => n.toString(16).padStart(64, "0");
  const own: Own = { excluded: new Set(), urls: new Set(), profile: new Map(), genres: [] };
  const candidates = [
    ...Array.from({ length: 120 }, (_, n) => ({ id: id(n), genre: null, supporters: 1000 - n, url: `https://a${n}.example.com/`, prefectureCode: "27", municipalityCode: "27128" })),
    { id: id(500), genre: null, supporters: 3, url: "https://b.example.com/", prefectureCode: "13", municipalityCode: "13113" },
    { id: id(501), genre: null, supporters: 3, url: "https://c.example.com/", prefectureCode: null, municipalityCode: null },
  ];
  const model: Model = { generatedAt: 0, truncated: false, candidates, places: [], profiles: {} };
  assert.deepEqual(rank(model, own, "self", area("13", "13113")).map(item => item.id), [id(500)]);
  assert.deepEqual(rank(model, own, "self", area("13")).map(item => item.id), [id(500)]);
  assert.equal(rank(model, own, "self", null).length, 100);
});
