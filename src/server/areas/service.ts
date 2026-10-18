import "server-only";
import { database } from "@/server/firebase/admin";
import { areaSchema, type Area } from "@/lib/areas/schema";

const areaRef = (uid: string) => database().doc(`users/${uid}/preferences/area`);

// 保存済みの値が現在のカタログで無効になった場合は全国として扱う。
export async function getArea(uid: string): Promise<Area | null> {
  const doc = await areaRef(uid).get();
  if (!doc.exists) return null;
  const parsed = areaSchema.safeParse({ prefectureCode: doc.get("prefectureCode"), municipalityCode: doc.get("municipalityCode") ?? null });
  return parsed.success ? parsed.data : null;
}

// 地域コードだけを保存する。変更したら本人のおすすめを作り直す。
export async function setArea(uid: string, area: Area | null): Promise<Area | null> {
  const batch = database().batch();
  if (area) batch.set(areaRef(uid), { ...area, updatedAt: Date.now() });
  else batch.delete(areaRef(uid));
  batch.delete(database().doc(`users/${uid}/recommendations/current`));
  await batch.commit();
  return area;
}
