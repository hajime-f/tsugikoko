import { SITE_URL } from "./site";

export const ANALYTICS_PREFERENCE_KEY = "tsugikoko:analytics-disabled";
export const ANALYTICS_PREFERENCE_EVENT = "tsugikoko:analytics-preference";
const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "";
export const analyticsConfigured = /^G-[A-Z0-9]+$/.test(measurementId);
const pages: Record<string, string> = { "/": "ツギココ", "/login": "ログイン | ツギココ", "/home": "ホーム | ツギココ" };
const methods: Record<string, string> = { "google.com": "Google", "twitter.com": "X", "facebook.com": "Facebook", "apple.com": "Apple" };
const campaignKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const sessionKey = "tsugikoko:analytics-last-activity";
const sessionTimeout = 30 * 60 * 1000;
const ctaIds = ["header_login", "header_signup", "hero_save", "scene_signup", "recommendation_signup", "footer_signup", "menu_signup", "login_mode_signup", "login_mode_login"] as const;
export type AnalyticsCta = typeof ctaIds[number];
export type AuthLocation = "landing_dialog" | "login_page";

type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
let initialized = false;
let lastPage: string | null = null;
let preferenceOverride: boolean | null = null;
let entryPending = true;
let lastActivity = 0;

// 値は広告運用用の短い識別名だけ。自由文、URL、メール、電話番号等は除外する。
// 名前のような英字列は機械的に識別できないので、UTMに個人情報を設定しないこと。
function campaignQuery() {
  const input = new URLSearchParams(window.location.search);
  const output = new URLSearchParams();
  for (const key of [...campaignKeys, "gclid"]) {
    const values = input.getAll(key);
    if (values.length !== 1) continue;
    const value = values[0];
    if (/[^A-Za-z0-9_-]/.test(value)) continue;
    const valid = key === "gclid"
      ? /^[A-Za-z0-9_-]{1,256}$/.test(value) && /[A-Za-z]/.test(value)
      : /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) && !/\d(?:[-_]?\d){6}/.test(value);
    if (valid) output.set(key, value);
  }
  return output.toString();
}

function entryReferrer() {
  if (!document.referrer) return { internal: false, origin: "" };
  try {
    const url = new URL(document.referrer);
    const siteHost = new URL(SITE_URL).hostname;
    const internal = url.origin === window.location.origin || url.hostname === siteHost || url.hostname.endsWith(`.${siteHost}`);
    const valid = /^https?:$/.test(url.protocol) && !url.username && !url.password && url.origin.length <= 255;
    return { internal, origin: !internal && valid ? url.origin : "" };
  } catch { return { internal: false, origin: "" }; }
}

// GAのCookieを読まず、同じタブの30分無操作を境に初回送信を制御する。
// sessionStorageが使えない場合は安全側に倒し、流入情報を送らない。
function touchSession() {
  const now = Date.now();
  try {
    const stored = Number(sessionStorage.getItem(sessionKey));
    const previous = Math.max(Number.isFinite(stored) ? stored : now, lastActivity);
    sessionStorage.setItem(sessionKey, String(now));
    lastActivity = now;
    return previous <= 0 || now - previous >= sessionTimeout;
  } catch { return false; }
}

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
    entryPending = false;
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
    // グローバル設定は常に無害化し、流入情報は初回page_viewだけに渡す。
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
    if (!Object.hasOwn(pages, pathname)) { entryPending = false; return; }
    const gtag = initialize();
    if (!gtag || lastPage === pathname) return;
    const parameters = pageParameters(pathname);
    const firstInSession = touchSession();
    const entry = entryPending && firstInSession && window.location.pathname === pathname;
    entryPending = false;
    const referrer = entry ? entryReferrer() : { internal: true, origin: "" };
    const query = entry && !referrer.internal ? campaignQuery() : "";
    gtag("set", parameters);
    gtag("event", "page_view", {
      ...parameters, page_location: parameters.page_location + (query ? `?${query}` : ""),
      page_referrer: referrer.origin, send_to: measurementId,
    });
    lastPage = pathname;
  } catch { /* 計測の失敗で画面や認証の動作を妨げない。 */ }
}

function trackEvent(name: string, parameters: Record<string, string | number>) {
  try {
    const pathname = window.location.pathname;
    if (!Object.hasOwn(pages, pathname)) return;
    const gtag = initialize();
    if (!gtag) return;
    touchSession();
    gtag("event", name, { ...parameters, ...pageParameters(pathname), send_to: measurementId });
  } catch { /* 計測の失敗で画面や認証の動作を妨げない。 */ }
}

export function trackSignUp(providerId: string) {
  if (Object.hasOwn(methods, providerId)) trackEvent("sign_up", { method: methods[providerId] });
}

export function trackCtaClick(buttonId: AnalyticsCta) {
  if (ctaIds.includes(buttonId)) trackEvent("cta_click", { button_id: buttonId });
}

export function trackLoginStart(providerId: string, location: AuthLocation, mode: "login" | "signup") {
  if (!Object.hasOwn(methods, providerId) || !["landing_dialog", "login_page"].includes(location) || !["login", "signup"].includes(mode)) return;
  trackEvent("login_start", { method: methods[providerId], button_location: location, auth_mode: mode });
}

export function trackScrollDepth(percent: number) {
  if (typeof window !== "undefined" && window.location.pathname === "/" && [25, 50, 75, 90].includes(percent)) {
    trackEvent("scroll_depth", { percent_scrolled: percent });
  }
}
