"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, LockKeyhole, Plus, Star } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { todayInJapan, visitFieldsSchema, type SavedPlace, type Visit, type VisitAction, type VisitList } from "@/lib/places/schema";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
export function VisitDialog({ place, initialMode, api, onClose, onChange, onBusy }: {
  place: SavedPlace; initialMode: "add" | "history"; api: Api;
  onClose: () => void; onChange: (place: SavedPlace) => void; onBusy: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState<"add" | "edit" | "history" | "delete">(initialMode);
  const [selected, setSelected] = useState<Visit | null>(null);
  const [fields, setFields] = useState({ visitedOn: todayInJapan(), rating: null as number | null, comment: "" });
  const [visitId, setVisitId] = useState(() => crypto.randomUUID());
  const [visits, setVisits] = useState<Visit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false), alive = useRef(true), readVersion = useRef(0);
  const [failedCursor, setFailedCursor] = useState<string | null>(null);
  const historyTarget = useRef<HTMLDivElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; readVersion.current++; }; }, []);
  const load = useCallback(async (next: string | null = null) => {
    const version = ++readVersion.current;
    setLoading(true); setError(""); setFailedCursor(next);
    try {
      const result = await api<VisitList>(`/${place.id}${next ? `?cursor=${encodeURIComponent(next)}` : ""}`);
      if (!alive.current || readVersion.current !== version) return;
      setVisits(current => next ? [...current, ...result.visits.filter(visit => !current.some(old => old.id === visit.id))] : result.visits);
      setCursor(result.nextCursor);
    } catch (cause) {
      if (alive.current && readVersion.current === version) setError(cause instanceof Error ? cause.message : "履歴を読み込めませんでした。");
    } finally { if (alive.current && readVersion.current === version) setLoading(false); }
  }, [api, place.id]);
  useEffect(() => {
    if (mode === "history") void load();
    return () => { readVersion.current++; };
  }, [mode, load]);
  useEffect(() => {
    const target = historyTarget.current;
    if (!target || mode !== "history" || !cursor || loading || error || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void load(cursor); }, { rootMargin: "100px" });
    observer.observe(target); return () => observer.disconnect();
  }, [mode, cursor, loading, error, load]);
  function startAdd() {
    setFields({ visitedOn: todayInJapan(), rating: null, comment: "" }); setVisitId(crypto.randomUUID());
    setSelected(null); setError(""); setNotice(""); setMode("add");
  }
  async function save(input: VisitAction) {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ place: SavedPlace }>(`/${place.id}`, { method: "PATCH", body: JSON.stringify(input) });
      if (!alive.current) return;
      onChange(result.place); setSelected(null); setMode("history");
      setNotice(input.action === "deleteVisit" ? "訪問記録を削除しました。" : "訪問記録を非公開で保存しました。");
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "通信が途切れました。入力を残しています。そのまま再試行できます。");
    } finally {
      lock.current = false; onBusy(false); if (alive.current) setBusy(false);
    }
  }
  const title = mode === "history" ? "訪問の記録" : mode === "edit" ? "訪問記録を編集" : mode === "delete" ? "訪問記録を削除しますか？" : "行ってきたを、残そう。";
  return <Dialog open onOpenChange={open => { if (!open && !lock.current) onClose(); }}>
    <DialogContent className="visit-dialog">
      <DialogTitle className="dialog-title">{title}</DialogTitle>
      <DialogDescription className="dialog-description">{place.name || `${place.sourceLabel}の気になるお店`}</DialogDescription>
      <p className="visit-private"><LockKeyhole size={14} />この記録は、あなたにだけ表示されます。</p>
      {notice && <p className="visit-notice" role="status">{notice}</p>}
      {mode === "add" || mode === "edit" ? <form className="place-edit-form" onSubmit={event => {
        event.preventDefault();
        const parsed = visitFieldsSchema.safeParse(fields);
        if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
        void save(mode === "edit" && selected
          ? { action: "editVisit", visitId: selected.id, updatedAt: selected.updatedAt, ...parsed.data }
          : { action: "addVisit", visitId, ...parsed.data });
      }}>
        <label>訪問日<input type="date" min="1900-01-01" max={todayInJapan()} required value={fields.visitedOn} disabled={busy} onChange={event => setFields({ ...fields, visitedOn: event.target.value })} /></label>
        <fieldset className="visit-rating" disabled={busy}>
          <legend>評価 <span>任意</span></legend>
          <div className="visit-stars">{[1, 2, 3, 4, 5].map(value => <label key={value} className={value <= (fields.rating ?? 0) ? "rated" : ""}>
            <input type="radio" name="rating" value={value} checked={fields.rating === value} aria-label={`${value}つ星`} onChange={() => setFields({ ...fields, rating: value })} />
            <Star size={30} aria-hidden="true" /><span className="sr-only">{value}つ星</span>
          </label>)}</div>
          <label className="visit-unrated"><input type="radio" name="rating" value="" checked={fields.rating === null} onChange={() => setFields({ ...fields, rating: null })} />未評価</label>
        </fieldset>
        <label>感想（任意）<textarea rows={3} maxLength={2000} disabled={busy} placeholder="おいしかった一皿や、また行きたい理由など" value={fields.comment} onChange={event => setFields({ ...fields, comment: event.target.value })} /></label>
        <p className="visit-hint">星だけでも保存できます。感想はあとから追記できます。非公開の保存・評価も、今後おすすめの計算に利用します。</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-dark" type="submit" disabled={busy}>{busy ? "保存しています..." : mode === "edit" ? "変更を保存" : "訪問を記録する"}</button>
        <button className="text-button" type="button" disabled={busy} onClick={() => { setError(""); setMode("history"); }}>履歴を見る</button>
      </form> : mode === "delete" && selected ? <div className="visit-delete">
        <p>{selected.visitedOn.replaceAll("-", "/")}の記録を削除します。この操作は取り消せません。最後の訪問記録を削除すると、お店は「行きたい」に戻ります。</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="trash-confirm-actions"><button className="button button-login" disabled={busy} onClick={() => { setError(""); setMode("history"); }}>キャンセル</button><button className="button button-dark" disabled={busy} onClick={() => void save({ action: "deleteVisit", visitId: selected.id, updatedAt: selected.updatedAt })}>この訪問記録を削除</button></div>
      </div> : <>
        {!place.deleted && <button className="button button-dark visit-add" onClick={startAdd}><Plus size={17} />もう一度の訪問を記録</button>}
        {!loading && !error && visits.length === 0 && <p className="visit-hint">訪問記録はまだありません。</p>}
        <ol className="visit-history">{visits.map(visit => <li key={visit.id}>
          <div className="visit-history-heading"><time dateTime={visit.visitedOn}><CalendarDays size={15} />{visit.visitedOn.replaceAll("-", "/")}</time><span className="visit-score"><Star size={15} aria-hidden="true" />{visit.rating === null ? "未評価" : `${visit.rating} / 5`}</span></div>
          {visit.comment && <p>{visit.comment}</p>}
          {!place.deleted && <div className="visit-history-actions"><button className="text-button" onClick={() => { setSelected(visit); setFields({ visitedOn: visit.visitedOn, rating: visit.rating, comment: visit.comment }); setError(""); setNotice(""); setMode("edit"); }}>記録を編集</button><button className="text-button" onClick={() => { setSelected(visit); setError(""); setNotice(""); setMode("delete"); }}>記録を削除</button></div>}
        </li>)}</ol>
        {loading && <p className="visit-hint" role="status">履歴を読み込んでいます...</p>}
        {error && <div className="auth-error" role="alert">{error}<button className="text-button" onClick={() => void load(failedCursor)}>履歴を再読み込み</button></div>}
        {cursor && <div ref={historyTarget} className="visit-more"><button className="button button-login" disabled={loading} onClick={() => void load(cursor)}>もっと履歴を見る</button></div>}
      </>}
    </DialogContent>
  </Dialog>;
}
