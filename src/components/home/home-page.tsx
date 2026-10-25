"use client";

import { AnalyticsPrivacy } from "@/components/analytics/analytics-privacy";

import { HeroImage } from "@/components/ui/hero-image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bookmark, ChevronRight, Coffee, LoaderCircle, LockKeyhole, LogOut, MapPin, Plus } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isProviderEnabled, providers, type ProviderId } from "@/lib/auth/providers";
import { clearDraft, readDraft } from "@/lib/auth/draft";
import { RecommendationsSection, RecommendationSettings } from "@/components/recommendations/recommendations-section";
import { MilestoneNotice } from "@/components/home/milestone-notice";
import { PlacesSection } from "@/components/places/places-section";
import { ShareSiteSection } from "@/components/places/share-place-button";

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
  const [modal, setModal] = useState<"account" | "guide" | "recommendations" | "privacy" | null>(null);
  const [unlinkId, setUnlinkId] = useState<ProviderId | null>(null);
  const [pendingDraft, setPendingDraft] = useState<{ uid: string; url: string } | null>(null);
  const [accountNotice, setAccountNotice] = useState("");
  const [greeting, setGreeting] = useState("");
  const loggingOut = useRef(false);
  const [placesRevision, setPlacesRevision] = useState(0);
  const [recommendationsRevision, setRecommendationsRevision] = useState(0);
  const [milestoneRevision, setMilestoneRevision] = useState(0);
  const onPlacesChanged = useCallback(() => { setRecommendationsRevision(value => value + 1); setMilestoneRevision(value => value + 1); }, []);
  const onRecommendationSaved = useCallback(() => { setPlacesRevision(value => value + 1); setMilestoneRevision(value => value + 1); }, []);

  useEffect(() => {
    const updateGreeting = () => {
      const hour = new Date().getHours();
      setGreeting(hour >= 5 && hour < 11 ? "おはようございます" : hour >= 11 && hour < 18 ? "こんにちは" : "こんばんは");
    };
    updateGreeting();
    const timer = window.setInterval(updateGreeting, 60_000);
    document.addEventListener("visibilitychange", updateGreeting);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateGreeting);
    };
  }, []);

  useEffect(() => {
    if (!auth.loading && !auth.user) router.replace(loggingOut.current ? "/" : "/login");
  }, [auth.loading, auth.user, router]);
  const uid = auth.user?.uid;
  useEffect(() => { setPendingDraft(uid ? { uid, url: readDraft(uid) } : null); }, [uid]);
  const draft = pendingDraft?.uid === uid ? pendingDraft?.url ?? "" : "";
  const onSaved = useCallback(() => {
    if (uid) clearDraft(uid);
    setPendingDraft(null);
  }, [uid]);

  if (auth.loading || !auth.user) return <main className="auth-loading" aria-busy="true"><MapPin size={36} /><p role="status">ログイン状態を確認しています...</p>{auth.error && <p role="alert">{auth.error}</p>}</main>;
  const user = auth.user;
  const name = user.displayName?.trim() || "あなた";
  const initial = (user.displayName?.trim() || user.email || "T").slice(0, 1).toUpperCase();
  const photoURL = user.providerData.find((provider) => provider.providerId === "google.com")?.photoURL || user.photoURL || user.providerData.find(provider => provider.photoURL)?.photoURL || null;

  function openAccount() { auth.clearError(); setAccountNotice(""); setUnlinkId(null); setModal("account"); }

  return <div className="member-page">
    <a className="skip-link" href="#member-main">本文へ移動</a>
    <header className="member-header">
      <div className="member-header-inner">
        <a className="brand" href="/home" aria-label="ツギココ ホーム"><span className="brand-symbol"><MapPin size={28} strokeWidth={2.8} /></span><span>ツギ<span className="brand-accent">ココ.</span></span></a>
        <button className="account-trigger" onClick={openAccount} aria-label="アカウントを開く"><UserAvatar key={user.uid} photoURL={photoURL} initial={initial} /><span className="account-trigger-label">アカウント</span><ChevronRight size={16} /></button>
      </div>
    </header>
    <main className="member-main" id="member-main">
      <div className="home-greeting"><p><span className="status-dot" />{greeting && `${greeting}、`}{name}さん。</p><span className="private-badge"><LockKeyhole size={13} />あなた専用のホーム</span></div>
      <section className="member-hero" aria-labelledby="member-title">
        <div className="member-hero-copy"><p className="eyebrow section-eyebrow">MAKE ROOM FOR GOOD DAYS.</p><h1 id="member-title">次の「ここ」が、<br />楽しみになる。</h1><p>気になる一軒から、いつものお気に入りまで。<br />あなたの「行きたい」を、ここから。</p><a className="button button-dark" href="#add-place">お店を登録する<Plus size={18} /></a></div>
        <div className="member-hero-photo"><HeroImage /><span className="member-photo-note"><Coffee size={16} />次の週末、どこに行こう。</span></div>
      </section>

      <RecommendationsSection key={`recommendations-${user.uid}`} revision={recommendationsRevision} onSaved={onRecommendationSaved} onSettings={() => setModal("recommendations")} />
      <PlacesSection key={user.uid} draft={draft} onSaved={onSaved} revision={placesRevision} onChanged={onPlacesChanged} />
      <ShareSiteSection />
      <footer className="member-footer"><span>気になったら、ツギココ。</span><button onClick={openAccount}>アカウント設定<ArrowRight size={14} /></button></footer>
    </main>

    <MilestoneNotice key={`milestones-${user.uid}`} revision={milestoneRevision} />

    <Dialog open={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }}>
      <DialogContent>
        {modal === "account" ? <>
          <DialogTitle className="dialog-title">アカウント</DialogTitle><DialogDescription className="dialog-description">ログイン方法を、ひとつのアカウントに。追加すると、選んだサービスのアカウントと現在の登録情報を連携します。</DialogDescription>
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
          <h3 className="account-heading">おすすめ</h3><button className="text-button" onClick={() => setModal("recommendations")}>おすすめの利用方針・興味なしの管理<ChevronRight size={16} /></button>
          <h3 className="account-heading">プライバシー</h3><button className="text-button" onClick={() => setModal("privacy")}>利用状況の集計・アクセス解析<ChevronRight size={16} /></button>
          <p className="auth-footnote"><a href="/terms">利用規約</a>・<a href="/privacy">プライバシーポリシー</a>・<a href="/data-deletion">データの削除を依頼する</a></p>
          <button className="logout-button" disabled={auth.busy} onClick={async () => { loggingOut.current = true; if (await auth.logout()) router.replace("/"); else loggingOut.current = false; }}>{auth.busy ? <LoaderCircle size={18} className="spinning" /> : <LogOut size={18} />}ログアウト</button>
        </> : modal === "privacy" ? <>
          <DialogTitle className="dialog-title">利用状況の集計・アクセス解析</DialogTitle><DialogDescription className="dialog-description">サービス改善のために利用する情報と、アクセス解析の設定です。</DialogDescription>
          <AnalyticsPrivacy />
        </> : modal === "recommendations" ? <>
          <DialogTitle className="dialog-title">おすすめ設定</DialogTitle><DialogDescription className="dialog-description">探したいエリアと、表示しないお店を管理します。</DialogDescription>
          <RecommendationSettings onChanged={onPlacesChanged} />
        </> : <>
          <span className="modal-brand"><Bookmark size={28} /></span><DialogTitle className="dialog-title">「行きたい」を、忘れない。</DialogTitle><DialogDescription className="dialog-description">URLからはじまる、次のお出かけ。</DialogDescription>
          <ol className="home-guide"><li><span>01</span><div><h3>気になるお店を見つける</h3><p>お店のサイトやInstagram・Xで見つけたURLをコピー。</p></div></li><li><span>02</span><div><h3>URLを貼って、リストに残す</h3><p>店舗の情報を自動で取得。個人の記録は非公開から。</p></div></li><li><span>03</span><div><h3>行ってみたら、感想を残す</h3><p>星5段階の評価から、好みに合う次の一軒へ。</p></div></li></ol>
          <p className="feature-status">URLからの店舗登録、非公開のマイリスト、訪問記録・星5段階の評価をご利用いただけます。保存や評価の傾向から、おすすめのお店も探せます。</p>
        </>}
      </DialogContent>
    </Dialog>
  </div>;
}
