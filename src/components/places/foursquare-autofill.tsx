"use client";
import { useEffect, useRef, useState } from "react";
import type { FsqCandidate, FsqLookup } from "@/lib/places/foursquare";
import { genres } from "@/lib/places/genres";

type Props = { id: string; api: <T>(path: string, init?: RequestInit) => Promise<T>;
  onCandidate: (candidate: FsqCandidate, version: string) => boolean; onLoading: (loading: boolean) => void };
export function FoursquareAutofill({ id, api, onCandidate, onLoading }: Props) {
  const callbacks = useRef({ onCandidate, onLoading }); callbacks.current = { onCandidate, onLoading };
  const [result, setResult] = useState<FsqLookup | null>(null), [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let live = true; const controller = new AbortController();
    callbacks.current.onLoading(true);
    void api<FsqLookup>(`/${id}/foursquare`, { method: "POST", signal: controller.signal }).then(found => {
      if (!live) return;
      setResult(found);
      if (found.automatic && found.candidates.length === 1) {
        if (callbacks.current.onCandidate(found.candidates[0], found.version)) setSelected(found.candidates[0].id);
      }
    }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : "店舗候補を取得できませんでした。手入力で保存できます。"); })
      .finally(() => { if (live) callbacks.current.onLoading(false); });
    return () => { live = false; controller.abort(); callbacks.current.onLoading(false); };
  }, [id, api]);
  if (result && !result.enabled) return null;
  return <div className="fsq-autofill" aria-label="店舗情報の入力補助">
    {!result && !error && <p role="status">店名・住所・ジャンルの候補を確認しています。</p>}
    {error && <p role="status">{error}</p>}
    {result?.enabled && <>
      <p>{selected ? "候補から空欄へ入力しました。店名・住所を確認して保存してください。" : result.candidates.length ? "同じお店か確認して、入力する候補を選んでください。" : "このリンクに対応する候補が見つかりませんでした。手入力で保存できます。"}</p>
      {result.candidates.map(candidate => <div className="fsq-candidate" key={candidate.id}>
        <p>{candidate.name}</p><p>{candidate.address}</p>
        {candidate.genre && <p>{genres[candidate.genre].label}</p>}
        {candidate.warnings.map(warning => <p className="fsq-warning" key={warning}>{warning}</p>)}
        {!selected && <button type="button" className="text-button" onClick={() => {
          if (callbacks.current.onCandidate(candidate, result.version)) setSelected(candidate.id);
        }}>このお店の情報を入力</button>}
      </div>)}
      {result.more && <p>ほかにも候補があります。該当するお店がなければ手入力してください。</p>}
      <small>情報提供：<a href="/licenses/foursquare-NOTICE.txt" target="_blank" rel="noopener noreferrer">Foursquare OS Places</a>。収録地域や情報の更新状況により、候補がない場合があります。</small>
    </>}
  </div>;
}
