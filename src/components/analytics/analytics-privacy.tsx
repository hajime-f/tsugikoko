"use client";

import { useEffect, useState } from "react";
import { ANALYTICS_PREFERENCE_EVENT, ANALYTICS_PREFERENCE_KEY, analyticsConfigured, analyticsDisabled, googleAdsSignupConfigured, setAnalyticsDisabled } from "@/lib/analytics";

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
      <p>Google LLCが提供するGoogle Analyticsを使い、ページの閲覧、初回登録、登録・ログインへ進むボタンの操作、認証の開始、トップページのスクロール到達率（25・50・75・90%）を計測します。Cookie等のブラウザー識別子、閲覧ページの種類、ボタンの位置を表す固定の識別名、認証方法、端末・ブラウザー情報がGoogleへ送信されます。通信時にはIPアドレスもGoogleに伝わります。サービスの利用状況と広告の効果の把握・改善に利用し、広告向けのGoogleシグナルと広告のパーソナライズは無効にしています。</p>
      <p>流入元の把握のため、初回のページ閲覧に限り、広告・リンクの識別用パラメーター（utm_source、utm_medium、utm_campaign、utm_content、utm_term）とGoogle広告のクリック識別子（gclid）を、文字種と長さを制限して送信します。外部サイトの参照元はスキームとホストまでとし、パスやクエリは送りません。サイト内の移動では参照元を送りません。</p>
      <p>Google Analyticsの計測イベントには、フォームに入力したURL、サイト内の検索語、保存した店舗URL・メモ・評価、氏名・メールアドレス・アカウントのユーザーID・位置情報を明示的に渡しません。上記以外のURLパラメーターとハッシュは除外します。流入情報の重複送信を抑えるため、同じタブの最終計測時刻だけをブラウザーに保存し、30分間計測がなければ新しい訪問として扱います。</p>
      <p>Googleによる情報の取り扱いは、<a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Googleのプライバシーポリシー</a>をご覧ください。</p>
    </>}
    {(analyticsConfigured || googleAdsSignupConfigured) && <>
      <label className="analytics-preference"><input type="checkbox" checked={disabled} onChange={event => {
        const value = event.target.checked;
        const persisted = setAnalyticsDisabled(value);
        setDisabled(analyticsDisabled());
        setMessage(persisted ? (value ? "このブラウザーでのアクセス解析を停止しました。" : "このブラウザーでのアクセス解析を再開しました。") : "設定を保存できませんでした。この画面では解析を停止しますが、再読み込み後の設定は保持できない場合があります。");
      }} />このブラウザーでアクセス解析を停止する</label>
      <p>この設定は、このブラウザーでのGoogle Analyticsの計測と、Google広告への新規登録の成果イベントに適用されます。ログイン・店舗保存・おすすめは引き続き利用できます。件数集計と、下記のGoogle広告タグそのものによる通信には適用されません。</p>
      {message && <p role="status">{message}</p>}
    </>}
    <h3>Google広告の計測</h3>
    <p>成果計測の設定が有効な場合、新規登録が成功したときに、登録完了を示すイベントをGoogle広告へ1回送信します。広告からの登録の把握と広告配信の改善に利用します。既存アカウントへのログイン、連携の追加、本人確認、ページの再読み込みでは送りません。上記の停止設定が有効なときも送りません。</p>
    <p>この成果イベントには、固定の送信先とページの種類だけを明示的に渡します。URLのクエリ・ハッシュ・参照元、氏名・メールアドレス・アカウントのユーザーID・店舗の記録は渡しません。個人情報を送る拡張コンバージョンは使用しません。</p>
    <p>広告の効果を測定するため、Google広告のタグを設置しています。Cookie等の識別子、閲覧ページのURL、参照元、広告クリックに関する情報などがGoogleへ送信される場合があります。通信時にはIPアドレスもGoogleに伝わります。氏名・メールアドレス・保存した店舗の記録を、サイトから広告タグへ明示的に渡す処理は行っていません。</p>
    <p>詳しくは、<a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">Googleによるパートナーサイトの情報の利用</a>をご覧ください。</p>
  </div>;
}
