import { test } from "node:test";
import assert from "node:assert/strict";
import { previousJapanDay, summarize } from "../../src/lib/metrics/daily";

const at = (iso: string) => Date.parse(iso);

test("対象日は実行時刻の前日（日本時間）で、日本時間の0時から24時までを範囲にする", () => {
  // 日本時間 2026-10-19 00:15 は UTC 2026-10-18 15:15。
  assert.deepEqual(previousJapanDay(at("2026-10-18T15:15:00Z")), { date: "2026-10-18", start: at("2026-10-17T15:00:00Z"), end: at("2026-10-18T15:00:00Z") });
  // 日本時間 2026-10-19 23:59 でも前日は 10-18。
  assert.equal(previousJapanDay(at("2026-10-19T14:59:00Z")).date, "2026-10-18");
  assert.equal(previousJapanDay(at("2026-10-19T15:00:00Z")).date, "2026-10-19");
});

test("利用者と保存記録を、対象日の新規件数・累計・利用中の人数に集計する", () => {
  const now = at("2026-10-18T15:15:00Z"), day = previousJapanDay(now);
  const users = [
    { createdAt: at("2026-01-01T00:00:00Z"), lastActiveAt: at("2026-10-18T15:05:00Z") },
    { createdAt: at("2026-10-17T15:00:00Z"), lastActiveAt: at("2026-10-12T00:00:00Z") },
    { createdAt: at("2026-10-18T14:59:59Z"), lastActiveAt: null },
    { createdAt: at("2026-10-18T15:10:00Z"), lastActiveAt: at("2026-10-18T15:10:00Z") },
    { createdAt: at("2026-05-01T00:00:00Z"), lastActiveAt: at("2026-09-01T00:00:00Z") },
  ];
  const places = [
    { owner: "a", deleted: false, createdAt: at("2026-10-18T03:00:00Z"), visitCount: 2 },
    { owner: "a", deleted: false, createdAt: at("2026-09-01T00:00:00Z"), visitCount: 0 },
    { owner: "b", deleted: true, createdAt: at("2026-10-18T04:00:00Z"), visitCount: 5 },
    { owner: "c", deleted: false, createdAt: at("2026-10-16T00:00:00Z"), visitCount: 1 },
  ];
  const row = summarize(day, users, places, { now, truncated: false });
  assert.deepEqual(row, {
    date: "2026-10-18", generated_at: "2026-10-18T15:15:00.000Z", truncated: false,
    // 対象日の終わり以降に登録した人は含めない。
    total_users: 4, new_users: 2,
    // 最終利用時刻は対象日の終わり以降でも数える。
    active_users_7d: 3, active_users_30d: 3,
    users_with_places: 2, saved_places: 3,
    // 削除済みでも、対象日に作られた記録は新規として数える。
    new_saved_places: 2, visited_places: 2, total_visits: 3,
  });
});
