"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ANALYTICS_PREFERENCE_EVENT, ANALYTICS_PREFERENCE_KEY, analyticsDisabled } from "@/lib/analytics";

export const adsenseConfigured = process.env.NEXT_PUBLIC_ADSENSE_ENABLED === "true";
const publisher = "ca-pub-9669747563254817";
const slot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_MYLIST ?? "";
const layoutKey = process.env.NEXT_PUBLIC_ADSENSE_LAYOUT_KEY_MYLIST ?? "";
export const myListAdConfigured = adsenseConfigured && /^\d{1,20}$/.test(slot) && !/[^0-9]/.test(slot)
  && (!layoutKey || (/^[A-Za-z0-9_+-]{1,100}$/.test(layoutKey) && !/[^A-Za-z0-9_+-]/.test(layoutKey)));
let started = false;
export function adsenseWasLoaded() {
  return typeof document !== "undefined" && (started || Boolean(document.getElementById("tsugikoko-adsense")));
}

function loadAdSense() {
  if (!adsenseConfigured || analyticsDisabled() || adsenseWasLoaded()) return;
  const script = document.createElement("script");
  script.id = "tsugikoko-adsense";
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisher}`;
  try { document.head.appendChild(script); started = true; }
  catch { /* 広告の失敗で店舗操作や認証を止めない。 */ }
}

// 実行済みJSはscript削除では止まらない。停止/対象外の画面への移動時はドキュメントを破棄する。
export function AdSenseLifecycle() {
  const pathname = usePathname();
  useEffect(() => {
    const sync = () => {
      if (!adsenseWasLoaded()) return;
      if (analyticsDisabled()) {
        let persisted = false;
        try { persisted = localStorage.getItem(ANALYTICS_PREFERENCE_KEY) === "true"; } catch { /* 再読込で設定が失われる場合は広告なしページへ。 */ }
        // 同じURLへのreplaceはハッシュ付きだと文書内移動になるため、reloadで確実に破棄する。
        if (persisted) window.location.reload();
        else window.location.replace("/privacy");
      } else if (!["/", "/home"].includes(window.location.pathname)) window.location.reload();
    };
    const storage = (event: StorageEvent) => { if (event.key === ANALYTICS_PREFERENCE_KEY || event.key === null) sync(); };
    sync();
    window.addEventListener(ANALYTICS_PREFERENCE_EVENT, sync);
    window.addEventListener("storage", storage);
    window.addEventListener("pageshow", sync);
    return () => {
      window.removeEventListener(ANALYTICS_PREFERENCE_EVENT, sync);
      window.removeEventListener("storage", storage);
      window.removeEventListener("pageshow", sync);
    };
  }, [pathname]);
  return null;
}

export function AdSense({ eligible }: { eligible: boolean }) {
  useEffect(() => {
    const sync = () => { if (eligible && window.location.pathname === "/") loadAdSense(); };
    sync();
    window.addEventListener(ANALYTICS_PREFERENCE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(ANALYTICS_PREFERENCE_EVENT, sync); window.removeEventListener("storage", sync); };
  }, [eligible]);
  return null;
}

// 店舗の値を受け取らない。カードの間の1枠だけ。再描画・モーダル開閉で再配信を要求しない。
export function MyListAd({ eligible }: { eligible: boolean }) {
  const [disabled, setDisabled] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(true);
  const [retired, setRetired] = useState(false);
  const element = useRef<HTMLModElement>(null);
  const pushed = useRef(false);
  useEffect(() => {
    if (!myListAdConfigured) return;
    const preference = () => setDisabled(analyticsDisabled());
    const dialogs = () => setDialogOpen(Boolean(document.querySelector(".dialog-overlay")));
    preference(); dialogs();
    const observer = new MutationObserver(dialogs);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener(ANALYTICS_PREFERENCE_EVENT, preference);
    window.addEventListener("storage", preference);
    return () => { observer.disconnect(); window.removeEventListener(ANALYTICS_PREFERENCE_EVENT, preference); window.removeEventListener("storage", preference); };
  }, []);
  const allowed = eligible && !disabled && !dialogOpen;
  useEffect(() => { if (pushed.current && !allowed) setRetired(true); }, [allowed]);
  const visible = myListAdConfigured && allowed && !retired;
  useEffect(() => {
    if (!visible || !element.current || pushed.current || window.location.pathname !== "/home") return;
    const node = element.current;
    const start = () => {
      if (pushed.current || analyticsDisabled() || document.querySelector(".dialog-overlay") || node.getBoundingClientRect().width < 250) return;
      loadAdSense();
      if (!adsenseWasLoaded()) return;
      pushed.current = true;
      try {
        const target = window as Window & { adsbygoogle?: { push: (value: Record<string, never>) => unknown } };
        if (!target.adsbygoogle) target.adsbygoogle = [] as Record<string, never>[];
        target.adsbygoogle.push({});
      } catch { /* ブロックや広告エラーでも保存・編集は継続できる。 */ }
    };
    start();
    const observer = new ResizeObserver(start);
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);
  if (!visible) return null;
  return <aside className="mylist-ad" aria-label="広告">
    <p className="mylist-ad-label">広告</p>
    <ins ref={element} className="adsbygoogle" style={{ display: "block" }} data-ad-format="fluid"
      data-ad-client={publisher} data-ad-slot={slot} data-ad-layout-key={layoutKey || undefined} />
  </aside>;
}
