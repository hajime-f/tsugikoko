import { test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";

test("本人・他人・未ログインのいずれもFirestoreを直接読み書きできない", async () => {
  const env = await initializeTestEnvironment({ projectId: "demo-tsugikoko", firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8") } });
  try {
    await env.withSecurityRulesDisabled(async (context) => { await setDoc(doc(context.firestore(), "users/owner/savedPlaces/one"), { note: "非公開のメモ" }); });
    for (const context of [env.authenticatedContext("owner"), env.authenticatedContext("other"), env.unauthenticatedContext()]) {
      const db = context.firestore();
      await assertFails(getDoc(doc(db, "users/owner/savedPlaces/one")));
      await assertFails(getDocs(collection(db, "users/owner/savedPlaces")));
      await assertFails(setDoc(doc(db, "users/owner/savedPlaces/two"), { visibility: "public" }));
      await assertFails(getDoc(doc(db, "places/common")));
      await assertFails(setDoc(doc(db, "placeSources/source"), { name: "偽の共通店舗" }));
    }
  } finally { await env.cleanup(); }
});
