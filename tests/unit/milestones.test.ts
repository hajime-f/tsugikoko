import { test } from "node:test";
import assert from "node:assert/strict";
import { isMilestone, milestoneSeenSchema, pendingMilestone } from "../../src/lib/milestones/schema";

test("保存件数の節目は5・10・20・50・100件、以後100件ごとで、未表示の最大の節目を1つだけ返す", () => {
  for (const value of [5, 10, 20, 50, 100, 200, 1000]) assert.equal(isMilestone(value), true, String(value));
  for (const value of [0, 1, 4, 6, 30, 150, 101, -5, 5.5]) assert.equal(isMilestone(value), false, String(value));
  assert.deepEqual([0, 4, 5, 9, 10, 19, 20, 49, 50, 99, 100, 199, 250].map(total => pendingMilestone(total, 0)), [null, null, 5, 5, 10, 10, 20, 20, 50, 50, 100, 100, 200]);
  // 表示済みの節目以下は出さず、長く使っている人には最高段階だけを出す。
  assert.equal(pendingMilestone(9, 5), null);
  assert.equal(pendingMilestone(10, 5), 10);
  assert.equal(pendingMilestone(250, 0), 200);
  assert.equal(pendingMilestone(250, 200), null);
  assert.equal(milestoneSeenSchema.safeParse({ threshold: 10 }).success, true);
  for (const input of [{ threshold: 7 }, { threshold: "10" }, { threshold: 10, uid: "other" }, {}]) assert.equal(milestoneSeenSchema.safeParse(input).success, false, JSON.stringify(input));
});
