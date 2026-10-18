"use client";

import { MapAddressLink } from "@/components/ui/map-address-link";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, ExternalLink, LoaderCircle, LockKeyhole, MapPin, RotateCcw, Sparkles, X } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { genres, isGenre } from "@/lib/places/genres";
import type { Recommendation, RecommendationList, DismissedRecommendation, DismissedRecommendationList } from "@/lib/recommendations/schema";

import { AreaSettings, useAreaApi } from "./area-settings";
import { getAreaLabel } from "@/lib/areas/catalog";
import type { Area } from "@/lib/areas/schema";

const reasons = {
  similar_tastes: "保存・評価の傾向が近い人から",
  preferred_genre: "保存したお店のジャンルから",
  popular: "保存・評価の傾向から",
};

class RecommendationError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function useRecommendationApi() {
  const { user } = useAuth();
  return useCallback(async <T,>(query = "", body?: { action: "save" | "dismiss" | "restore"; id: string }): Promise<T> => {
    if (!user) throw new Error("ログインし直してください。");
    const token = await user.getIdToken();
    const response = await fetch(`/api/recommendations${query}`, {
      method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new RecommendationError(data.error || "おすすめを読み込めませんでした。", response.status);
    return data;
  }, [user]);
}
const errorText = (error: unknown) => error instanceof Error && error.name !== "TimeoutError" ? error.message : "通信が途切れました。もう一度お試しください。";

export function RecommendationsSection({ revision, onSaved, onSettings }: { revision: number; onSaved: () => void; onSettings: () => void }) {
  const api = useRecommendationApi();
  const areaApi = useAreaApi();
  const [area, setArea] = useState<Area | null>(null);
  const [areaKnown, setAreaKnown] = useState(false);
  const section = useRef<HTMLElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [items, setItems] = useState<Recommendation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [mode, setMode] = useState<RecommendationList["mode"]>("insufficient");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const locked = useRef(false);
  const loadingRef = useRef(false);
  const retryCursor = useRef<string | null>(null);

  useEffect(() => {
    const target = section.current;
    if (!target) return;
    if (!("IntersectionObserver" in window)) { setEnabled(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setEnabled(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const load = useCallback(async (next: string | null = null) => {
    if (next && loadingRef.current) return;
    const version = ++generation.current;
    loadingRef.current = true; retryCursor.current = next; setLoading(true); setError("");
    try {
      const result = await api<RecommendationList>(next ? `?cursor=${encodeURIComponent(next)}` : "");
      if (version !== generation.current) return;
      setItems(current => next ? [...current, ...result.items.filter(item => !current.some(existing => existing.id === item.id))] : result.items);
      setCursor(result.nextCursor); setMode(result.mode); setArea(result.area ?? null); setAreaKnown(true);
    } catch (cause) { if (version === generation.current) { if (cause instanceof RecommendationError && cause.status === 400) retryCursor.current = null; setError(errorText(cause)); } }
    finally { if (version === generation.current) { loadingRef.current = false; setLoading(false); } }
  }, [api]);

  useEffect(() => {
    setMessage(""); setItems([]); setCursor(null); setAreaKnown(false);
    if (enabled) void load();
    return () => { generation.current++; loadingRef.current = false; };
  }, [enabled, load, revision]);

  async function act(item: Recommendation, action: "save" | "dismiss") {
    if (locked.current) return;
    locked.current = true; setBusy(item.id); setError(""); setMessage("");
    // 読み込み途中の候補が保存・除外したカードを復活させないようにする。
    generation.current++; loadingRef.current = false; setLoading(false);
    try {
      await api("", { action, id: item.id });
      setItems(current => current.filter(existing => existing.id !== item.id));
      setMessage(action === "save" ? `${item.name}をマイリストに保存しました。` : `${item.name}をおすすめから外しました。設定から解除できます。`);
      if (action === "save") onSaved();
    } catch (cause) { setError(errorText(cause)); }
    finally { locked.current = false; setBusy(null); }
  }

  async function broaden(next: Area | null) {
    if (locked.current || loadingRef.current) return;
    locked.current = true; setBusy("area"); setError("");
    try {
      await areaApi({ area: next });
      setItems([]); setCursor(null); setArea(next);
      await load();
    } catch (cause) { setError(errorText(cause)); }
    finally { locked.current = false; setBusy(null); }
  }

  return <section ref={section} className="recommendations-panel" id="for-you" aria-labelledby="for-you-title">
    <div className="recommendations-heading"><div><p className="eyebrow section-eyebrow">A LITTLE MORE YOU.</p><h2 id="for-you-title"><Sparkles size={24} />あなたへのおすすめ</h2></div><button className="text-button" onClick={onSettings}>おすすめ設定</button></div>
    <p className="recommendations-intro">{mode === "personalized" ? "保存や評価の傾向から、次に気になりそうな一軒を。" : "保存や評価が集まるほど、次の一軒を見つけやすくなります。"}</p>
    <div className="recommendation-area"><span><MapPin size={17} />{areaKnown ? getAreaLabel(area) : "おすすめのエリア"}</span><button className="text-button" onClick={onSettings}>エリアを変更</button></div>
    <p className="recommendation-policy"><LockKeyhole size={16} />非公開の保存・評価もおすすめの計算に使います。誰が何を保存・評価したかや、個人のメモ・感想は公開しません。</p>
    <p className="recommendations-notice" role="status">{message}</p>
    {error && <div className="places-error" role="alert">{error}<button className="text-button" disabled={loading || Boolean(busy)} onClick={() => void load(retryCursor.current)}>もう一度読み込む</button></div>}
    <div className="recommendation-grid" aria-busy={loading}>{items.map(item => {
      const genre = isGenre(item.genre) ? genres[item.genre] : null;
      return <article className="recommendation-card" key={item.id} aria-label={`おすすめ：${item.name}`}>
        <div className="recommendation-photo">{genre?.image ? <picture><source type="image/avif" srcSet={`${genre.image}.avif`} /><img src={`${genre.image}.webp`} alt={`${genre.label}のイメージ写真（実店舗の写真ではありません）`} width={720} height={288} loading="lazy" decoding="async" /></picture> : <Sparkles size={36} aria-hidden="true" />}{genre && <span>{genre.label}・イメージ</span>}</div>
        <div className="recommendation-body"><p className="recommendation-reason"><Sparkles size={14} />{reasons[item.reason]}</p><h3>{item.name}</h3><p className="recommendation-address"><MapAddressLink name={item.name} address={item.address} /></p><a className="recommendation-source" href={item.url} target="_blank" rel="noopener noreferrer">お店の掲載ページを見る<ExternalLink size={15} /></a><div className="recommendation-actions"><button className="button button-dark" disabled={Boolean(busy) || loading} onClick={() => void act(item, "save")}>{busy === item.id ? <LoaderCircle size={17} className="spinning" /> : <Bookmark size={17} />}行きたいに保存</button><button className="text-button" disabled={Boolean(busy) || loading} onClick={() => void act(item, "dismiss")}><X size={15} />興味なし</button></div></div>
      </article>;
    })}</div>
    {loading && <p className="places-loading" role="status"><LoaderCircle size={20} className="spinning" />おすすめを読み込んでいます...</p>}
    {enabled && !loading && !error && !items.length && !cursor && <div className="recommendations-empty"><Sparkles size={32} /><h3>{area ? "このエリアには、まだおすすめがありません。" : "次の一軒を見つける準備をしています。"}</h3><p>{area ? `${getAreaLabel(area)}で表示できる候補がありません。範囲を広げて探してみませんか。住所を確認できないお店は、このエリアの候補に含みません。` : "今は表示できる候補がありません。気になるお店の保存や、訪問後の評価を続けてみてください。"}</p>{area && <div className="area-broaden">{area.municipalityCode && <button className="button button-login" disabled={Boolean(busy)} onClick={() => void broaden({ ...area, municipalityCode: null })}>{getAreaLabel({ ...area, municipalityCode: null })}に広げる</button>}<button className="text-button" disabled={Boolean(busy)} onClick={() => void broaden(null)}>全国で探す</button></div>}<a className="text-button" href="#add-place">気になるお店を保存する</a></div>}
    {cursor && <button className="button button-login recommendations-more" disabled={loading || Boolean(busy)} onClick={() => void load(cursor)}>おすすめをもっと見る</button>}
    <p className="recommendations-footnote">現在は、対応するページから店舗情報を確認できたお店が対象です。手入力だけのお店は対象に含みません。候補は原則1日ごとに更新します。保存済みのお店と「興味なし」のお店は表示しません。</p>
  </section>;
}

export function RecommendationSettings({ onChanged }: { onChanged: () => void }) {
  const api = useRecommendationApi();
  const [items, setItems] = useState<DismissedRecommendation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const locked = useRef(false);
  const load = useCallback(async (next: string | null = null) => {
    const version = ++generation.current; setLoading(true); setError("");
    try {
      const result = await api<DismissedRecommendationList>(`?dismissed=1${next ? `&cursor=${encodeURIComponent(next)}` : ""}`);
      if (version !== generation.current) return;
      setItems(current => next ? [...current, ...result.items.filter(item => !current.some(existing => existing.id === item.id))] : result.items); setCursor(result.nextCursor);
    } catch (cause) { if (version === generation.current) setError(errorText(cause)); }
    finally { if (version === generation.current) setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  return <div className="recommendation-settings"><AreaSettings onChanged={onChanged} /><p>非公開の保存・評価も推薦の計算に使います。個人のメモ・感想や、誰が保存・評価したかを、ほかの人に表示することはありません。</p><h3>「興味なし」にしたお店</h3><p>解除すると、条件に合うときに再びおすすめに表示されます。</p>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}<button className="text-button" disabled={loading || busy} onClick={() => void load()}>再読み込み</button></p>}
    <ul>{items.map(item => <li key={item.id}><span>{item.name || "店舗情報を表示できないお店"}<small><MapAddressLink name={item.name} address={item.address} /></small></span><button className="text-button" disabled={busy || loading} aria-label={`${item.name || "店舗情報を表示できないお店"}の興味なしを解除`} onClick={async () => {
      if (locked.current) return;
      locked.current = true; setBusy(true); setError("");
      try { await api("", { action: "restore", id: item.id }); setItems(current => current.filter(existing => existing.id !== item.id)); setMessage(`${item.name || "お店"}の「興味なし」を解除しました。`); onChanged(); }
      catch (cause) { setError(errorText(cause)); }
      finally { locked.current = false; setBusy(false); }
    }}><RotateCcw size={15} />解除</button></li>)}</ul>
    {loading && <p role="status">読み込んでいます...</p>}{!loading && !error && !items.length && <p>「興味なし」にしたお店はありません。</p>}
    {cursor && <button className="text-button" disabled={loading || busy} onClick={() => void load(cursor)}>さらに表示</button>}
  </div>;
}
