"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LocateFixed, LoaderCircle } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { getAreaLabel, MUNICIPALITIES, PREFECTURES } from "@/lib/areas/catalog";
import type { Area } from "@/lib/areas/schema";

export function useAreaApi() {
  const { user } = useAuth();
  return useCallback(async (body?: { area: Area | null }): Promise<{ area: Area | null }> => {
    if (!user) throw new Error("ログインし直してください。");
    const token = await user.getIdToken();
    const response = await fetch("/api/preferences/area", {
      method: body ? "PATCH" : "GET", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "エリアの設定を読み込めませんでした。");
    return data;
  }, [user]);
}

export function AreaSettings({ onChanged }: { onChanged: () => void }) {
  const api = useAreaApi();
  const [area, setArea] = useState<Area | null>(null);
  const [saved, setSaved] = useState<Area | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const preferenceRequest = useRef(0);
  const locationRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const saveLock = useRef(false);
  const load = useCallback(async () => {
    const version = ++preferenceRequest.current;
    setLoading(true); setError("");
    try {
      const result = await api();
      if (!mounted.current || version !== preferenceRequest.current) return;
      setSaved(result.area); setArea(result.area); setReady(true);
    } catch { if (mounted.current && version === preferenceRequest.current) setError("エリア設定を読み込めませんでした。もう一度お試しください。"); }
    finally { if (mounted.current && version === preferenceRequest.current) setLoading(false); }
  }, [api]);
  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; generation.current++; preferenceRequest.current++; locationRequest.current?.abort(); };
  }, [load]);

  function choose(next: Area | null) {
    generation.current++; locationRequest.current?.abort();
    setLocating(false); setArea(next); setNotice(""); setError("");
  }
  async function locate() {
    const version = ++generation.current;
    locationRequest.current?.abort();
    setError(""); setNotice("");
    if (!navigator.geolocation) { setError("このブラウザーでは現在地を取得できません。下の選択欄から設定してください。"); return; }
    setLocating(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }));
      if (version !== generation.current) return;
      const { latitude, longitude, accuracy } = position.coords;
      // 広い推定位置や国外は自動選択せず、手動設定を案内する。
      if (!Number.isFinite(accuracy) || accuracy > 5_000 || latitude < 20 || latitude > 46 || longitude < 122 || longitude > 154) throw new Error("location");
      const controller = new AbortController(); locationRequest.current = controller;
      // 座標はこの外部照会だけに使い、自社API・ストレージには送らない。
      const params = new URLSearchParams({ lat: latitude.toFixed(3), lon: longitude.toFixed(3) });
      const response = await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?${params}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]), credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store",
      });
      if (!response.ok) throw new Error("location");
      const data = await response.json();
      if (version !== generation.current) return;
      const code = typeof data.results?.muniCd === "string" ? data.results.muniCd.padStart(5, "0") : "";
      const municipality = MUNICIPALITIES.find(item => item.code === code);
      if (!municipality) throw new Error("location");
      const candidate = { prefectureCode: municipality.prefectureCode, municipalityCode: municipality.code };
      setArea(candidate);
      setNotice(`${getAreaLabel(candidate)}が見つかりました。境界付近では隣の地域になる場合があります。選択内容を確認して保存してください。`);
    } catch {
      if (version === generation.current) setError("現在地からエリアを確認できませんでした。位置情報の許可を確認するか、下の選択欄から設定してください。");
    } finally { if (version === generation.current) setLocating(false); }
  }

  return <section className="area-settings" aria-labelledby="area-settings-title">
    <h3 id="area-settings-title">おすすめのエリア</h3>
    <p>いつもの街も、次の旅行先も。お店の住所でおすすめを絞り込みます。</p>
    {loading && <p role="status">エリア設定を読み込んでいます...</p>}
    {error && <p className="area-error" role="alert">{error}{!ready && <button className="text-button" disabled={loading} onClick={() => void load()}>エリア設定を再読み込み</button>}</p>}
    {ready && <>
      <p className="area-current">保存中のエリア：{getAreaLabel(saved)}</p>
      <p className="area-privacy" id="location-purpose">現在地を使う場合、約100m単位に丸めた位置を国土地理院へ送って地域を調べます。ツギココに保存するのは選んだエリアだけです。位置の履歴は残しません。</p>
      <button className="button button-login area-locate" disabled={saving || locating} aria-describedby="location-purpose" onClick={() => void locate()}>{locating ? <LoaderCircle size={17} className="spinning" /> : <LocateFixed size={17} />}{locating ? "エリアを確認しています..." : "現在地から設定"}</button>
      <form onSubmit={async event => {
        event.preventDefault();
        if (saveLock.current || locating) return;
        saveLock.current = true; setSaving(true); setError(""); setNotice("");
        try {
          const result = await api({ area });
          onChanged();
          if (mounted.current) { setSaved(result.area); setArea(result.area); setNotice(`${getAreaLabel(result.area)}でおすすめを探します。`); }
        } catch { if (mounted.current) setError("エリアを保存できませんでした。選択内容は残っています。もう一度お試しください。"); }
        finally { saveLock.current = false; if (mounted.current) setSaving(false); }
      }}>
        <div className="area-selects">
          <label htmlFor="area-prefecture">都道府県<select id="area-prefecture" value={area?.prefectureCode ?? ""} disabled={saving} onChange={event => choose(event.target.value ? { prefectureCode: event.target.value, municipalityCode: null } : null)}><option value="">全国</option>{PREFECTURES.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <label htmlFor="area-municipality">市区町村<select id="area-municipality" value={area?.municipalityCode ?? ""} disabled={saving || !area} onChange={event => { if (area) choose({ ...area, municipalityCode: event.target.value || null }); }}><option value="">全域</option>{MUNICIPALITIES.filter(item => item.prefectureCode === area?.prefectureCode).map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        </div>
        <button className="button button-dark" disabled={saving || locating} type="submit">{saving ? "保存しています..." : "エリアを保存"}</button>
      </form>
      {notice && <p className="area-notice" role="status">{notice}</p>}
      <p className="area-source">国内のエリアに対応しています。地域データ：<a href="https://maps.gsi.go.jp/" target="_blank" rel="noopener noreferrer">国土地理院</a>を加工して利用。</p>
    </>}
  </section>;
}
