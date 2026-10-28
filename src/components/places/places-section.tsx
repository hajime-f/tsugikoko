"use client";

import { SharePlaceButton } from "@/components/places/share-place-button";
import { PlaceListsDialog } from "@/components/places/place-lists-dialog";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, Check, Coffee, ExternalLink, Link2, LoaderCircle, LockKeyhole, MapPin, Pencil, Plus, RotateCcw, Search, Star, Trash2, UtensilsCrossed } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createPlaceSchema, type PlaceCollection, type PlaceList, type PlaceListQuery, type SavedPlace } from "@/lib/places/schema";

import { VisitDialog } from "@/components/places/visit-dialog";
import { GooglePlaceSummary } from "@/components/places/google-place-summary";
import { genreGroups, genres, isGenre, type Genre } from "@/lib/places/genres";

const cardMotifs = [Coffee, UtensilsCrossed, MapPin, Bookmark];
function PlaceArtwork({ id, genre }: { id: string; genre: Genre | null }) {
  const item: { label: string; image: string | null } | null = isGenre(genre) ? genres[genre] : null;
  if (item?.image) {
    return <><picture className="place-genre-picture"><source type="image/avif" srcSet={`${item.image}.avif`} /><img src={`${item.image}.webp`} alt={`${item.label}のイメージ写真（実店舗の写真ではありません）`} width={720} height={288} loading="lazy" decoding="async" /></picture><span className="place-genre-caption">{item.label}<small>イメージ</small></span></>;
  }
  const Motif = cardMotifs[parseInt(id.slice(-4), 16) % cardMotifs.length] ?? Coffee;
  return <><span className="place-art" aria-hidden="true"><Motif size={32} strokeWidth={1.5} /></span>{item && <span className="place-genre-caption place-genre-text">{item.label}</span>}</>;
}

export function PlacesSection({ draft, onSaved, revision = 0, onChanged }: { draft: string; onSaved: () => void; revision?: number; onChanged?: () => void }) {
  const { user } = useAuth();
  const [url, setUrl] = useState(draft);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"saved" | "visited" | "trash">("saved");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [genreFilter, setGenreFilter] = useState<PlaceListQuery["genre"]>("all");
  const [sort, setSort] = useState<PlaceListQuery["sort"]>("newest");
  const [listFilter, setListFilter] = useState("all");
  const [collections, setCollections] = useState<PlaceCollection[]>([]);
  const [collectionsError, setCollectionsError] = useState("");
  const [listsDialog, setListsDialog] = useState<{ place: SavedPlace | null } | null>(null);
  const [savedPlace, setSavedPlace] = useState<SavedPlace | null>(null);
  const collectionsRequestVersion = useRef(0);
  const filtered = Boolean(query || genreFilter !== "all" || listFilter !== "all");
  const searching = filtered || sort !== "newest";
  const fullScan = Boolean(query || genreFilter !== "all" || sort !== "newest" || listFilter === "unfiled");
  const clearConditions = useCallback(() => { setSearchInput(""); setQuery(""); setGenreFilter("all"); setSort("newest"); setListFilter("all"); }, []);
  const [error, setError] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [modal, setModal] = useState<{ mode: "edit" | "trash"; place: SavedPlace } | null>(null);
  const [visitDialog, setVisitDialog] = useState<{ place: SavedPlace; mode: "add" | "history" } | null>(null);
  const [fields, setFields] = useState<{ name: string; address: string; note: string; genre: Genre | null }>({ name: "", address: "", note: "", genre: null });
  const [modalError, setModalError] = useState("");
  const locked = useRef(false);
  const attemptedDraft = useRef("");
  const active = useRef(true);
  const requestVersion = useRef(0);
  const fetching = useRef<number | null>(null);
  const loadedPages = useRef(1);
  const lastRevision = useRef(revision);
  const loadMoreTarget = useRef<HTMLDivElement>(null);
  const sourceInput = useRef<HTMLInputElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (draft) setUrl(draft); }, [draft]);

  const api = useCallback(async <T,>(path = "", init?: RequestInit): Promise<T> => {
    if (!user) throw new Error("ログインし直してください。");
    const token = await user.getIdToken();
    const response = await fetch(`/api/places${path}`, {
      ...init, cache: "no-store", signal: AbortSignal.timeout(path.endsWith("/google-details") ? 55_000 : 20_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || "処理に失敗しました。もう一度お試しください。"), { status: response.status });
    return data as T;
  }, [user]);

  const receiveCollections = useCallback((lists: PlaceCollection[]) => {
    collectionsRequestVersion.current++;
    setCollections(lists); setCollectionsError("");
    setListFilter(current => ["all", "unfiled"].includes(current) || lists.some(list => list.id === current) ? current : "all");
  }, []);
  const loadCollections = useCallback(async () => {
    const version = ++collectionsRequestVersion.current;
    try {
      const result = await api<{ lists: PlaceCollection[] }>("/lists");
      if (active.current && version === collectionsRequestVersion.current) receiveCollections(result.lists);
    } catch { if (active.current && version === collectionsRequestVersion.current) setCollectionsError("リストを読み込めませんでした。"); }
  }, [api, receiveCollections]);
  useEffect(() => { void loadCollections(); }, [loadCollections]);

  const reload = useCallback(async (nextCursor: string | null = null, quiet = false) => {
    // 自動追加・定期更新を重ねず、明示的な更新は古い応答を無効にする。
    if ((nextCursor || quiet) && fetching.current !== null) return;
    if (quiet && locked.current) return;
    const version = ++requestVersion.current;
    fetching.current = version;
    if (nextCursor) { setLoadingMore(true); setPageError(""); }
    else { setLoading(true); setLoadingMore(false); if (!quiet) { setError(""); setPageError(""); } }
    try {
      let pageCursor = nextCursor;
      const limit = nextCursor ? 1 : loadedPages.current;
      const refreshed = new Map<string, SavedPlace>();
      let pagesRead = 0;
      // 更新時も表示済みのページ数を維持。追加・削除で境界がずれても重複させない。
      do {
        const params = new URLSearchParams({ trash: tab === "trash" ? "1" : "0", status: tab === "trash" ? "all" : tab });
        if (query) params.set("q", query);
        if (genreFilter !== "all") params.set("genre", genreFilter);
        if (sort !== "newest") params.set("sort", sort);
        if (listFilter !== "all") params.set("list", listFilter);
        if (pageCursor) params.set("cursor", pageCursor);
        const result = await api<PlaceList>(`?${params}`);
        if (!active.current || version !== requestVersion.current) return;
        for (const place of result.places) refreshed.set(place.id, place);
        pageCursor = result.nextCursor;
        pagesRead++;
      } while (pageCursor && pagesRead < limit);
      const incoming = [...refreshed.values()];
      setPlaces((current) => {
        if (!nextCursor) return incoming;
        const existing = new Set(current.map(place => place.id));
        return [...current, ...incoming.filter(place => !existing.has(place.id))];
      });
      loadedPages.current = nextCursor ? loadedPages.current + 1 : pagesRead;
      setCursor(pageCursor);
    } catch (cause) {
      if (active.current && version === requestVersion.current) (nextCursor ? setPageError : setError)(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "通信が途切れました。もう一度読み込んでください。");
      if (active.current && version === requestVersion.current && cause instanceof Error && "status" in cause && cause.status === 404 && !["all", "unfiled"].includes(listFilter)) await loadCollections();
    } finally {
      if (active.current && version === requestVersion.current) {
        fetching.current = null; setLoading(false); setLoadingMore(false);
      }
    }
  }, [api, tab, query, genreFilter, sort, listFilter, loadCollections]);

  useEffect(() => {
    loadedPages.current = 1; setPlaces([]); setCursor(null); setPageError(""); setError(""); setLoadingMore(false);
    void reload();
    return () => { requestVersion.current++; fetching.current = null; };
  }, [reload]);
  useEffect(() => {
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    void reload();
  }, [revision, reload]);
  useEffect(() => {
    const target = loadMoreTarget.current;
    if (!target || !cursor || loading || loadingMore || busy || pageError || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void reload(cursor);
    }, { rootMargin: "0px 0px 300px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, loading, loadingMore, busy, pageError, tab, reload]);
  useEffect(() => {
    if (fullScan) return; // 検索中の全件読み取りを画面復帰のたびに繰り返さない。
    const onFocus = () => { if (document.visibilityState === "visible") void reload(null, true); };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [reload, fullScan]);
  const pending = places.some((place) => place.extraction === "pending" && !place.deleted);
  useEffect(() => {
    if (!pending || fullScan) return;
    let count = 0;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void reload(null, true);
      if (++count >= 40) window.clearInterval(timer);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [pending, reload, fullScan]);

  const perform = useCallback(async (action: () => Promise<void>, inModal = false) => {
    if (locked.current) return false;
    locked.current = true; setBusy(true); setError(""); setModalError(""); setMessage("");
    try { await action(); if (active.current) onChanged?.(); return true; }
    catch (cause) {
      if (active.current) {
        setMessage("");
        (inModal ? setModalError : setError)(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "通信が途切れました。もう一度お試しください。");
      }
      return false;
    } finally { locked.current = false; if (active.current) setBusy(false); }
  }, [onChanged]);
  const registerUrl = useCallback(async (value: string, automatic = false) => {
    const parsed = createPlaceSchema.safeParse({ url: value });
    if (!parsed.success) { setSaveFailed(true); setError("お店や投稿のURL（https://...）を入力してください。"); sourceInput.current?.focus(); return; }
    setSaveFailed(false);
    const saved = await perform(async () => {
      if (automatic) setMessage("ログイン前に入力したURLを保存しています...");
      const result = await api<{ place: SavedPlace; duplicate: boolean; restored: boolean }>("", { method: "POST", body: JSON.stringify(parsed.data) });
      if (!active.current) return;
      setSavedPlace(result.place);
      setMessage(result.restored ? "ごみ箱からマイリストに戻しました。" : result.duplicate ? "このURLは登録済みです。保存済みのお店をご確認ください。" : automatic ? "ログイン前のURLを「行きたい」に保存しました。" : "「行きたい」に保存しました。");
      setUrl(""); onSaved();
      const destination = result.place.visitCount > 0 ? "visited" : "saved";
      clearConditions();
      if (tab !== destination) setTab(destination); else if (!searching) await reload();
    });
    if (active.current && !saved) setSaveFailed(true);
  }, [api, onSaved, perform, reload, tab, clearConditions, searching]);
  useEffect(() => {
    if (!draft || busy || attemptedDraft.current === draft) return;
    // 同じマウントでは一度だけ自動保存。失敗時はURLを保持して本人が再試行する。
    // 応答前の再読込でも、サーバーのURL重複チェックで保存記録は増えない。
    attemptedDraft.current = draft;
    void registerUrl(draft, true);
  }, [draft, busy, registerUrl]);
  async function action(place: SavedPlace, action: "restore" | "trash") {
    await perform(async () => {
      await api(`/${place.id}`, { method: "PATCH", body: JSON.stringify({ action }) });
      if (!active.current) return;
      setModal(null); setMessage(action === "trash" ? "ごみ箱へ移しました。30日間は元に戻せます。" : "マイリストに戻しました。");
      setSavedPlace(null);
      await reload();
    }, action === "trash");
  }
  function edit(place: SavedPlace) { setFields({ name: place.name, address: place.address, note: place.note, genre: isGenre(place.genre) ? place.genre : null }); setModalError(""); setModal({ mode: "edit", place }); }

  return <>
    <section className="place-register" id="add-place" aria-labelledby="register-title">
      <div className="register-heading"><span className="register-icon"><Link2 size={23} /></span><div><h2 id="register-title">気になる一軒を、残そう。</h2><p>お店や投稿のURLを貼るだけ。店名の入力はあとでも大丈夫。</p></div></div>
      <form onSubmit={(event) => { event.preventDefault(); void registerUrl(url); }} className="register-form" noValidate>
        <label className="sr-only" htmlFor="place-url">登録するお店や投稿のURL</label>
        <input ref={sourceInput} id="place-url" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" maxLength={2048} placeholder="https://..." value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} aria-describedby="register-help" />
        <button className="button button-dark" disabled={busy || !url.trim()} type="submit">{busy ? <LoaderCircle size={18} className="spinning" /> : <Plus size={18} />}行きたいに保存</button>
      </form>
      <p id="register-help" className="register-help"><LockKeyhole size={13} />保存した記録は、あなたにだけ表示されます。</p>
      <p className="register-support">店名・住所・ジャンルは、同じURLを保存する人の入力補助にも利用します。メモ・訪問記録・評価は非公開です。</p>
      <p className="register-support">同じURLの店舗情報があれば入力を補助します。対応ページでは店名・住所を自動で取得します。</p>
      <p className="places-message" role="status">{message}</p>
      {savedPlace && <button type="button" className="text-button collection-after-save" disabled={busy} onClick={() => setListsDialog({ place: savedPlace })}>保存したお店をリストに追加</button>}
      {error && <div className="places-error" role="alert">{error}{saveFailed && <p>URLは入力欄に残しています。</p>}<button type="button" className="text-button" disabled={loading || busy} onClick={() => { if (saveFailed) void registerUrl(url); else void reload(); }}>{saveFailed ? "保存を再試行" : "一覧を再読み込み"}</button></div>}
    </section>

    <section className="my-places-section" id="my-places" aria-labelledby="my-places-title">
      <div className="places-toolbar">
      <div className="member-section-heading"><div><p className="eyebrow section-eyebrow">YOUR LITTLE COLLECTION.</p><h2 id="my-places-title">あなたのマイリスト</h2></div><div className="places-toolbar-actions"><a className="places-add" href="#add-place" aria-label="お店を登録する" onClick={() => sourceInput.current?.focus()}><Plus size={20} /></a><button className="text-button trash-toggle" aria-label={tab === "trash" ? "マイリストに戻る" : "ごみ箱"} disabled={busy} onClick={() => setTab(tab === "trash" ? "saved" : "trash")}><Trash2 size={17} /><span>{tab === "trash" ? "マイリストに戻る" : "ごみ箱"}</span></button></div></div>
      <div className="collection-toolbar">
        <div><label htmlFor="place-list-filter">リスト</label><select id="place-list-filter" value={listFilter} disabled={busy} onFocus={() => void loadCollections()} onChange={event => setListFilter(event.target.value)}>
          <option value="all">すべてのお店</option><option value="unfiled">未分類</option>
          {collections.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select></div>
        <button type="button" className="button button-login" disabled={busy} onClick={() => setListsDialog({ place: null })}>リスト管理</button>
      </div>
      {collectionsError && <p className="places-error" role="alert">{collectionsError}<button type="button" className="text-button" onClick={() => void loadCollections()}>リストを再読み込み</button></p>}
      <form className="place-search" role="search" aria-label="マイリストを検索" onSubmit={event => {
        event.preventDefault(); const next = searchInput.trim();
        if (next === query) void reload(); else setQuery(next);
      }}>
        <div className="place-search-input"><Search size={18} aria-hidden="true" /><input type="search" aria-label="店名・住所・メモを検索" placeholder="店名・住所・メモを検索" value={searchInput} maxLength={100} disabled={busy} enterKeyHint="search" onChange={event => setSearchInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} /></div>
        <button type="submit" className="button button-dark" disabled={busy}>検索</button>
      </form>
      <div className="place-filters">
        <div><label htmlFor="place-genre-filter">ジャンル</label><select id="place-genre-filter" value={genreFilter} disabled={busy} onChange={event => { const value = event.target.value; if (value === "all" || value === "unset" || isGenre(value)) setGenreFilter(value); }}>
          <option value="all">すべてのジャンル</option><option value="unset">未設定</option>
          {genreGroups.map(group => <optgroup key={group.label} label={group.label}>{group.options.map(genre => <option key={genre} value={genre}>{genres[genre].label}</option>)}</optgroup>)}
        </select></div>
        <div><label htmlFor="place-sort">並べ替え</label><select id="place-sort" value={sort} disabled={busy} onChange={event => setSort(event.target.value === "name" ? "name" : "newest")}><option value="newest">登録が新しい順</option><option value="name">店名順</option></select></div>
      </div>
      {(searching || searchInput) && <div className="place-filter-summary"><p>{listFilter !== "all" && <span>{listFilter === "unfiled" ? "未分類" : collections.find(list => list.id === listFilter)?.name}</span>}{query && <span>「{query}」</span>}{genreFilter !== "all" && <span>{genreFilter === "unset" ? "ジャンル未設定" : genres[genreFilter].label}</span>}{sort === "name" && <span>店名順</span>}</p><button className="text-button" type="button" disabled={busy} onClick={clearConditions}>条件をクリア</button></div>}
      {tab !== "trash" ? <div className="place-tabs" role="tablist" aria-label="店舗の状態">
        <button disabled={busy} role="tab" id="saved-tab" aria-selected={tab === "saved"} aria-controls="places-panel" tabIndex={tab === "saved" ? 0 : -1} onClick={() => setTab("saved")} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "End"].includes(event.key)) { event.preventDefault(); setTab("visited"); document.getElementById("visited-tab")?.focus(); } }}><Bookmark size={18} />行きたい</button>
        <button disabled={busy} role="tab" id="visited-tab" aria-selected={tab === "visited"} aria-controls="places-panel" tabIndex={tab === "visited" ? 0 : -1} onClick={() => setTab("visited")} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) { event.preventDefault(); setTab("saved"); document.getElementById("saved-tab")?.focus(); } }}><Check size={18} />訪問済み</button>
      </div> : <p className="trash-description">ごみ箱に移してから30日間、元に戻せます。</p>}
      </div>
      <div role={tab === "trash" ? "region" : "tabpanel"} id="places-panel" aria-labelledby={tab === "trash" ? "my-places-title" : `${tab}-tab`} tabIndex={0} aria-busy={loading || loadingMore}>
        {loading && !places.length ? <p className="places-loading" role="status"><LoaderCircle size={20} className="spinning" />マイリストを読み込んでいます...</p>
          : filtered && !places.length && !error && !cursor ? <div className="places-search-empty" role="status"><Search size={28} aria-hidden="true" /><h3>条件に合うお店が見つかりませんでした。</h3><p>検索する言葉・ジャンル・リストを変えてお試しください。</p><button className="text-button" disabled={busy} onClick={clearConditions}>検索・絞り込みを解除</button></div>
          : !places.length && !error && !cursor ? <div className="places-empty"><div className="empty-illustration" aria-hidden="true"><span className="empty-circle" /><span className="empty-paper"><Coffee size={38} strokeWidth={1.3} /><i /><i /></span><span className="empty-pin"><Bookmark size={22} /></span></div><div className="empty-copy"><h3>{tab === "trash" ? "ごみ箱は空です。" : tab === "visited" ? "「行ってよかった」を、残そう。" : "最初の「行きたい」を、ここに。"}</h3><p>{tab === "trash" ? "削除した記録は、ここから元に戻せます。" : tab === "visited" ? "行きたいリストのお店から、訪問日や星の評価を残せます。" : "お店の公式サイトや、SNSで見つけた投稿。\n気になるURLから、リストをはじめましょう。"}</p>{tab === "visited" && <button className="text-button" onClick={() => setTab("saved")}>行きたいリストを見る</button>}{tab === "saved" && <a className="text-button" href="#add-place" onClick={() => sourceInput.current?.focus()}>URLを登録する<Plus size={16} /></a>}</div></div>
          : <div className="saved-place-grid">{places.map((place) => <article className="saved-place-card" data-tone={parseInt(place.id.slice(-4), 16) % 4} key={place.id} aria-label={place.name || `${place.sourceLabel}の保存URL`}>
            <div className="saved-place-top" data-genre={isGenre(place.genre) ? place.genre : undefined} data-genre-image={isGenre(place.genre) && genres[place.genre].image ? true : undefined}><PlaceArtwork id={place.id} genre={place.genre} /><span className="place-state">{place.deleted ? "ごみ箱" : place.visitCount > 0 ? "訪問済み" : place.extraction === "pending" ? "情報を取得中" : place.extraction === "ready" || place.name ? "行きたい" : "情報確認待ち"}</span><LockKeyhole size={14} aria-label="非公開" /></div>
            <GooglePlaceSummary place={place} api={api} />
            {place.latestVisit && <p className="place-visit-summary"><Star size={16} aria-hidden="true" /><span>{place.latestVisit.rating === null ? "未評価" : `${place.latestVisit.rating} / 5`}<small>直近の訪問 {place.latestVisit.visitedOn.replaceAll("-", "/")} · {place.visitCount}回訪問</small></span></p>}
            {place.note && <p className="place-note">{place.note}</p>}
            <div className="place-collections">
              {(place.listIds ?? []).filter(id => collections.some(list => list.id === id)).map(id => <span key={id}>{collections.find(list => list.id === id)!.name}</span>)}
              {!place.deleted && <button className="text-button" disabled={busy} onClick={() => setListsDialog({ place })}>リストを選ぶ</button>}
            </div>
            <div className="place-sources">{place.sourceUrls.map((source) => <a key={source} href={source} target="_blank" rel="noopener noreferrer" className="place-source"><span>{source === place.url ? place.sourceLabel : new URL(source).hostname}で見る<small>{source}</small></span><ExternalLink size={15} /></a>)}</div>
            <p className="place-date">{place.deleted ? `${new Date(place.deleteAt!).toLocaleDateString("ja-JP")}まで復元できます` : place.fetchedAt ? `店舗情報の取得: ${new Date(place.fetchedAt).toLocaleDateString("ja-JP")}` : `保存: ${new Date(place.createdAt).toLocaleDateString("ja-JP")}`}</p>
            <div className="place-visit-actions">{!place.deleted && <button className="button button-dark" disabled={busy} onClick={() => setVisitDialog({ place, mode: "add" })}><Check size={16} />{place.visitCount > 0 ? "再訪を記録" : "行ってきた"}</button>}{place.visitCount > 0 && <button className="text-button" disabled={busy} onClick={() => setVisitDialog({ place, mode: "history" })}>訪問履歴（{place.visitCount}）</button>}</div>
            <div className="place-actions">{place.deleted ? <button disabled={busy} onClick={() => void action(place, "restore")}><RotateCcw size={15} />元に戻す</button> : <>
              <button className={!place.name.trim() ? "place-edit-prominent" : undefined} disabled={busy} onClick={() => edit(place)}><Pencil size={15} />編集</button>
              <SharePlaceButton name={place.name} url={place.url} disabled={busy} />
              <button disabled={busy} aria-label={`${place.name || place.sourceLabel}をごみ箱へ移す`} onClick={() => { setModalError(""); setModal({ mode: "trash", place }); }}><Trash2 size={15} />削除</button>
            </>}</div>
          </article>)}</div>}
        {cursor && <div ref={loadMoreTarget} className="places-more" aria-label="リストの続き">
          {loadingMore ? <p className="places-loading" role="status"><LoaderCircle size={20} className="spinning" />続きを読み込んでいます...</p> : <>
            {pageError && <p className="places-error" role="alert">{pageError}</p>}
            <button className="button button-login" disabled={loading || busy} onClick={() => void reload(cursor)}>{pageError ? "続きを再読み込み" : "もっと見る"}</button>
          </>}
        </div>}
      </div>
    </section>

    {listsDialog && <PlaceListsDialog key={listsDialog.place?.id ?? "manage"} place={listsDialog.place} api={api}
      onClose={() => { setListsDialog(null); void reload(); }} onLists={receiveCollections}
      onBusy={value => { locked.current = value; setBusy(value); }}
      onSaved={() => { setMessage("所属リストを保存しました。"); onChanged?.(); }} />}
    {visitDialog && <VisitDialog key={visitDialog.place.id} place={visitDialog.place} initialMode={visitDialog.mode} api={api}
      onClose={() => setVisitDialog(null)} onBusy={setBusy} onChange={updated => {
        setVisitDialog(current => current ? { ...current, place: updated } : null);
        onChanged?.();
        const destination = updated.visitCount > 0 ? "visited" : "saved";
        if (tab !== destination) setTab(destination); else void reload();
      }} />}
    <Dialog open={Boolean(modal)} onOpenChange={(open) => { if (!open && !busy) setModal(null); }}>
      <DialogContent>
        <DialogTitle className="dialog-title">{modal?.mode === "edit" ? "お店の情報を編集" : "ごみ箱へ移しますか？"}</DialogTitle>
        <DialogDescription className="dialog-description">{modal?.mode === "edit" ? "すべて任意です。店名・住所・ジャンルは、同じURLを保存する人の入力補助にも使います。自分用メモは共有しません。本人の編集は自動取得で上書きされません。" : "30日間は元に戻せます。期間を過ぎると、この保存記録は削除されます。"}</DialogDescription>
        {modal?.mode === "edit" ? <form className="place-edit-form" onSubmit={(event) => { event.preventDefault(); void perform(async () => {
          // ジャンルを操作しなかった場合、未取得の値を本人の指定として固定しない。
          const { genre, ...details } = fields;
          await api(`/${modal.place.id}`, { method: "PATCH", body: JSON.stringify({ ...details, ...(genre !== (modal.place.genre ?? null) ? { genre } : {}) }) });
          if (!active.current) return; setModal(null); setMessage("変更を保存しました。"); await reload();
        }, true); }}>
          <label>店名<input value={fields.name} maxLength={120} onChange={(event) => setFields({ ...fields, name: event.target.value })} /></label>
          <label>住所<input value={fields.address} maxLength={300} onChange={(event) => setFields({ ...fields, address: event.target.value })} /></label>
          <div className="place-edit-field"><label htmlFor="place-genre">ジャンル</label><select id="place-genre" value={fields.genre ?? ""} disabled={busy} onChange={(event) => setFields({ ...fields, genre: isGenre(event.target.value) ? event.target.value : null })}>
            <option value="">未設定</option>
            {genreGroups.map(group => <optgroup key={group.label} label={group.label}>{group.options.map(genre => <option key={genre} value={genre}>{genres[genre].label}</option>)}</optgroup>)}
          </select></div>
          <label>自分用メモ<textarea rows={4} value={fields.note} maxLength={2000} placeholder="行ってみたい理由や、気になるメニューなど" onChange={(event) => setFields({ ...fields, note: event.target.value })} /></label>
          {modalError && <p className="auth-error" role="alert">{modalError}</p>}
          <button type="submit" className="button button-dark" disabled={busy}>{busy ? "保存しています..." : "変更を保存"}</button>
        </form> : <><p className="trash-place-name">{modal?.place.name || modal?.place.sourceLabel}</p>{modalError && <p className="auth-error" role="alert">{modalError}</p>}<div className="trash-confirm-actions"><button className="button button-login" disabled={busy} onClick={() => setModal(null)}>キャンセル</button><button className="button button-dark" disabled={busy} onClick={() => { if (modal) void action(modal.place, "trash"); }}>ごみ箱へ移す</button></div></>}
      </DialogContent>
    </Dialog>
  </>;
}
