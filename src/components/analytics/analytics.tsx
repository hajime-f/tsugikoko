"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ANALYTICS_PREFERENCE_EVENT, ANALYTICS_PREFERENCE_KEY, trackPageView, trackScrollDepth } from "@/lib/analytics";

export function Analytics() {
  const pathname = usePathname();
  useEffect(() => {
    const update = () => trackPageView(pathname);
    const storage = (event: StorageEvent) => { if (event.key === ANALYTICS_PREFERENCE_KEY || event.key === null) update(); };
    update();
    window.addEventListener(ANALYTICS_PREFERENCE_EVENT, update);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(ANALYTICS_PREFERENCE_EVENT, update);
      window.removeEventListener("storage", storage);
    };
  }, [pathname]);
  useEffect(() => {
    if (pathname !== "/") return;
    const reached = new Set<number>();
    let frame = 0;
    const measure = () => {
      frame = 0;
      // 初期表示だけでは送らず、画面下端が本文全体の各割合を通過したら送る。
      if (window.scrollY <= 0) return;
      const percent = 100 * (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight;
      for (const threshold of [25, 50, 75, 90]) {
        if (percent < threshold || reached.has(threshold)) continue;
        reached.add(threshold);
        trackScrollDepth(threshold);
      }
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    window.addEventListener("scroll", scroll, { passive: true });
    return () => { window.removeEventListener("scroll", scroll); cancelAnimationFrame(frame); };
  }, [pathname]);
  return null;
}
