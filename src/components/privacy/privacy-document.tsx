import type { ReactNode } from "react";
import { SITE_OPERATOR, SUPPORT_EMAIL } from "@/lib/site";

export function PrivacyDocument({ title, children, updatedAt = "2026年10月25日" }: { title: string; children: ReactNode; updatedAt?: string }) {
  return <div className="policy-page">
    <header className="policy-header"><a href="/" aria-label="ツギココ ホーム">ツギココ</a></header>
    <main className="policy-content">
      <h1>{title}</h1>
      <p className="policy-date">更新日：{updatedAt}</p>
      {children}
      <section><h2>お問い合わせ</h2><p>運営者：{SITE_OPERATOR}<br />連絡先：<a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p></section>
    </main>
    <footer className="policy-footer"><a href="/terms">利用規約</a><a href="/privacy">プライバシーポリシー</a><a href="/data-deletion">データの削除</a><a href="/">ツギココに戻る</a></footer>
  </div>;
}
