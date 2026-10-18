"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Trophy, X } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import type { MilestoneStatus } from "@/lib/milestones/schema";

export function MilestoneNotice({ revision }: { revision: number }) {
  const { user } = useAuth();
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const closed = useRef(0);
  const mounted = useRef(true);
  const locked = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const api = useCallback(async <T,>(threshold?: number): Promise<T> => {
    if (!user) throw new Error("ログインし直してください。");
    const token = await user.getIdToken();
    const response = await fetch("/api/milestones", {
      method: threshold === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(threshold === undefined ? {} : { body: JSON.stringify({ threshold }) }),
    });
    if (!response.ok) throw new Error("記録できませんでした。閉じるボタンでもう一度お試しください。");
    return response.json();
  }, [user]);

  useEffect(() => {
    const version = ++generation.current;
    void api<MilestoneStatus>().then(status => {
      if (version !== generation.current || !mounted.current) return;
      setPending(status.pending && status.pending > closed.current ? status.pending : null);
    }).catch(() => { /* お祝いの取得失敗で、店舗の保存や一覧を妨げない。 */ });
    return () => { generation.current++; };
  }, [api, revision]);

  async function close() {
    if (pending === null || locked.current) return;
    const threshold = pending;
    locked.current = true; setBusy(true); setError("");
    try {
      await api<{ ok: true }>(threshold);
      closed.current = Math.max(closed.current, threshold);
      if (mounted.current) setPending(current => current && current > threshold ? current : null);
    } catch {
      if (mounted.current) setError("記録できませんでした。閉じるボタンでもう一度お試しください。");
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (pending === null) return null;
  return <aside className="milestone-notice" aria-label="お店登録のお祝い">
    <span className="milestone-icon" aria-hidden="true"><Trophy size={24} /></span>
    <div role="status" aria-live="polite" aria-atomic="true">
      <h2>{pending >= 20 ? "素晴らしいです！" : "おめでとうございます！"}</h2>
      <p>お店の登録が{pending.toLocaleString("ja-JP")}件に達しました。</p>
      <small>{pending >= 20 ? "あなただけのリストが育っています。次のお出かけも楽しみですね。" : "気になる一軒が、次のお出かけの楽しみに。"}</small>
      {error && <p className="milestone-error">{error}</p>}
    </div>
    <button type="button" disabled={busy} onClick={() => void close()} aria-label="お祝いを閉じる">{busy ? <LoaderCircle size={20} className="spinning" /> : <X size={20} />}</button>
  </aside>;
}
