import "server-only";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export function adminApp() {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (emulator && (!/^127\.0\.0\.1:\d+$/.test(emulator) || process.env.GCLOUD_PROJECT !== "demo-tsugikoko" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099")) throw new Error("Invalid emulator configuration");
  return getApps()[0] ?? initializeApp(emulator
    ? { projectId: "demo-tsugikoko" }
    : { credential: applicationDefault(), projectId: "tsugikoko" });
}
export const database = () => getFirestore(adminApp());
export const adminAuth = () => getAuth(adminApp());
