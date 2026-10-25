"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MAX_PLACE_LISTS, type CollectionAction, type PlaceCollection, type SavedPlace } from "@/lib/places/schema";

type Api = <T>(path?: string, init?: RequestInit) => Promise<T>;
export function PlaceListsDialog({ place, api, onClose, onLists, onSaved, onBusy }: {
  place: SavedPlace | null; api: Api; onClose: () => void;
  onLists: (lists: PlaceCollection[]) => void; onSaved: () => void; onBusy: (busy: boolean) => void;
}) {
  const [lists, setLists] = useState<PlaceCollection[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [expected, setExpected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(true);
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<PlaceCollection | null>(null);
  const [deleting, setDeleting] = useState<PlaceCollection | null>(null);
  const lock = useRef(false), active = useRef(true);
  // 呼び出し元の描画によって、開いたダイアログの選択状態を再取得で上書きしない。
  const callbacks = useRef({ onLists, onSaved, onBusy });
  callbacks.current = { onLists, onSaved, onBusy };
  const placeId = place?.id;
  async function load() {
    if (lock.current) return;
    lock.current = true; setLoading(true); setError("");
    try {
      const result = await api<{ lists: PlaceCollection[]; listIds?: string[] }>(`/lists${placeId ? `?place=${placeId}` : ""}`);
      if (!active.current) return;
      setLists(result.lists); callbacks.current.onLists(result.lists);
      setSelected(result.listIds ?? []); setExpected(result.listIds ?? []);
      setNeedsReload(false);
      setEditing(null); setDeleting(null); setName("");
    } catch (cause) { if (active.current) { setNeedsReload(true); setError(cause instanceof Error ? cause.message : "リストを読み込めませんでした。"); } }
    finally { lock.current = false; if (active.current) setLoading(false); }
  }
  useEffect(() => {
    active.current = true; void load();
    return () => { active.current = false; };
    // ダイアログは対象ごとにマウントされる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function perform(work: () => Promise<void>, membership = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice(""); callbacks.current.onBusy(true);
    try { await work(); }
    catch (cause) {
      if (active.current) {
        if (membership && cause instanceof Error && "status" in cause && cause.status === 409) setNeedsReload(true);
        setError(cause instanceof Error ? cause.message : "保存できませんでした。もう一度お試しください。");
      }
    }
    finally { lock.current = false; if (active.current) setBusy(false); callbacks.current.onBusy(false); }
  }
  async function change(input: CollectionAction) {
    await perform(async () => {
      const result = await api<{ lists: PlaceCollection[]; list?: PlaceCollection }>("/lists", { method: "POST", body: JSON.stringify(input) });
      if (!active.current) return;
      setLists(result.lists); callbacks.current.onLists(result.lists);
      if (place && input.action === "create" && result.list) setSelected(ids => [...new Set([...ids, result.list!.id])]);
      setEditing(null); setDeleting(null); setName("");
      setNotice(input.action === "delete" ? "リストを削除しました。お店や訪問記録は残っています。" : input.action === "rename" ? "リスト名を変更しました。" : place ? "リストを用意しました。「所属を保存」でお店を追加できます。" : "リストを用意しました。");
    });
  }
  const disabled = busy || loading;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="place-lists-dialog">
      <DialogTitle className="dialog-title">{place ? "所属リストを選ぶ" : "リスト管理"}</DialogTitle>
      <DialogDescription className="dialog-description">{place ? `${place.name || `${place.sourceLabel}の気になるお店`}を入れるリストを選んでください。複数選べます。` : "目的別にお店をまとめられます。リストはあなたにだけ表示されます。"}</DialogDescription>
      {loading ? <p role="status">リストを読み込んでいます...</p> : <>
        {place ? <fieldset className="collection-choices" disabled={disabled}>
          <legend className="sr-only">所属するリスト</legend>
          {!lists.length && <p>リストはまだありません。下の欄から作成できます。</p>}
          {lists.map(list => <label key={list.id}><input type="checkbox" checked={selected.includes(list.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, list.id] : ids.filter(id => id !== list.id))} /><span>{list.name}</span></label>)}
        </fieldset> : <ul className="collection-manager">
          {!lists.length && <li>リストはまだありません。</li>}
          {lists.map(list => <li key={list.id}><span>{list.name}</span><div><button type="button" className="text-button" disabled={disabled} aria-label={`${list.name}の名前を変更`} onClick={() => { setEditing(list); setDeleting(null); setName(list.name); setError(""); setNotice(""); }}>名前変更</button><button type="button" className="text-button" disabled={disabled} aria-label={`${list.name}のリストを削除`} onClick={() => { setDeleting(list); setEditing(null); setName(""); setError(""); setNotice(""); }}>削除</button></div></li>)}
        </ul>}
        {deleting ? <div className="collection-delete" role="group" aria-label="リスト削除の確認">
          <p>「{deleting.name}」を削除しますか？</p><p>リストは元に戻せません。お店・メモ・訪問記録は残ります。</p>
          <div className="collection-buttons"><button className="button button-login" disabled={disabled} onClick={() => setDeleting(null)}>キャンセル</button><button className="button button-dark" disabled={disabled} onClick={() => void change({ action: "delete", id: deleting.id, updatedAt: deleting.updatedAt })}>リストを削除する</button></div>
        </div> : <form className="place-edit-form collection-create" onSubmit={event => { event.preventDefault(); void change(editing ? { action: "rename", id: editing.id, updatedAt: editing.updatedAt, name: name.trim() } : { action: "create", name: name.trim() }); }}>
          <label>{editing ? "新しいリスト名" : "新しいリストを作成"}<input value={name} maxLength={40} placeholder="例：京都旅行、仕事帰り" disabled={disabled || (!editing && lists.length >= MAX_PLACE_LISTS)} onChange={event => setName(event.target.value)} /></label>
          <div className="collection-buttons">{editing && <button type="button" className="button button-login" disabled={disabled} onClick={() => { setEditing(null); setName(""); }}>キャンセル</button>}<button type="submit" className="button button-login" disabled={disabled || !name.trim() || (!editing && lists.length >= MAX_PLACE_LISTS)}>{editing ? "名前を保存" : "リストを作成"}</button></div>
          {!editing && <p className="register-help">{lists.length} / {MAX_PLACE_LISTS}件。同じ名前のリストがある場合は既存のリストを使います。</p>}
        </form>}
      </>}
      {notice && <p className="places-message" role="status">{notice}</p>}
      {error && <div className="auth-error" role="alert"><p>{error}</p><button type="button" className="text-button" disabled={disabled} onClick={() => void load()}>リストを読み直す</button><p>読み直すと、保存前の選択は取り消されます。</p></div>}
      <div className="collection-buttons collection-footer">
        <button className="button button-login" disabled={busy} onClick={onClose}>{place ? "キャンセル" : "閉じる"}</button>
        {place && <button className="button button-dark" disabled={disabled || needsReload} onClick={() => void perform(async () => {
          await api(`/${place.id}`, { method: "PATCH", body: JSON.stringify({ action: "setLists", listIds: selected, expectedListIds: expected }) });
          if (active.current) { callbacks.current.onSaved(); onClose(); }
        }, true)}>{busy ? "保存しています..." : "所属を保存"}</button>}
      </div>
    </DialogContent>
  </Dialog>;
}
