import "server-only";
import { database } from "@/server/firebase/admin";
import { ApiError } from "@/server/auth/request";
import { pendingMilestone, type MilestoneStatus } from "@/lib/milestones/schema";

const stateRef = (uid: string) => database().doc(`users/${uid}/milestones/state`);
const countSaved = async (uid: string) =>
  (await database().collection("users").doc(uid).collection("savedPlaces").where("deleted", "==", false).count().get()).data().count;

export async function milestoneStatus(uid: string): Promise<MilestoneStatus> {
  const [total, state] = await Promise.all([countSaved(uid), stateRef(uid).get()]);
  return { total, pending: pendingMilestone(total, state.get("shownThreshold") ?? 0) };
}

// 表示済みの最大の節目だけを残す。削除・再登録で同じ節目を繰り返し表示しない。
export async function markMilestoneShown(uid: string, threshold: number) {
  if (threshold > await countSaved(uid)) throw new ApiError(409, "保存件数が変わりました。画面を再読み込みしてください。");
  await database().runTransaction(async tx => {
    const state = await tx.get(stateRef(uid));
    tx.set(stateRef(uid), { shownThreshold: Math.max(state.get("shownThreshold") ?? 0, threshold), updatedAt: Date.now() });
  });
}
