import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";

// Firebase Webアプリの公開識別情報。OAuthシークレットはクライアントに置かない。
const config = {
  apiKey: "AIzaSyAoWDEYg1ykgPXpfgoVkap69BozicxSgw4",
  authDomain: "tsugikoko.firebaseapp.com",
  projectId: "tsugikoko",
  appId: "1:724577409231:web:8e8e67b6e6a3a4674c3fba",
  messagingSenderId: "724577409231",
};

let auth: Auth | undefined;

export function getClientAuth() {
  if (typeof window === "undefined") throw new Error("Authentication requires a browser.");
  if (!auth) {
    const emulator = process.env.NEXT_PUBLIC_AUTH_EMULATOR_URL;
    const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const useEmulator = Boolean(emulator && local);
    const app = getApps().length ? getApp() : initializeApp(useEmulator ? {
      ...config, apiKey: "demo-key", projectId: "demo-tsugikoko", authDomain: "demo-tsugikoko.firebaseapp.com",
    } : config);
    auth = getAuth(app);
    auth.languageCode = "ja";
    if (useEmulator) connectAuthEmulator(auth, emulator!, { disableWarnings: true });
  }
  return auth;
}
