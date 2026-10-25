"use client";

import { AnalyticsPrivacy } from "@/components/analytics/analytics-privacy";
import { ShareSiteSection } from "@/components/places/share-place-button";

import { HeroImage } from "@/components/ui/hero-image";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowRight,
  Bookmark,
  Check,
  Coffee,
  Compass,
  Link2,
  LockKeyhole,
  MapPin,
  Menu,
  Plus,
  Sparkles,
  Utensils,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { AuthPanel } from "@/components/auth/auth-panel";
import { validPlaceUrl } from "@/lib/auth/draft";

type Modal = "login" | "signup" | "privacy" | "credits" | null;

const scenes = [
  {
    label: "CAFE",
    title: "ひと息つきたい、あのカフェ。",
    description: "タイムラインで見つけた一杯を、次の休日に。",
    image: "/images/landing/coffee-provided.webp",
    width: 800, height: 532,
    alt: "木のテーブルに置かれた白いカップのコーヒー",
    tag: "カフェ・コーヒー",
    icon: Coffee,
  },
  {
    label: "LUNCH",
    title: "いつもの街で、新しい一皿。",
    description: "通りすがりの気になるお店も、忘れずに。",
    image: "/images/landing/salad-provided.webp",
    width: 800, height: 533,
    alt: "レタスやトマト、にんじんを盛り付けたサラダ",
    tag: "ランチ・ごはん",
    icon: Utensils,
  },
  {
    label: "WEEKEND",
    title: "誰かを誘いたくなる、週末。",
    description: "「今度ここ行こう」が、楽しみな予定になる。",
    image: "/images/landing/weekend-provided.webp",
    width: 640, height: 480,
    alt: "ハンバーガーとポテトを囲む食事のテーブル",
    tag: "食事・お出かけ",
    icon: Compass,
  },
];

const faqs = [
  {
    question: "どんなお店を登録できますか？",
    answer: "飲食店とカフェが対象です。お店の公式サイトや紹介ページに加え、Instagram・Xの投稿URLからの登録を予定しています。情報を取得できないときも、URLを残しておける設計です。",
  },
  {
    question: "保存したお店は、ほかの人に見えますか？",
    answer: "あなたの記録は、はじめは非公開です。レビューやリストは、自分で選んだものだけ公開できます。非公開の保存・評価もおすすめの計算に利用しますが、誰が何を保存・評価したかをほかの人に表示することはありません。店名・住所・ジャンルは、同じURLを保存する人の入力補助にも利用します。",
  },
  {
    question: "お店の予約もできますか？",
    answer: "ツギココは「行きたいお店」を残して、見つけるためのサービスです。予約機能はありません。予約が必要なときは、お店の公式サイトなどをご利用ください。",
  },
  {
    question: "今すぐ使えますか？",
    answer: "Googleアカウントで登録・ログインし、お店を非公開のマイリストに保存できます。ログイン前にURLを入力して「保存してはじめる」を押すと、ログイン完了後に自動で保存します。保存や評価の傾向を使ったおすすめも利用できます。候補が十分に集まるまでは表示されない場合があります。",
  },
];

function Brand({ light = false }: { light?: boolean }) {
  return (
    <span className={`brand${light ? " brand-light" : ""}`}>
      <span className="brand-symbol"><MapPin size={29} strokeWidth={2.8} aria-hidden="true" /></span>
      <span>ツギ<span className="brand-accent">ココ</span><span className="brand-dot">.</span></span>
    </span>
  );
}

export function LandingPage() {
  const auth = useAuth();
  const router = useRouter();
  useEffect(() => { if (!auth.loading && auth.user) router.replace("/home"); }, [auth.loading, auth.user, router]);
  const [modal, setModal] = useState<Modal>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [demoSaved, setDemoSaved] = useState(false);

  function openAuth(mode: "login" | "signup") {
    auth.clearError();
    setDraftUrl("");
    setMenuOpen(false);
    setModal(mode);
  }

  function submitUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = url.trim();
    if (!value) {
      setError("気になるお店や投稿のURLを入力してください。");
      return;
    }
    try {
      const parsed = validPlaceUrl(value);
      if (!parsed) throw new Error();
      setError("");
      setDraftUrl(parsed);
      setModal("signup");
    } catch {
      setError("https:// または http:// で始まるURLを入力してください。");
    }
  }

  return (
    <>
      <a className="skip-link" href="#main">本文へ移動</a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand-link" href="#" aria-label="ツギココ ホーム"><Brand /></a>
          <nav className="desktop-nav" aria-label="メインナビゲーション">
            <a href="#about">ツギココとは</a>
            <a href="#how-it-works">使い方</a>
          </nav>
          <div className="header-actions">
            <button className="button button-login" onClick={() => openAuth("login")}>ログイン</button>
            <button className="button button-dark header-signup" onClick={() => openAuth("signup")}>はじめる<ArrowRight size={17} aria-hidden="true" /></button>
            <button className="icon-button mobile-menu-trigger" aria-label="メニューを開く" onClick={() => setMenuOpen(true)}><Menu size={24} aria-hidden="true" /></button>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-photo">
            <HeroImage className="hero-image" />
            <div className="photo-note"><span className="photo-note-icon"><Bookmark size={18} aria-hidden="true" /></span><span>次の楽しみを、ひとつ。</span></div>
          </div>
          <div className="hero-inner">
            <div className="hero-copy">
              <p className="eyebrow"><span className="eyebrow-line" />「行きたい」を、忘れない。</p>
              <h1 id="hero-title">気になったら、<br /><span>ツギココ</span><span className="heading-period">。</span></h1>
              <p className="hero-description">SNSで見かけたお店も、<br className="mobile-break" />通りすがりに気になったお店も。<br />残しておけば、次のお出かけが楽しみに。</p>
              <form className="url-form" onSubmit={submitUrl} noValidate>
                <label className={`url-field${error ? " has-error" : ""}`} htmlFor="place-url">
                  <Link2 size={22} aria-hidden="true" />
                  <span className="sr-only">気になるお店や投稿のURL</span>
                  <input id="place-url" name="url" type="url" inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck={false} placeholder="気になるお店のURLを貼り付け" value={url} onChange={(event) => { setUrl(event.target.value); if (error) setError(""); }} aria-invalid={Boolean(error)} aria-describedby={error ? "url-error" : "url-hint"} />
                </label>
                <button className="button button-dark url-submit" type="submit">保存してはじめる<ArrowRight size={18} aria-hidden="true" /></button>
              </form>
              {error && <p className="form-error" id="url-error" role="alert">{error}</p>}
              <p className="url-hint" id="url-hint">Instagram・X・お店のサイトから。<span>URLひとつで、ツギココに。</span></p>
              <a className="hero-more" href="#how-it-works">使い方を見る<ArrowDown size={16} aria-hidden="true" /></a>
            </div>
          </div>
          <span className="hero-index" aria-hidden="true">YOUR NEXT GOOD PLACE.</span>
        </section>

        <div className="benefit-strip">
          <div><Link2 aria-hidden="true" size={19} /><span>URLで、かんたんに記録</span></div>
          <div><LockKeyhole aria-hidden="true" size={18} /><span>あなたの記録は、非公開から</span></div>
          <div><Sparkles aria-hidden="true" size={19} /><span>好みの近い人から、新しい発見</span></div>
        </div>

        <section className="section discover-section" id="about" aria-labelledby="discover-title">
          <div className="section-heading">
            <div><p className="eyebrow section-eyebrow">GOOD FOOD. GOOD DAYS.</p><h2 id="discover-title">次の「ここ」がある毎日。</h2></div>
            <p className="section-intro">なんでもない日も、特別な日も。<br />行きたいお店があるだけで、ちょっと楽しみになる。</p>
          </div>
          <div className="scene-grid">
            {scenes.map((scene) => (
              <article className="scene" key={scene.label}>
                <div className="scene-photo">
                  <picture>
                    <source type="image/avif" srcSet={scene.image.replace(/\.webp$/, ".avif")} />
                    <img src={scene.image} alt={scene.alt} width={scene.width} height={scene.height} className="top-photo" loading="lazy" decoding="async" />
                  </picture>
                  <span className="scene-tag"><scene.icon size={14} aria-hidden="true" />{scene.tag}</span>
                  <button className="scene-bookmark" aria-label={`${scene.tag}の行きたいリストをつくる`} onClick={() => openAuth("signup")}><Bookmark size={19} aria-hidden="true" /></button>
                </div>
                <div className="scene-text"><span className="scene-label">{scene.label}</span><h3>{scene.title}</h3><p>{scene.description}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className="how-section" id="how-it-works" aria-labelledby="how-title">
          <div className="section how-grid">
            <div className="how-copy">
              <p className="eyebrow section-eyebrow">LESS TYPING, MORE DISCOVERING.</p>
              <h2 id="how-title">見つけた、そのときに。<br />あとは、ツギココに。</h2>
              <p className="how-description">スクリーンショットに埋もれていた「あのお店」を、<br className="desktop-break" />あなたの行きたいリストへ。</p>
              <ol className="steps">
                <li><span className="step-number">01</span><div><h3>気になるお店のURLをコピー</h3><p>SNSの投稿も、お店のホームページも。</p></div></li>
                <li><span className="step-number">02</span><div><h3>ツギココに貼って、保存</h3><p>お店の情報を自動で取得。細かい入力は不要です。</p></div></li>
                <li><span className="step-number">03</span><div><h3>次のお出かけで、行ってみる</h3><p>近くのお店や気分に合う一軒が、すぐ見つかる。</p></div></li>
              </ol>
              <p className="small-note">取得できない情報は、URLだけでも残せます。</p>
            </div>
            <div className="demo-stage">
              <span className="demo-label">保存のイメージ</span>
              <div className="demo-window">
                <div className="demo-toolbar"><span className="mini-brand">ツギココ<span>.</span></span><span className="demo-badge">DEMO</span></div>
                <div className="demo-url"><Link2 size={17} aria-hidden="true" /><span>気になるカフェのURL</span><Check size={17} aria-hidden="true" /></div>
                <div className="demo-card-photo"><picture><source type="image/avif" srcSet="/images/landing/coffee-provided.avif" /><img src="/images/landing/coffee-provided.webp" alt="保存画面のイメージに使うコーヒーの写真" width={800} height={532} className="top-photo" loading="lazy" decoding="async" /></picture></div>
                <div className="demo-card-body">
                  <p className="demo-category"><Coffee size={13} aria-hidden="true" />カフェ・コーヒー</p>
                  <h3>週末に行きたい、あのカフェ</h3>
                  <p className="demo-caption">お店の情報が、ひとつのカードに。</p>
                  <button className={`demo-save${demoSaved ? " is-saved" : ""}`} onClick={() => setDemoSaved(!demoSaved)} aria-pressed={demoSaved}>{demoSaved ? <Check size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}{demoSaved ? "行きたいリストに追加済み" : "「行きたい」に追加してみる"}</button>
                </div>
              </div>
              <p className="demo-status" aria-live="polite">{demoSaved ? "保存できました。もう一度押すと元に戻ります。" : "ボタンを押して、保存の操作を体験できます。"}</p>
            </div>
          </div>
        </section>

        <section className="section recommendation-section" aria-labelledby="recommendation-title">
          <div className="recommendation-symbol" aria-hidden="true"><Bookmark size={27} /><span className="connection-dots" /><Sparkles size={33} /><span className="connection-dots" /><MapPin size={29} /></div>
          <p className="eyebrow section-eyebrow">YOUR TASTE, NEW PLACES.</p>
          <h2 id="recommendation-title">あなたの「好き」が、<br className="mobile-break" />次の「行きたい」に。</h2>
          <p>好みの近い人が見つけたお店から、あなたに合う一軒を。<br className="desktop-break" />自分だけでは見つけられなかった、新しいおいしさに出会えます。</p>
          <button className="text-button" onClick={() => openAuth("signup")}>自分だけのリストをつくる<ArrowRight size={19} aria-hidden="true" /></button>
          <div className="privacy-note"><LockKeyhole size={15} aria-hidden="true" /><span>記録は非公開から。公開するのは、自分で選んだものだけ。</span></div>
        </section>

        <section className="section faq-section" aria-labelledby="faq-title">
          <div><p className="eyebrow section-eyebrow">A FEW THINGS TO KNOW.</p><h2 id="faq-title">よくある質問</h2></div>
          <div className="faq-list">{faqs.map((faq) => <details key={faq.question}><summary>{faq.question}<Plus size={20} aria-hidden="true" /></summary><p>{faq.answer}</p></details>)}</div>
        </section>

        <section className="final-cta">
          <div className="section final-cta-inner"><div><p>次の休日、どこに行こう。</p><h2>その答えを、ツギココに。</h2></div><button className="button button-dark" onClick={() => openAuth("signup")}>行きたいリストをつくる<ArrowRight size={19} aria-hidden="true" /></button></div>
        </section>
        <div className="section"><ShareSiteSection /></div>
      </main>

      <footer className="site-footer">
        <div className="section footer-inner"><div><a href="#" aria-label="ツギココ ホーム"><Brand /></a><p className="footer-tagline">気になったら、ツギココ</p></div><nav aria-label="フッターナビゲーション"><a href="#how-it-works">使い方</a><a href="#faq-title">よくある質問</a><button onClick={() => setModal("privacy")}>プライバシーについて</button><a href="/terms">利用規約</a><a href="/privacy">プライバシーポリシー</a><a href="/data-deletion">データの削除</a><button onClick={() => setModal("credits")}>写真のクレジット</button></nav></div>
        <div className="section footer-bottom"><span>© {new Date().getFullYear()} ツギココ</span><span className="preview-label"><span />プレビュー版</span></div>
      </footer>

      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent className="menu-dialog">
          <DialogTitle className="sr-only">メニュー</DialogTitle><DialogDescription className="sr-only">ツギココのページメニュー</DialogDescription>
          <Brand /><nav aria-label="モバイルナビゲーション"><a href="#about" onClick={() => setMenuOpen(false)}>ツギココとは<ArrowRight size={20} /></a><a href="#how-it-works" onClick={() => setMenuOpen(false)}>使い方<ArrowRight size={20} /></a><a href="#faq-title" onClick={() => setMenuOpen(false)}>よくある質問<ArrowRight size={20} /></a></nav>
          <button className="button button-dark" onClick={() => openAuth("signup")}>はじめる<ArrowRight size={18} aria-hidden="true" /></button>
        </DialogContent>
      </Dialog>

      <Dialog open={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }}>
        <DialogContent>
          {(modal === "login" || modal === "signup") && <>
            <span className="modal-brand"><MapPin size={30} aria-hidden="true" /></span>
            <DialogTitle className="dialog-title">{modal === "login" ? "おかえりなさい。" : "次の「行きたい」を、残そう。"}</DialogTitle>
            <DialogDescription className="dialog-description">{modal === "login" ? "あなたの行きたいリストへ。" : "いつものアカウントで、ツギココをはじめる。"}</DialogDescription>
            <AuthPanel mode={modal} draftUrl={draftUrl} />
          </>}
          {modal === "privacy" && <>
            <DialogTitle className="dialog-title">プライバシーについて</DialogTitle>
            <DialogDescription className="dialog-description">あなたの「行きたい」を、大切に扱います。</DialogDescription>
            <div className="dialog-prose"><p>個人の記録は、原則として非公開です。レビューやリストは、自分で選んだものだけ公開する設計です。</p><p>非公開の保存・評価もおすすめの計算に利用しますが、個人のメモ・訪問記録・評価明細をほかの人に表示しません。</p><p>店名・住所・ジャンルは、同じURLを保存する人の入力補助にも利用します。誰が保存・入力したかは表示しません。</p><p>ログイン時に、認証に必要な名前・メールアドレス等をFirebase Authenticationに保存します。「保存してはじめる」で入力したURLはログイン完了後にサーバーへ保存し、本人だけが見られるマイリストに追加します。保存デモは画面内のみで動作し、位置情報も取得しません。</p></div>
            <AnalyticsPrivacy />
          </>}
          {modal === "credits" && <>
            <DialogTitle className="dialog-title">写真のクレジット</DialogTitle>
            <p className="auth-footnote">トップ画像: ご提供のShutterstock画像（646209796）</p>
            <DialogDescription className="dialog-description">写真はサイトの利用イメージです。掲載店舗や実際のおすすめを示すものではありません。</DialogDescription>
            <p className="auth-footnote">「次の『ここ』がある毎日。」のコーヒー・サラダ・食事の写真は、ご提供画像を使用しています。</p>
            <p className="auth-footnote">保存デモのコーヒーも、同じご提供画像を使用しています。</p>
          </>}
        </DialogContent>
      </Dialog>
    </>
  );
}
