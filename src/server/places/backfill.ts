import "server-only";
import { createHash } from "node:crypto";
import { database } from "@/server/firebase/admin";
import { normalizeGenre } from "@/lib/places/genres";

type Field = "name" | "address" | "genre";
type Facts = Partial<Record<Field, { value: string; updatedAt: number }>>;
export type BackfillResult = { scanned: number; candidates: number; writes: number; skipped: number; truncated: boolean };

// 既存の保存記録から、本人が入力した店名・住所・ジャンルだけを同じURLの共通情報（urlFacts）へ作る。
// 保存記録は変更しない。新しい共通情報を古い入力で上書きしない。何度実行しても同じ結果になる。
export async function backfillUrlFacts({ apply, maxRecords = 20_000, maxWrites = 1_000 }: { apply: boolean; maxRecords?: number; maxWrites?: number }): Promise<BackfillResult> {
  const snapshot = await database().collectionGroup("savedPlaces")
    .select("url", "deleted", "editedFields", "customDetails", "name", "address", "genre", "updatedAt").limit(maxRecords).get();
  const byUrl = new Map<string, Facts>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.deleted || typeof data.url !== "string" || !data.url) continue;
    const edited: string[] = data.editedFields ?? (data.customDetails ? ["name", "address"] : []);
    const updatedAt = typeof data.updatedAt === "number" ? data.updatedAt : 0;
    const values: Partial<Record<Field, string | null>> = {
      name: edited.includes("name") && typeof data.name === "string" ? data.name.trim() : null,
      address: edited.includes("address") && typeof data.address === "string" ? data.address.trim() : null,
      genre: edited.includes("genre") ? normalizeGenre(data.genre) : null,
    };
    const facts = byUrl.get(data.url) ?? {};
    for (const field of ["name", "address", "genre"] as const) {
      const value = values[field];
      if (value && (!facts[field] || facts[field]!.updatedAt < updatedAt)) facts[field] = { value, updatedAt };
    }
    if (Object.keys(facts).length) byUrl.set(data.url, facts);
  }
  let writes = 0, skipped = 0;
  for (const [url, facts] of byUrl) {
    if (writes >= maxWrites) { skipped++; continue; }
    const ref = database().doc(`urlFacts/${createHash("sha256").update(url).digest("hex")}`);
    const changed = await database().runTransaction(async tx => {
      const current = await tx.get(ref);
      const currentAt = current.get("updatedAt") ?? 0;
      const patch: Record<string, string | number> = {};
      // 共通情報のほうが新しければ、その項目は上書きしない（空の項目だけを補う）。
      for (const field of ["name", "address", "genre"] as const) {
        const fact = facts[field];
        if (fact && (!current.get(field) || fact.updatedAt > currentAt) && current.get(field) !== fact.value) patch[field] = fact.value;
      }
      if (!Object.keys(patch).length) return false;
      const newest = Math.max(currentAt, ...Object.values(facts).map(fact => fact!.updatedAt));
      if (apply) tx.set(ref, { ...patch, updatedAt: newest }, { merge: true });
      return true;
    });
    if (changed) writes++; else skipped++;
  }
  return { scanned: snapshot.size, candidates: byUrl.size, writes, skipped, truncated: snapshot.size >= maxRecords };
}
