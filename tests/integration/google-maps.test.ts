import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { database } from "../../src/server/firebase/admin";
import { createPlace, updatePlace } from "../../src/server/places/service";
import { lookupGooglePlace, readGooglePlace, resolveGoogleMapsUrl } from "../../src/server/places/google-maps";
import { POST } from "../../src/app/api/places/[id]/google-details/route";
import { ApiError } from "../../src/server/auth/request";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.GCLOUD_PROJECT !== "demo-tsugikoko") throw new Error("Demo emulator required");
const placeId = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const url = `https://www.google.com/maps/search/?api=1&query=cafe&query_place_id=${placeId}`;
const raw = { id: placeId, displayName: { text: "Google由来の見本店" }, formattedAddress: "見本市1-2", googleMapsUri: "https://maps.google.com/?cid=255", attributions: [{ provider: "Example provider", providerUri: "https://example.com/" }] };
const payload = { id: placeId, name: raw.displayName.text, address: raw.formattedAddress, uri: raw.googleMapsUri, attributions: [{ name: "Example provider", uri: "https://example.com/" }] };
const setup = async () => { const uid = `maps-${randomUUID()}`; return { uid, place: (await createPlace(uid, url)).place }; };
const original = { key: process.env.GOOGLE_PLACES_API_KEY, day: process.env.GOOGLE_PLACES_DAILY_LIMIT, month: process.env.GOOGLE_PLACES_MONTHLY_LIMIT };
beforeEach(async () => {
  process.env.GOOGLE_PLACES_API_KEY = "test-only-not-a-key";
  delete process.env.GOOGLE_PLACES_DAILY_LIMIT; delete process.env.GOOGLE_PLACES_MONTHLY_LIMIT;
  await database().doc("serviceLimits/googlePlaces").delete();
});
afterEach(() => {
  for (const [key, value] of Object.entries({ GOOGLE_PLACES_API_KEY: original.key, GOOGLE_PLACES_DAILY_LIMIT: original.day, GOOGLE_PLACES_MONTHLY_LIMIT: original.month })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("短縮リンクはGoogleへの転送だけを追い、外部転送・ループ・本文取得を拒否", async () => {
  let calls = 0;
  assert.equal(await resolveGoogleMapsUrl("https://maps.app.goo.gl/Abc", async (_url, _accept, bytes) => {
    calls++; assert.equal(bytes, 0); return { status: 302, contentType: "", body: "", location: url };
  }), url);
  assert.equal(calls, 1);
  for (const status of [200, 404, 429, 500, 503]) {
    await assert.rejects(resolveGoogleMapsUrl("https://maps.app.goo.gl/Abc", async () => ({ status, contentType: "", body: "" })), { status: 503 });
  }
  for (const location of ["http://127.0.0.1/private", "https://evil.com/", "https://www.google.com/url?q=https://evil.com", "https://maps.app.goo.gl/Abc"]) {
    calls = 0;
    await assert.rejects(resolveGoogleMapsUrl("https://maps.app.goo.gl/Abc", async () => { calls++; return { status: 302, contentType: "", body: "", location }; }), { status: 422 });
    assert.equal(calls, 1);
  }
});

test("APIは必要項目だけを要求し、キーをURLへ入れず、no-storeで取得", async () => {
  const result = await lookupGooglePlace(url, undefined, "secret", { request: (async (input, init) => {
    assert.match(String(input), /^https:\/\/places.googleapis.com\/v1\/places\/ChIJ/);
    assert.ok(!String(input).includes("secret")); assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("X-Goog-FieldMask"), "id,displayName,formattedAddress,googleMapsUri,attributions");
    return Response.json(raw);
  }) as typeof fetch });
  assert.deepEqual(result, payload);
  await assert.rejects(lookupGooglePlace(url, undefined, "secret", { request: (async () => Response.json({ ...raw, id: "ChIJAnotherStore000" })) as typeof fetch }), { status: 422 });
});

test("検索候補はCIDで照合し、同名の複数店舗や帰属URLの不正を拒否", async () => {
  const input = "https://www.google.com/maps/place/Test+Cafe/data=!1s0x123:0xff!3d35!4d139";
  const request = (async (_url, init) => {
    const query = JSON.parse(String(init?.body)); assert.equal(query.textQuery, "Test Cafe");
    return Response.json({ places: [{ ...raw, id: "ChIJWrongStore000", googleMapsUri: "https://maps.google.com/?cid=99" }, raw] });
  }) as typeof fetch;
  assert.deepEqual(await lookupGooglePlace(input, undefined, "key", { request }), payload);
  // Googleの応答URIがCID形式でなくなった場合も、推測で採用しない。
  await assert.rejects(lookupGooglePlace(input, undefined, "key", { request: (async () => Response.json({ places: [{ ...raw, googleMapsUri: "https://www.google.com/maps/place/Test+Cafe" }] })) as typeof fetch }), { status: 422 });
  const ambiguous = (async () => Response.json({ places: [raw, raw].map(value => ({ ...value, displayName: { text: "Test Cafe" } })) })) as typeof fetch;
  await assert.rejects(lookupGooglePlace("https://www.google.com/maps/place/Test+Cafe", undefined, "key", { request: ambiguous }), { status: 422 });
  await assert.rejects(lookupGooglePlace(url, undefined, "key", { request: (async () => Response.json({ ...raw, attributions: [{ provider: "bad", providerUri: "javascript:alert(1)" }] })) as typeof fetch }));
});

test("表示情報は保存・共通情報に混ぜず、識別子だけを次の取得に引き継ぐ", async () => {
  const { uid, place } = await setup();
  await updatePlace(uid, place.id, { name: "私の店名", address: "", note: "秘密メモ", genre: null });
  const before = (await database().doc(`users/${uid}/savedPlaces/${place.id}`).get()).data()!;
  const result = await readGooglePlace(uid, place.id, { lookup: async () => payload });
  assert.deepEqual(result.place, payload);
  const after = (await database().doc(`users/${uid}/savedPlaces/${place.id}`).get()).data()!;
  for (const field of ["name", "address", "genre", "note", "placeId", "extraction", "updatedAt"]) assert.deepEqual(after[field], before[field]);
  assert.equal(after.googlePlaceId, placeId);
  assert.ok(!JSON.stringify(after).includes(payload.name)); assert.ok(!JSON.stringify(after).includes(payload.address));
  assert.equal((await database().doc(`places/${placeId}`).get()).exists, false);
  const hash = createHash("sha256").update(url).digest("hex");
  assert.equal((await database().doc(`placeSources/${hash}`).get()).exists, false);
  assert.ok(!JSON.stringify((await database().doc(`urlFacts/${hash}`).get()).data()).includes(payload.name));
  await readGooglePlace(uid, place.id, { now: Date.now() + 31_000, lookup: async (_url, savedId) => { assert.equal(savedId, placeId); return payload; } });
});

test("他人の記録・削除済み・未設定・未認証ではGoogleへ送信しない", async () => {
  const { uid, place } = await setup();
  let calls = 0; const lookup = async () => { calls++; return payload; };
  await assert.rejects(readGooglePlace("other-user", place.id, { lookup }), { status: 404 });
  delete process.env.GOOGLE_PLACES_API_KEY;
  await assert.rejects(readGooglePlace(uid, place.id, { lookup }), { status: 503 });
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  await updatePlace(uid, place.id, { action: "trash" });
  await assert.rejects(readGooglePlace(uid, place.id, { lookup }), { status: 404 });
  const response = await POST(new Request("http://localhost/api/places/x/google-details", { method: "POST" }), { params: Promise.resolve({ id: place.id }) });
  assert.equal(response.status, 401); assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(calls, 0);
});

test("特定不能なURLは再表示でも枠を使わず、一時的な失敗とは区別する", async () => {
  const { uid, place } = await setup(); let calls = 0;
  const lookup = async () => { calls++; throw new ApiError(422, "特定不能"); };
  await assert.rejects(readGooglePlace(uid, place.id, { lookup }), { status: 422 });
  await assert.rejects(readGooglePlace(uid, place.id, { lookup, now: Date.now() + 31_000 }), { status: 422 });
  assert.equal(calls, 1);
  assert.equal((await database().doc("serviceLimits/googlePlaces").get()).get("daily"), 1);
  const temporary = await setup();
  await assert.rejects(readGooglePlace(temporary.uid, temporary.place.id, { lookup: async () => { throw new ApiError(503, "一時障害"); } }), { status: 503 });
  assert.equal((await database().doc(`users/${temporary.uid}/savedPlaces/${temporary.place.id}`).get()).get("googleLookupFailedAt"), undefined);
  await assert.rejects(readGooglePlace(temporary.uid, temporary.place.id, { lookup: async () => payload }), error => {
    assert.match((error as Error).message, /30秒ほど/); assert.ok(!(error as Error).message.includes("上限")); return true;
  });
});

test("競合しても日次・月次上限を超えず、同じカードの連打と削除中の結果を防ぐ", async () => {
  const now = Date.UTC(2026, 9, 15, 12);
  process.env.GOOGLE_PLACES_DAILY_LIMIT = "2";
  const items = await Promise.all([setup(), setup(), setup()]); let calls = 0;
  const lookup = async () => { calls++; return payload; };
  const result = await Promise.allSettled(items.map(({ uid, place }) => readGooglePlace(uid, place.id, { lookup, now })));
  assert.equal(result.filter(item => item.status === "fulfilled").length, 2); assert.equal(calls, 2);
  delete process.env.GOOGLE_PLACES_DAILY_LIMIT;
  process.env.GOOGLE_PLACES_MONTHLY_LIMIT = "2";
  const extra = await setup();
  await assert.rejects(readGooglePlace(extra.uid, extra.place.id, { lookup, now: now + 86_400_000 }), { status: 429 });
  delete process.env.GOOGLE_PLACES_MONTHLY_LIMIT;
  const same = await setup();
  const repeated = await Promise.allSettled([1, 2].map(() => readGooglePlace(same.uid, same.place.id, { lookup, now })));
  assert.equal(repeated.filter(item => item.status === "fulfilled").length, 1);
  const removed = await setup();
  await assert.rejects(readGooglePlace(removed.uid, removed.place.id, { lookup: async () => {
    await updatePlace(removed.uid, removed.place.id, { action: "trash" }); return payload;
  } }), { status: 409 });
});
