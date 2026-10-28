"use client";

import { useEffect, useRef, useState } from "react";
import { MapAddressLink } from "@/components/ui/map-address-link";
import { googleMapsUrl, type GooglePlaceDetails } from "@/lib/places/google-maps";
import type { SavedPlace } from "@/lib/places/schema";

export function GooglePlaceSummary({ place, api }: { place: SavedPlace; api: <T>(path: string, init?: RequestInit) => Promise<T> }) {
  const target = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<GooglePlaceDetails | null>(null);
  const [error, setError] = useState("");
  const eligible = !place.deleted && !place.googleLookupFailed && (!place.name || !place.address) && Boolean(googleMapsUrl(place.url));
  useEffect(() => {
    if (!eligible || !target.current) return;
    let active = true, started = false;
    setDetails(null); setError("");
    const load = () => {
      if (started) return;
      started = true;
      void api<{ place: GooglePlaceDetails }>(`/${place.id}/google-details`, { method: "POST" }).then(result => {
        if (active) setDetails(result.place);
      }).catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : "Googleマップの情報を取得できませんでした。");
      });
    };
    // 画面外のカードには課金対象のリクエストを送らない。ポーリング更新でも再取得しない。
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) load(); });
    observer.observe(target.current);
    return () => { active = false; observer.disconnect(); };
  }, [eligible, place.id, place.url, api]);
  const visible = eligible ? details : null;
  return <div ref={target}>
    {(place.name || !visible) && <h3>{place.name || `${place.sourceLabel}の気になるお店`}</h3>}
    {place.address && <p className="place-address"><MapAddressLink name={place.name} address={place.address} /></p>}
    {visible && <div className="google-place-details">
      {!place.name && <h3>{visible.name}</h3>}
      {!place.address && visible.address && <p className="place-address"><a href={visible.uri} target="_blank" rel="noopener noreferrer">{visible.address}</a></p>}
      <a className="google-maps-attribution" href={visible.uri} target="_blank" rel="noopener noreferrer" translate="no">Google Maps</a>
      {visible.attributions.map((item, index) => <a className="google-provider-attribution" href={item.uri} key={index} target="_blank" rel="noopener noreferrer">{item.name}</a>)}
    </div>}
    {eligible ? <p className="place-status-copy" role={error ? "status" : undefined}>{error || (visible ? "Googleマップの情報を表示しています。検索・共有に使う店名や住所は「編集」から入力できます。" : "Googleマップの店舗情報を確認しています。URLは保存済みです。")}</p>
      : !place.name.trim() && !place.deleted && <p className="place-status-copy">{place.extraction === "pending" ? "URLは保存済みです。画面を閉じても取得処理は続きます。" : "URLは保存済みです。「編集」から店名・住所を入力できます。"}</p>}
  </div>;
}
