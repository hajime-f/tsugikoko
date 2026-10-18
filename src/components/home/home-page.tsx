"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bookmark, Check, ChevronRight, Coffee, Copy, House, Link2, LoaderCircle, LockKeyhole, LogOut, MapPin, Plus, Sparkles, UserRound, X } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isProviderEnabled, providers, type ProviderId } from "@/lib/auth/providers";
import { clearDraft, readDraft } from "@/lib/auth/draft";

function UserAvatar({ photoURL, initial }: { photoURL: string | null; initial: string }) {
  const [failedURL, setFailedURL] = useState<string | null>(null);
  return <span className="user-avatar">
    {photoURL && photoURL !== failedURL
      ? <img src={photoURL} alt="プロフィール写真" width={46} height={46} referrerPolicy="no-referrer" onError={() => setFailedURL(photoURL)} />
      : initial}
  </span>;
}

export function HomePage() {
  const auth = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<"saved" | "visited">("saved");
  const [modal, setModal] = useState<"account" | "guide" | null>(null);
  const [unlinkId, setUnlinkId] = useState<ProviderId | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [accountNotice, setAccountNotice] = useState("");
  const loggingOut = useRef(false);

  useEffect(() => {
    if (!auth.loading && !auth.user) router.replace(loggingOut.current ? "/" : "/login");
  }, [auth.loading, auth.user, router]);
  useEffect(() => { if (auth.user) setDraft(readDraft(auth.user.uid)); }, [auth.user]);

  if (auth.loading || !auth.user) return <main className="auth-loading" aria-busy="true"><MapPin size={36} /><p role="status">ログイン状態を確認しています...</p>{auth.error && <p role="alert">{auth.error}</p>}</main>;
  const user = auth.user;
  const name = user.displayName?.trim() || "あなた";
  const initial = (user.displayName?.trim() || user.email || "T").slice(0, 1).toUpperCase();
  const photoURL = user.providerData.find((provider) => provider.providerId === "google.com")?.photoURL || user.photoURL;

  function openAccount() { auth.clearError(); setAccountNotice(""); setUnlinkId(null); setModal("account"); }
  async function copyDraft() {
    try { await navigator.clipboard.writeText(draft); setNotice("URLをコピーしました。"); }
    catch { setNotice("コピーできませんでした。URLを長押ししてコピーしてください。"); }
  }

  return <div className="member-page">
    <a className="skip-link" href="#member-main">本文へ移動</a>
    <header className="member-header">
      <div className="member-header-inner">
        <a className="brand" href="/home" aria-label="ツギココ ホーム"><span className="brand-symbol"><MapPin size={28} strokeWidth={2.8} /></span><span>ツギ<span className="brand-accent">ココ.</span></span></a>
        <nav aria-label="メインナビゲーション" className="member-desktop-nav"><a href="#member-main" aria-current="page">ホーム</a><a href="#my-places">マイリスト</a><a href="#for-you">あなたへのおすすめ</a></nav>
        <button className="account-trigger" onClick={openAccount} aria-label="アカウントを開く"><UserAvatar key={user.uid} photoURL={photoURL} initial={initial} /><span className="account-trigger-label">アカウント</span><ChevronRight size={16} /></button>
      </div>
    </header>
    <main className="member-main" id="member-main">
      <div className="home-greeting"><p><span className="status-dot" />こんにちは、{name}さん。</p><span className="private-badge"><LockKeyhole size={13} />あなた専用のホーム</span></div>
      <section className="member-hero" aria-labelledby="member-title">
        <div className="member-hero-copy"><p className="eyebrow section-eyebrow">MAKE ROOM FOR GOOD DAYS.</p><h1 id="member-title">次の「ここ」が、<br />楽しみになる。</h1><p>気になる一軒から、いつものお気に入りまで。<br />あなたの「行きたい」を、ここから。</p><a className="button button-dark" href="#my-places">マイリストを見る<ArrowRight size={18} /></a></div>
        <div className="member-hero-photo"><Image src="/images/landing/brunch.webp" fill preload sizes="(max-width: 700px) 100vw, 45vw" alt="コーヒーと色とりどりの料理が並ぶブランチ" /><span className="member-photo-note"><Coffee size={16} />次の週末、どこに行こう。</span></div>
      </section>

      {draft && <section className="pending-draft" aria-label="ログイン前に入力したURL"><div className="draft-icon"><Link2 size={23} /></div><div className="pending-draft-body"><h2>入力したURLを引き継ぎました</h2><p className="draft-address">{draft}</p><p>このタブだけの下書きです。店舗登録はまだできません。ログアウトすると消去されます。</p><button className="text-button" onClick={() => void copyDraft()}><Copy size={15} />URLをコピー</button></div><button className="icon-button" aria-label="URLの下書きを削除" onClick={() => { clearDraft(user.uid); setDraft(""); setNotice("下書きを削除しました。"); }}><X size={19} /></button></section>}
      <p className="home-notice" role="status">{notice}</p>

      <section className="my-places-section" id="my-places" aria-labelledby="my-places-title">
        <div className="member-section-heading"><div><p className="eyebrow section-eyebrow">YOUR LITTLE COLLECTION.</p><h2 id="my-places-title">あなたのマイリスト</h2></div><span className="private-badge"><LockKeyhole size={13} />非公開からはじめよう</span></div>
        <div className="place-tabs" role="tablist" aria-label="店舗の状態">
          <button role="tab" id="saved-tab" aria-selected={tab === "saved"} aria-controls="places-panel" tabIndex={tab === "saved" ? 0 : -1} onClick={() => setTab("saved")} onKeyDown={(e) => { if (["ArrowRight", "ArrowLeft", "End"].includes(e.key)) { e.preventDefault(); setTab("visited"); document.getElementById("visited-tab")?.focus(); } }}><Bookmark size={18} />行きたい</button>
          <button role="tab" id="visited-tab" aria-selected={tab === "visited"} aria-controls="places-panel" tabIndex={tab === "visited" ? 0 : -1} onClick={() => setTab("visited")} onKeyDown={(e) => { if (["ArrowRight", "ArrowLeft", "Home"].includes(e.key)) { e.preventDefault(); setTab("saved"); document.getElementById("saved-tab")?.focus(); } }}><Check size={18} />訪問済み</button>
        </div>
        <div className="places-empty" role="tabpanel" id="places-panel" aria-labelledby={`${tab}-tab`} tabIndex={0}>
          <div className="empty-illustration" aria-hidden="true"><span className="empty-circle" /><span className="empty-paper"><Coffee size={38} strokeWidth={1.3} /><i /><i /></span><span className="empty-pin">{tab === "saved" ? <Bookmark size={22} /> : <Check size={22} />}</span></div>
          <div className="empty-copy"><span className="coming-label">COMING SOON</span><h3>{tab === "saved" ? "最初の「行きたい」を、ここに。" : "「行ってよかった」を、残そう。"}</h3><p>{tab === "saved" ? "気になるお店のURLから、自分だけのリストへ。\n店舗の登録・リスト表示機能を準備しています。" : "訪れたお店の思い出も、次に行きたい一軒も。\n訪問記録・星5段階の評価機能を準備しています。"}</p><button className="text-button" onClick={() => setModal("guide")}>ツギココの使い方<ArrowRight size={17} /></button></div>
        </div>
      </section>

      <section className="home-recommendation" id="for-you" aria-labelledby="for-you-title"><div className="recommendation-art" aria-hidden="true"><Bookmark size={24} /><span /><Sparkles size={34} /><span /><MapPin size={24} /></div><div><p className="eyebrow section-eyebrow">A LITTLE MORE YOU.</p><h2 id="for-you-title">あなたらしい一軒を、ここに。</h2><p>好みの近い人の「好き」から、新しいお店との出会いを。<br />あなたへのおすすめ機能は、ただいま準備中です。</p><span className="recommendation-privacy"><LockKeyhole size={13} />個人の非公開の記録が、ほかの人に見えることはありません。</span></div></section>
      <footer className="member-footer"><span>気になったら、ツギココ。</span><button onClick={openAccount}>アカウント設定<ArrowRight size={14} /></button></footer>
    </main>
    <nav className="member-bottom-nav" aria-label="モバイルナビゲーション"><a href="#member-main" aria-current="page"><House size={21} /><span>ホーム</span></a><a href="#my-places"><Bookmark size={21} /><span>マイリスト</span></a><a href="#for-you"><Sparkles size={21} /><span>おすすめ</span></a><button onClick={openAccount}><UserRound size={21} /><span>アカウント</span></button></nav>

    <Dialog open={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }}>
      <DialogContent>
        {modal === "account" ? <>
          <DialogTitle className="dialog-title">アカウント</DialogTitle><DialogDescription className="dialog-description">ログイン方法を、ひとつのアカウントに。</DialogDescription>
          <div className="account-profile"><UserAvatar key={user.uid} photoURL={photoURL} initial={initial} /><div><p>{user.displayName || "ツギココユーザー"}</p><span>{user.email || "メールアドレスの提供なし"}</span></div></div>
          <h3 className="account-heading">ログイン方法</h3>
          <div className="account-providers">{providers.map((provider) => {
            const linked = auth.providerIds.includes(provider.id);
            const enabled = isProviderEnabled(provider.id);
            return <div key={provider.id}><span className="provider-mark">{provider.mark}</span><span>{provider.name}<small>{linked ? "連携済み" : enabled ? "未連携" : "準備中"}</small></span><button disabled={auth.busy || (!linked && !enabled) || (linked && auth.providerIds.length < 2)} aria-label={`${provider.name}の連携を${linked ? "解除" : "追加"}`} onClick={async () => { auth.clearError(); setAccountNotice(""); if (linked) setUnlinkId(provider.id); else if (await auth.link(provider.id)) setAccountNotice(`${provider.name}を同じアカウントに追加しました。`); }}>{linked ? "解除" : <><Plus size={14} />追加</>}</button></div>;
          })}</div>
          <p className="auth-guidance">最後のログイン方法は解除できません。別のアカウントに登録された認証方法は、自動で統合しません。</p>
          {unlinkId && <div className="unlink-confirm"><p>{providers.find((p) => p.id === unlinkId)?.name}との連携を解除しますか？次回はほかの連携済みの方法でログインしてください。</p><div><button className="button button-login" disabled={auth.busy} onClick={() => setUnlinkId(null)}>キャンセル</button><button className="button button-dark" disabled={auth.busy} onClick={async () => { if (await auth.unlinkProvider(unlinkId)) { setUnlinkId(null); setAccountNotice("連携を解除しました。"); } }}>連携を解除する</button></div></div>}
          {accountNotice && <p className="account-notice" role="status">{accountNotice}</p>}
          {auth.error && <p className="auth-error" role="alert">{auth.error}</p>}
          <button className="logout-button" disabled={auth.busy} onClick={async () => { loggingOut.current = true; if (await auth.logout()) router.replace("/"); else loggingOut.current = false; }}>{auth.busy ? <LoaderCircle size={18} className="spinning" /> : <LogOut size={18} />}ログアウト</button>
        </> : <>
          <span className="modal-brand"><Bookmark size={28} /></span><DialogTitle className="dialog-title">「行きたい」を、忘れない。</DialogTitle><DialogDescription className="dialog-description">URLからはじまる、次のお出かけ。</DialogDescription>
          <ol className="home-guide"><li><span>01</span><div><h3>気になるお店を見つける</h3><p>お店のサイトやInstagram・Xで見つけたURLをコピー。</p></div></li><li><span>02</span><div><h3>URLを貼って、リストに残す</h3><p>店舗の情報を自動で取得。個人の記録は非公開から。</p></div></li><li><span>03</span><div><h3>行ってみたら、感想を残す</h3><p>星5段階の評価から、好みに合う次の一軒へ。</p></div></li></ol>
          <p className="feature-status">現在はアカウント登録・ログイン・ログアウトをご利用いただけます。上記の店舗登録・記録・おすすめ機能は準備中です。</p>
        </>}
      </DialogContent>
    </Dialog>
  </div>;
}
