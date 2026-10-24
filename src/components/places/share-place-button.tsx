"use client";

import { useRef, useState } from "react";
import { Copy, Share2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SITE_URL } from "@/lib/site";

// 共有に使う項目だけを受け取り、メモ・評価・本人の識別情報は渡さない。
export function SharePlaceButton({ name, url, disabled = false, className }: {
  name: string; url: string; disabled?: boolean; className?: string;
}) {
  return <ShareButton text={name.trim() || "気になるお店"} url={url} disabled={disabled} className={className}
    label="共有" title="お店をSNSで共有"
    description="店名と店舗URLを共有します。メモ・訪問記録・評価は含みません。投稿は各SNSの画面で確認してください。" />;
}

export function ShareSiteSection() {
  return <aside className="site-share" aria-label="ツギココを紹介">
    <div><h2>ツギココを友だちに紹介</h2><p>行きたいお店を、いろいろな場所に保存している友だちへ。</p></div>
    <ShareButton text={"気になったら、ツギココ。\nSNSやグルメサイトで見つけた行きたいお店を、ひとつのマイリストに。"} url={SITE_URL}
      label="ツギココをSNSで紹介" title="ツギココをSNSで紹介" className="button button-login"
      description="紹介文とツギココのURLを共有します。投稿内容は各SNSの画面で編集・確認してから送信できます。" />
  </aside>;
}

function ShareButton({ text, url, label, title, description, disabled = false, className }: {
  text: string; url: string; label: string; title: string; description: string; disabled?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [nativeShare, setNativeShare] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const preview = `${text}\n${url}`;
  const params = new URLSearchParams({ text, url });

  async function copy() {
    try {
      await navigator.clipboard.writeText(preview);
      setMessage("投稿文をコピーしました。");
    } catch {
      setMessage("コピーできませんでした。投稿内容を長押し、または選択してコピーしてください。");
    }
  }

  async function share() {
    setBusy(true); setMessage("");
    try {
      await navigator.share({ text, url });
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setMessage("共有を開けませんでした。X・LINEのボタンやコピーをお試しください。");
      }
    } finally { setBusy(false); }
  }

  return <>
    <button ref={trigger} type="button" className={className} disabled={disabled} onClick={() => {
      setMessage(""); setNativeShare(typeof navigator.share === "function"); setOpen(true);
    }}><Share2 size={15} aria-hidden="true" />{label}</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="place-share-dialog" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
        <DialogTitle className="dialog-title">{title}</DialogTitle>
        <DialogDescription className="dialog-description">{description}</DialogDescription>
        <label className="share-preview">投稿内容<textarea readOnly rows={4} value={preview} onFocus={event => event.currentTarget.select()} /></label>
        <div className="share-destinations">
          <a className="button button-dark" href={`https://x.com/intent/tweet?${params}`} target="_blank" rel="noopener noreferrer">Xで投稿</a>
          <a className="button button-login" href={`https://social-plugins.line.me/lineit/share?${params}`} target="_blank" rel="noopener noreferrer">LINEで送る</a>
          {nativeShare && <button type="button" className="button button-login" disabled={busy} onClick={() => void share()}><Share2 size={17} />その他の共有</button>}
          <button type="button" className="button button-login" onClick={() => void copy()}><Copy size={17} />投稿文をコピー</button>
        </div>
        <p className="share-feedback" role="status">{message}</p>
      </DialogContent>
    </Dialog>
  </>;
}
