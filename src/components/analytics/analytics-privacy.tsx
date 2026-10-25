"use client";

import { useEffect, useState } from "react";
import { ANALYTICS_PREFERENCE_EVENT, ANALYTICS_PREFERENCE_KEY, analyticsConfigured, analyticsDisabled, setAnalyticsDisabled } from "@/lib/analytics";

export function AnalyticsPrivacy() {
  const [disabled, setDisabled] = useState(true);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const update = () => setDisabled(analyticsDisabled());
    const storage = (event: StorageEvent) => { if (event.key === ANALYTICS_PREFERENCE_KEY || event.key === null) update(); };
    update();
    window.addEventListener(ANALYTICS_PREFERENCE_EVENT, update);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(ANALYTICS_PREFERENCE_EVENT, update);
      window.removeEventListener("storage", storage);
    };
  }, []);
  return <div className="dialog-prose analytics-privacy">
    <h3>利用状況の集計</h3>
    <p>サービス改善のため、利用者数や店舗の保存件数などを集計し、Google CloudのBigQueryに保存します。集計結果に、名前・メールアドレス・店舗URL・メモ・評価の明細は含めません。</p>
    {analyticsConfigured && <>
      <h3>アクセス解析と外部への送信</h3>
      <p>Google LLCが提供するGoogle Analyticsを使い、ページの閲覧と初回登録を計測します。Cookie等のブラウザー識別子、閲覧ページの種類、登録時の認証方法、端末・ブラウザー情報がGoogleへ送信されます。通信時にはIPアドレスもGoogleに伝わります。サービスの利用状況の把握と改善に利用し、広告向けのGoogleシグナルと広告のパーソナライズは無効にしています。</p>
      <p>Google Analyticsの計測イベントには、氏名・メールアドレス・アカウントのユーザーID・保存した店舗URL・メモ・評価・検索語・位置情報を含めません。ページURLのクエリや参照元URLも送りません。</p>
      <p>Googleによる情報の取り扱いは、<a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Googleのプライバシーポリシー</a>をご覧ください。</p>
      <label className="analytics-preference"><input type="checkbox" checked={disabled} onChange={event => {
        const value = event.target.checked;
        const persisted = setAnalyticsDisabled(value);
        setDisabled(analyticsDisabled());
        setMessage(persisted ? (value ? "このブラウザーでのアクセス解析を停止しました。" : "このブラウザーでのアクセス解析を再開しました。") : "設定を保存できませんでした。この画面では解析を停止しますが、再読み込み後の設定は保持できない場合があります。");
      }} />このブラウザーでアクセス解析を停止する</label>
      <p>この設定は、このブラウザーでのGoogle Analyticsの計測に適用されます。ログイン・店舗保存・おすすめは引き続き利用できます。件数集計と下記のGoogle広告タグには適用されません。</p>
      {message && <p role="status">{message}</p>}
    </>}
    <h3>Google広告の計測</h3>
    <p>広告の効果を測定するため、Google広告のタグを設置しています。Cookie等の識別子、閲覧ページのURL、参照元、広告クリックに関する情報などがGoogleへ送信される場合があります。通信時にはIPアドレスもGoogleに伝わります。氏名・メールアドレス・保存した店舗の記録を、サイトから広告タグへ明示的に渡す処理は行っていません。</p>
    <p>詳しくは、<a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">Googleによるパートナーサイトの情報の利用</a>をご覧ください。</p>
  </div>;
}
