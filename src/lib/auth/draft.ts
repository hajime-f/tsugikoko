import { createPlaceSchema } from "@/lib/places/schema";

const pendingKey = "tsugikoko:pending-url";
const userKey = (uid: string) => `tsugikoko:draft:${uid}`;

export function validPlaceUrl(value: string) {
  const result = createPlaceSchema.safeParse({ url: value });
  return result.success ? result.data.url : null;
}

export function setPendingDraft(value: string) {
  try {
    const url = validPlaceUrl(value);
    if (url) sessionStorage.setItem(pendingKey, url);
    else sessionStorage.removeItem(pendingKey);
  } catch { /* Storageが使えなくても認証は継続する。 */ }
}

export function claimPendingDraft(uid: string) {
  try {
    const value = sessionStorage.getItem(pendingKey);
    if (value && validPlaceUrl(value)) sessionStorage.setItem(userKey(uid), value);
    sessionStorage.removeItem(pendingKey);
  } catch { /* URLは補助的な下書き。 */ }
}

export function readDraft(uid: string) {
  try { return validPlaceUrl(sessionStorage.getItem(userKey(uid)) ?? "") ?? ""; }
  catch { return ""; }
}

export function clearDraft(uid: string) {
  try { sessionStorage.removeItem(userKey(uid)); sessionStorage.removeItem(pendingKey); }
  catch { /* Storageが利用不可でもログアウトを妨げない。 */ }
}
