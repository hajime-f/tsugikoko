"use client";

import { Link2, LoaderCircle, LockKeyhole } from "lucide-react";
import { useId } from "react";
import { useAuth } from "./auth-provider";
import { isProviderEnabled, providers } from "@/lib/auth/providers";
import { setPendingDraft } from "@/lib/auth/draft";

export function AuthPanel({ mode = "login", draftUrl = "" }: { mode?: "login" | "signup"; draftUrl?: string }) {
  const auth = useAuth();
  const consentId = useId();
  return <>
    {draftUrl && <div className="draft-url"><Link2 size={18} aria-hidden="true" /><span>{draftUrl}</span></div>}
    <p id={consentId} className="auth-consent">ログインにより、<a href="/terms" target="_blank" rel="noopener noreferrer">利用規約</a>に同意したものとみなします。新規登録も同様です。<a href="/privacy" target="_blank" rel="noopener noreferrer">プライバシーポリシー</a>もご確認ください。</p>
    <div className="provider-buttons" aria-busy={auth.busy}>
      {providers.map((provider) => {
        const enabled = isProviderEnabled(provider.id);
        return <button key={provider.id} className="provider-button" aria-describedby={consentId} disabled={!enabled || auth.busy || auth.loading}
          onClick={() => { setPendingDraft(draftUrl); void auth.login(provider.id); }}>
          <span className={`provider-mark provider-${provider.name.toLowerCase()}`} aria-hidden="true">{provider.mark}</span>
          <span>{provider.name}で{mode === "login" ? "ログイン" : "はじめる"}</span>
          {!enabled && <small>準備中</small>}
          {enabled && auth.busy && <LoaderCircle className="spinning" size={18} aria-label="認証中" />}
        </button>;
      })}
    </div>
    {auth.error && <p className="auth-error" role="alert">{auth.error}</p>}
    <p className="auth-guidance">初めての方は、選んだ方法でアカウントを作成します。登録済みの方は、以前と同じ方法を選んでください。</p>
    <p className="auth-guidance"><LockKeyhole size={14} aria-hidden="true" />別のログイン方法は、ログイン後の「アカウント」から追加できます。</p>
    <p className="auth-footnote"><a href="/data-deletion">データの削除</a></p>
    <p className="auth-footnote">認証に必要な名前・メールアドレス等をFirebaseに保存します。{draftUrl && "ログインが完了すると、このURLを非公開のマイリストに自動で保存します。"}</p>
  </>;
}
