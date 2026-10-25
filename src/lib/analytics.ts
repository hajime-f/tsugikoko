import { SITE_URL } from "./site";

export const ANALYTICS_PREFERENCE_KEY = "tsugikoko:analytics-disabled";
export const ANALYTICS_PREFERENCE_EVENT = "tsugikoko:analytics-preference";
const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "";
export const analyticsConfigured = /^G-[A-Z0-9]+$/.test(measurementId);
const pages: Record<string, string> = { "/": "ツギココ", "/login": "ログイン | ツギココ", "/home": "ホーム | ツギココ" };
const methods: Record<string, string> = { "google.com": "Google", "twitter.com": "X", "facebook.com": "Facebook", "apple.com": "Apple" };

type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
let initialized = false;
let lastPage: string | null = null;
let preferenceOverride: boolean | null = null;

export function analyticsDisabled() {
  if (typeof window === "undefined") return true;
  if (preferenceOverride !== null) return preferenceOverride;
  try { return localStorage.getItem(ANALYTICS_PREFERENCE_KEY) === "true"; }
  catch { return true; }
}

function syncDisabled() {
  const disabled = analyticsDisabled();
  (window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`] = disabled;
  if (disabled) {
    lastPage = null;
    // タグ読み込み前のイベントだけを捨て、初期設定は再開時にも使えるよう残す。
    const queue = (window as AnalyticsWindow).dataLayer;
    if (queue) for (let index = queue.length - 1; index >= 0; index--) {
      if ((queue[index] as ArrayLike<unknown>)?.[0] === "event") queue.splice(index, 1);
    }
  }
  return disabled;
}

export function setAnalyticsDisabled(disabled: boolean) {
  let persisted = true;
  try { localStorage.setItem(ANALYTICS_PREFERENCE_KEY, String(disabled)); preferenceOverride = null; }
  catch { persisted = false; preferenceOverride = true; }
  syncDisabled();
  window.dispatchEvent(new Event(ANALYTICS_PREFERENCE_EVENT));
  return persisted;
}

function initialize() {
  if (typeof window === "undefined" || !analyticsConfigured || syncDisabled()) return null;
  const target = window as AnalyticsWindow;
  if (!initialized) {
    target.dataLayer ??= [];
    const existingTag = typeof target.gtag === "function";
    target.gtag ??= function () { target.dataLayer!.push(arguments); };
    // 実URLのクエリ・ハッシュや参照元を、初期化時から渡さない。
    target.gtag("set", { page_location: SITE_URL + "/", page_title: pages["/"], page_referrer: "" });
    if (!existingTag) target.gtag("js", new Date());
    target.gtag("config", measurementId, {
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
    });
    // headのGoogle広告タグとライブラリを共用する。GA4の送信先・停止設定は独立させる。
    if (!document.getElementById("tsugikoko-google-ads")) {
      const script = document.createElement("script");
      script.id = "tsugikoko-analytics";
      script.async = true;
      script.referrerPolicy = "no-referrer";
      script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
      document.head.appendChild(script);
    }
    initialized = true;
  }
  return target.gtag;
}

function pageParameters(pathname: string) {
  return { page_location: SITE_URL + pathname, page_title: pages[pathname], page_referrer: "" };
}

export function trackPageView(pathname: string) {
  try {
    if (typeof window === "undefined" || !analyticsConfigured || syncDisabled()) return;
    if (!Object.hasOwn(pages, pathname)) return;
    const gtag = initialize();
    if (!gtag || lastPage === pathname) return;
    lastPage = pathname;
    const parameters = pageParameters(pathname);
    gtag("set", parameters);
    gtag("event", "page_view", { ...parameters, send_to: measurementId });
  } catch { /* 計測の失敗で画面や認証の動作を妨げない。 */ }
}

export function trackSignUp(providerId: string) {
  try {
    if (!Object.hasOwn(methods, providerId)) return;
    const pathname = window.location.pathname;
    if (!Object.hasOwn(pages, pathname)) return;
    initialize()?.("event", "sign_up", { method: methods[providerId], ...pageParameters(pathname), send_to: measurementId });
  } catch { /* 計測の失敗で登録を失敗扱いにしない。 */ }
}
