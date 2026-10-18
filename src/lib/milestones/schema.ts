import { z } from "zod";

// 保存件数の節目。5・10・20・50・100件、以後は100件ごと。
export function isMilestone(value: number) {
  return Number.isInteger(value) && ([5, 10, 20, 50].includes(value) || (value >= 100 && value % 100 === 0));
}
// total以下でshownより大きい最大の節目。なければnull。長く使っている人には最高段階の1つだけを出す。
export function pendingMilestone(total: number, shown: number): number | null {
  const reached = total >= 100 ? Math.floor(total / 100) * 100 : [50, 20, 10, 5].find(value => value <= total) ?? 0;
  return reached > shown ? reached : null;
}

// total: ごみ箱を除く本人の保存店舗数。pending: まだ表示していない最大の節目。
export type MilestoneStatus = { total: number; pending: number | null };
export const milestoneSeenSchema = z.object({
  threshold: z.number().refine(isMilestone, "表示した節目を確認できませんでした。"),
}).strict();
