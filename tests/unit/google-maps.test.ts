import { test } from "node:test";
import assert from "node:assert/strict";
import { googleMapsReference, googleMapsUrl } from "../../src/lib/places/google-maps";

test("Googleマップだけを判定し、偽ホスト・資格情報・ポート・他サービスを拒否する", () => {
  for (const url of ["https://maps.app.goo.gl/Abc12", "https://goo.gl/maps/Abc", "https://www.google.co.jp/maps/place/Cafe", "https://maps.google.com/?cid=123"]) assert.ok(googleMapsUrl(url));
  for (const url of ["https://maps.app.goo.gl.evil.com/Abc", "https://evil.com/maps/place/A", "https://user@google.com/maps", "https://www.google.com:444/maps", "https://www.google.com/search?q=cafe", "file://google.com/maps", "https://goo.gl/other"]) assert.equal(googleMapsUrl(url), null);
});

test("Place ID・店舗名・CIDを取り出し、座標のみ・経路・不正な入力を店舗と決めつけない", () => {
  const id = "ChIJN1t_tDeuEmsRUsoyG83frY4";
  assert.deepEqual(googleMapsReference(`https://www.google.com/maps/search/?api=1&query=cafe&query_place_id=${id}`), { id });
  assert.deepEqual(googleMapsReference(`https://maps.google.com/?q=place_id:${id}`), { id });
  const ref = googleMapsReference("https://www.google.com/maps/place/Test+Cafe/data=!4m2!3m1!1s0x123:0xff!3d35.2!4d139.3");
  assert.equal(ref?.text, "Test Cafe"); assert.equal(ref?.cid, "255");
  assert.equal(googleMapsReference("https://www.google.com/maps/place/Cafe%2B+Bar")?.name, "Cafe+ Bar");
  assert.deepEqual(ref?.location, { latitude: 35.2, longitude: 139.3 });
  for (const url of ["https://www.google.com/maps/dir/Cafe/Station", "https://maps.google.com/?q=35,139", "https://maps.google.com/?q=hello%0Aworld", "https://maps.google.com/?cid=123", "https://www.google.com/maps/place/%XX", "https://maps.app.goo.gl/Abc"]) assert.equal(googleMapsReference(url), null);
});
