"use client";

import { useRef, useState } from "react";
import { Copy, Share2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// 共有に使う項目だけを受け取り、メモ・評価・本人の識別情報は渡さない。
export function SharePlaceButton({ name, url, disabled = false, className }: {
  name: string; url: string; disabled?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [nativeShare, setNativeShare] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const text = name.trim() || "気になるお店";
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
    }}><Share2 size={15} aria-hidden="true" />共有</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="place-share-dialog" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
        <DialogTitle className="dialog-title">お店をSNSで共有</DialogTitle>
        <DialogDescription className="dialog-description">店名と店舗URLを共有します。メモ・訪問記録・評価は含みません。投稿は各SNSの画面で確認してください。</DialogDescription>
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
