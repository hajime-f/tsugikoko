"use client";

import { useRef, useState } from "react";
import { useAuth } from "./auth-provider";
import { isProviderEnabled, providers } from "@/lib/auth/providers";
import { SUPPORT_EMAIL } from "@/lib/site";

export function AccountDeletionPanel({ onAccepted, onCancel }: { onAccepted: () => Promise<void>; onCancel: () => void }) {
  const auth = useAuth();
  const [verifiedUid, setVerifiedUid] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const inProgress = useRef(false);
  const verified = Boolean(auth.user && verifiedUid === auth.user.uid);
  const available = providers.filter(provider => auth.providerIds.includes(provider.id) && isProviderEnabled(provider.id));

  async function submit() {
    if (inProgress.current || !verified || !confirmation || !auth.user) return;
    inProgress.current = true; setSending(true); setError("");
    try {
      const token = await auth.user.getIdToken(true);
      const response = await fetch("/api/account/deletion", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "delete-account" }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        setError(data.error || "退会を受け付けられませんでした。時間をおいて再試行してください。");
        if (response.status === 401) { setVerifiedUid(null); setConfirmation(false); }
        return;
      }
      await onAccepted();
    } catch {
      setError(`受付結果を確認できませんでした。再試行できない場合は ${SUPPORT_EMAIL} へお問い合わせください。`);
    } finally { inProgress.current = false; setSending(false); }
  }

  return <div className="account-deletion">
    <p>退会すると、ツギココのアカウントと次のデータを削除します。</p>
    <ul><li>保存リストとごみ箱、個人メモ</li><li>訪問履歴、評価・感想、地域やおすすめの設定</li><li>すべてのログイン方法の連携情報とプロフィール</li></ul>
    <p>削除後は復元できません。Google・X・Facebook自体のアカウントは削除されません。</p>
    <p>受付後はログアウトし、数分後から順次削除します。処理が混み合う場合や再試行が必要な場合は時間がかかります。ブラウザーを閉じても処理は続き、受付後の取り消しはできません。</p>
    <p><a href="/data-deletion" target="_blank" rel="noopener noreferrer">削除対象と、削除後に残る情報を確認する</a></p>
    {!verified ? <>
      <h3 className="account-heading">1. 本人確認</h3>
      <p>現在ログインしているアカウントで、もう一度認証してください。この操作だけでは退会しません。</p>
      <div className="provider-buttons">{available.map(provider => <button type="button" className="provider-button" key={provider.id} disabled={auth.busy || sending} onClick={async () => {
        setError("");
        if (await auth.reauthenticate(provider.id)) { setVerifiedUid(auth.user?.uid ?? null); setConfirmation(false); }
      }}>{provider.name}で本人確認</button>)}</div>
      {!available.length && <p>本人確認に使えるログイン方法がありません。<a href="/data-deletion">メールで削除を依頼</a>してください。</p>}
    </> : <>
      <h3 className="account-heading">2. 退会の最終確認</h3>
      <p role="status">本人確認が完了しました。</p>
      <label className="deletion-confirmation"><input type="checkbox" checked={confirmation} disabled={sending} onChange={event => setConfirmation(event.target.checked)} />保存データが削除され、元に戻せないことを理解しました</label>
      <button type="button" className="button deletion-submit" disabled={!confirmation || sending || auth.busy} onClick={submit}>{sending ? "退会を受け付けています…" : "退会してデータを削除する"}</button>
    </>}
    {(error || auth.error) && <p className="auth-error" role="alert">{error || auth.error}</p>}
    <button type="button" className="button button-login" disabled={sending || auth.busy} onClick={onCancel}>退会せずに戻る</button>
  </div>;
}
