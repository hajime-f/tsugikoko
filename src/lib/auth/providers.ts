import { FacebookAuthProvider, GoogleAuthProvider, OAuthProvider, TwitterAuthProvider } from "firebase/auth";

export const providers = [
  { id: "google.com", name: "Google", mark: "G" },
  { id: "twitter.com", name: "X", mark: "X" },
  { id: "facebook.com", name: "Facebook", mark: "f" },
  { id: "apple.com", name: "Apple", mark: "A" },
] as const;
export type ProviderId = typeof providers[number]["id"];
const enabled = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? "google.com").split(",");
export const isProviderEnabled = (id: ProviderId) => enabled.includes(id);

export function createProvider(id: ProviderId) {
  switch (id) {
    case "google.com": return new GoogleAuthProvider().setCustomParameters({ prompt: "select_account" });
    case "twitter.com": return new TwitterAuthProvider();
    case "facebook.com": return new FacebookAuthProvider();
    case "apple.com": {
      const provider = new OAuthProvider("apple.com");
      provider.addScope("email");
      provider.addScope("name");
      return provider;
    }
  }
}

export function authErrorMessage(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  switch (code) {
    case "auth/popup-closed-by-user": return "ログインをキャンセルしました。もう一度お試しいただけます。";
    case "auth/cancelled-popup-request": return "開いているログイン画面で操作を続けてください。";
    case "auth/popup-blocked": return "ログイン画面を開けませんでした。このサイトのポップアップを許可して、もう一度お試しください。SNS内のブラウザでは、SafariやChromeで開き直してください。";
    case "auth/account-exists-with-different-credential": return "別のログイン方法で登録済みです。以前の方法でログインし、「アカウント」から今回の方法を追加してください。";
    case "auth/credential-already-in-use": return "この認証方法は別のアカウントに登録されています。アカウントの自動統合は行いません。以前のアカウントでログインしてください。";
    case "auth/provider-already-linked": return "このログイン方法はすでに連携済みです。";
    case "auth/requires-recent-login": return "安全のため、ログインし直してから操作してください。";
    case "auth/network-request-failed": return "通信できませんでした。接続を確認して、もう一度お試しください。";
    case "auth/too-many-requests": return "操作が集中しています。少し時間をおいてお試しください。";
    case "auth/user-disabled": return "このアカウントは現在利用できません。";
    case "auth/unauthorized-domain":
    case "auth/operation-not-allowed":
    case "auth/configuration-not-found": return "このログイン方法は現在利用できません。別の方法をお試しください。";
    default: return "操作を完了できませんでした。時間をおいて、もう一度お試しください。";
  }
}
