import type { Metadata } from "next";
import { PrivacyDocument } from "@/components/privacy/privacy-document";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "データの削除 | ツギココ",
  description: "ツギココのアカウントと保存データの削除依頼、Facebook連携の解除について。",
  alternates: { canonical: "/data-deletion" },
  openGraph: { title: "データの削除 | ツギココ", url: "/data-deletion" },
};

export default function DataDeletionPage() {
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("ツギココのデータ削除依頼")}`;
  return <PrivacyDocument title="データの削除">
    <p>ツギココのアカウントと保存データの削除は、メールで受け付けています。このページはログインせずに利用できます。</p>
    <section><h2>削除を依頼する方法</h2>
      <ol>
        <li><a href={mailto}>{SUPPORT_EMAIL}</a> に、件名「ツギココのデータ削除依頼」でメールを送ってください。</li>
        <li>利用していたログイン方法（Google・X・Facebookなど）、登録メールアドレス、削除したい内容（アカウント全体、特定の情報など）を記載してください。登録メールアドレスが分からない・提供されていない場合は、その旨を記載してください。</li>
        <li>運営者から本人確認の方法をご案内します。登録メールアドレス宛の確認や、ログインしたアカウントでの確認を行います。パスワード、認証コード、アクセストークン、本人確認書類を最初のメールに添付する必要はありません。</li>
        <li>本人確認と削除範囲の確認が完了した後、原則30日以内を目安に対応し、完了をメールでご案内します。追加確認が必要な場合は、その理由と見込みをお知らせします。</li>
      </ol>
      <p><a className="button button-dark" href={mailto}>メールで削除を依頼する</a></p>
      <p>ログインできなくなった場合や、Facebook側ですでにアプリとの連携を解除した場合も、この窓口にご連絡ください。</p>
    </section>
    <section><h2>アカウント全体を削除する場合</h2>
      <p>ツギココの認証情報（連携サービスの識別子、名前、メールアドレス、プロフィール写真URL等）、保存した店舗・投稿の記録、ごみ箱、個人メモ、訪問履歴、評価・感想、地域設定、興味なしの設定、おすすめ用の本人にひも付くデータを削除します。複数のログイン方法を連携している場合も、同じツギココアカウント全体が対象です。</p>
      <p>削除完了後は元のリストを復元できません。同じSNSで再登録しても、新しいツギココアカウントになります。Facebook・Google・X自体のアカウントは削除されません。</p>
    </section>
    <section><h2>削除後に残ることがある情報</h2>
      <p>個人と結び付かない利用者数・保存件数の集計や、入力者との対応を持たない店舗の共通情報は残ることがあります。安全管理・障害調査のログやサービス基盤のバックアップは、保存期間が満了するまで残る場合があります。削除できない情報がある場合は理由を案内します。</p>
      <p>Google Analytics・Google広告などのブラウザー識別子は、ツギココのアカウントIDと結び付けて管理していません。ブラウザー内のデータ削除や計測停止については、<a href="/privacy">プライバシーポリシー</a>もご確認ください。</p>
    </section>
    <section><h2>Facebook連携だけを解除する場合</h2>
      <p>保存リストを残したままFacebookでのログインを止めるには、ツギココにログインし、「アカウント」で別のログイン方法を追加してから、Facebookの「解除」を選びます。最後のログイン方法は解除できません。</p>
      <p>連携解除は、ツギココの保存データやプロフィール情報をすべて削除する操作ではありません。Facebookから取得した情報の削除も希望する場合は、上記の窓口にその旨をご連絡ください。Facebook側の「アプリとウェブサイト」での削除だけでは、ツギココに保存済みのデータは自動削除されません。</p>
    </section>
  </PrivacyDocument>;
}
