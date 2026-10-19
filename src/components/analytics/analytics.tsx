"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ANALYTICS_PREFERENCE_EVENT, ANALYTICS_PREFERENCE_KEY, trackPageView } from "@/lib/analytics";

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
  return null;
}
