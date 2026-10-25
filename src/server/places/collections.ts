import "server-only";
import { randomUUID } from "node:crypto";
import { database } from "@/server/firebase/admin";
import { ApiError } from "@/server/auth/request";
import { MAX_PLACE_LISTS, type CollectionAction, type MembershipAction, type PlaceCollection } from "@/lib/places/schema";

// 最大50件を1ドキュメントで管理し、件数制限・名前の重複・削除と所属更新を直列化する。
export const collectionsRef = (uid: string) => database().doc(`users/${uid}/settings/placeLists`);
export const collectionsOf = (doc: FirebaseFirestore.DocumentSnapshot): PlaceCollection[] => doc.get("items") ?? [];
export const activeListIds = (ids: string[] | undefined, lists: PlaceCollection[]) => {
  const active = new Set(lists.map(list => list.id));
  return [...new Set(ids ?? [])].filter(id => active.has(id));
};
export async function getCollections(uid: string) {
  return collectionsOf(await collectionsRef(uid).get());
}
export async function changeCollection(uid: string, input: CollectionAction) {
  return database().runTransaction(async tx => {
    const ref = collectionsRef(uid), lists = collectionsOf(await tx.get(ref));
    const current = input.action === "create" ? undefined : lists.find(list => list.id === input.id);
    if (input.action !== "create") {
      if (!current) {
        if (input.action === "delete") return { lists }; // 応答消失後も再試行可能。
        throw new ApiError(404, "リストが見つかりません。一覧を読み直してください。");
      }
      if (current.updatedAt !== input.updatedAt) {
        if (input.action === "rename" && current.name === input.name) return { lists, list: current };
        throw new ApiError(409, "別の画面でリストが変更されました。一覧を読み直してください。");
      }
    }
    const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
    if (input.action !== "delete") {
      const duplicate = lists.find(list => list.id !== current?.id && normalize(list.name) === normalize(input.name));
      if (duplicate) {
        if (input.action === "create") return { lists, list: duplicate };
        throw new ApiError(409, "同じ名前のリストがあります。別の名前にしてください。");
      }
    }
    if (input.action === "create" && lists.length >= MAX_PLACE_LISTS) throw new ApiError(422, "リストは50件まで作成できます。");
    const now = Math.max(Date.now(), (current?.updatedAt ?? 0) + 1);
    const list = input.action === "delete" ? undefined : {
      id: current?.id ?? randomUUID(), name: input.name, createdAt: current?.createdAt ?? now, updatedAt: now,
    };
    const next = input.action === "create" ? [...lists, list!] : lists.flatMap(item => item.id === input.id ? (list ? [list] : []) : [item]);
    // 削除したIDは再利用しない。所属は有効なリストとの積集合として解決するので、
    // 店舗全件の更新なしで即時に解除される。残ったIDは所属更新・店舗統合時に除去する。
    tx.set(ref, { items: next });
    return { lists: next, ...(list ? { list } : {}) };
  });
}

export async function getMembership(uid: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new ApiError(404, "保存したお店が見つかりません。");
  return database().runTransaction(async tx => {
    const [doc, registry] = await Promise.all([tx.get(database().doc(`users/${uid}/savedPlaces/${id}`)), tx.get(collectionsRef(uid))]);
    if (!doc.exists || doc.get("deleted")) throw new ApiError(409, "お店が統合・削除された可能性があります。マイリストを読み直してください。");
    const lists = collectionsOf(registry);
    return { lists, listIds: activeListIds(doc.get("listIds"), lists) };
  }, { readOnly: true });
}

export async function setMembership(uid: string, id: string, input: MembershipAction) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new ApiError(404, "保存したお店が見つかりません。");
  return database().runTransaction(async tx => {
    const ref = database().doc(`users/${uid}/savedPlaces/${id}`);
    const [doc, registry] = await Promise.all([tx.get(ref), tx.get(collectionsRef(uid))]);
    if (!doc.exists || doc.get("deleted")) throw new ApiError(409, "お店が統合・削除された可能性があります。マイリストを読み直してください。");
    const lists = collectionsOf(registry), desired = activeListIds(input.listIds, lists);
    if (desired.length !== input.listIds.length) throw new ApiError(409, "選択したリストが見つかりません。一覧を読み直してください。");
    const current = activeListIds(doc.get("listIds"), lists), expected = activeListIds(input.expectedListIds, lists);
    const same = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
    if (same(current, desired)) return { listIds: current };
    if (!same(current, expected)) throw new ApiError(409, "別の画面で所属リストが変更されました。一覧を読み直して選び直してください。");
    tx.update(ref, { listIds: desired, updatedAt: Math.max(Date.now(), (doc.get("updatedAt") ?? 0) + 1) });
    return { listIds: desired };
  });
}
