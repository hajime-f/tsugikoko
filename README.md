# ツギココ

気になったら、ツギココ。

飲食店・カフェの「行きたい」を記録するWebサービスです。仕様・技術スタック・設計方針は[CONTEXT.md](CONTEXT.md)を参照してください。

## 開発環境

Node.js 22系とnpmを使用します。App Hostingのビルド環境も22系に指定しています。

```sh
npm install
npm run dev
```

http://127.0.0.1:3000 を開きます。

この開発環境のTurbopackの起動制限を避けるため、開発・本番ビルドにはNext.jsのWebpackオプションを使用しています。

## 現在の実装

- スマートフォン中心のログイン前トップページ
- Firebase AuthenticationによるGoogle登録・ログイン・ログアウト
- ログイン状態の維持と未ログイン時の`/home`から`/login`への移動
- スマートフォン中心のログイン後ホーム（マイリスト・おすすめの空状態）
- アカウント表示、認証方法の追加・解除（最後の方法は解除不可）
- URL入力の検証と、ログイン後へのタブ内の下書き引き継ぎ
- 保存操作を試せる画面内デモ
- モバイルメニュー、FAQ、プライバシー説明、画像クレジット

Google認証は実際のFirebaseに接続します。店舗情報の取得・保存・訪問記録・評価・レコメンドは未実装で、ログイン後のホームにも準備中と表示します。入力URLは`sessionStorage`にユーザー別の下書きとして保持し、ログアウト時に削除します。URLはサーバーへ保存せず、タブを閉じると失われます。試作中は検索エンジン向けにnoindexを指定しています。

## 認証設定

- `src/lib/firebase/client.ts`はWebアプリの公開設定です。サービスアカウント鍵やOAuthシークレットは含みません。
- Google認証の設定は`firebase.json`で管理し、`firebase deploy --only auth --project tsugikoko`で反映します。
- Firebase Authenticationの承認済みドメインに、公開ドメイン・`localhost`・`127.0.0.1`を設定済みです。同一メールアドレスで複数アカウントを作成する設定は無効です。
- 認証はFirebase SDKのポップアップを利用します。閉じた場合・ブロック・通信失敗は画面内で案内します。SNS内ブラウザではSafari/Chromeで開き直してください。
- 初回認証はアカウント登録を兼ねます。既存ユーザーには以前と同じ方法を選ぶよう案内し、新しい方法はログイン後に`linkWithPopup`で同一UIDへ連携します。メールアドレスや表示名だけで独自に統合しません。
- X・Facebook・Appleのログイン・連携コードは実装済みですが、各サービスの開発者アプリ設定が必要です。未設定の方法は「準備中」と表示します。

### X・Facebook・Appleの有効化

1. 各サービスで開発者アプリを用意し、コールバックURLを`https://tsugikoko.firebaseapp.com/__/auth/handler`に設定します。
2. [Firebase Authentication](https://console.firebase.google.com/project/tsugikoko/authentication/providers)で各プロバイダーのID・シークレット等を設定して有効化します。秘密情報はリポジトリに置かないでください。
3. 有効化できたIDのみ、`apphosting.yaml`のBUILD環境変数`NEXT_PUBLIC_AUTH_PROVIDERS`にカンマ区切りで追加し、再デプロイします（例: `google.com,facebook.com`）。Xは`twitter.com`、Appleは`apple.com`です。ローカルでは`.env.local`に指定します。

この段階の`/home`はクライアント側で認証を確認するUIで、個人データを返すAPIやFirestoreはまだありません。店舗データ追加時にはFirebase Security Rules、サーバーAPIではIDトークン検証を必須とします。クライアントの画面制御をデータのアクセス制御として扱わないでください。

## 動作確認

```sh
npm run build
npm run typecheck
npm run test:e2e
npm run test:auth
```

E2Eテストはインストール済みのGoogle Chromeを使い、本番ビルドをポート3100で起動します。スマホ相当の画面幅とPC幅で、URL検証・ダイアログ・メニュー・保存デモ・FAQを確認します。iOS Safariの実機検証は別途必要です。

`test:auth`はFirebase CLIを使用し、Auth Emulator（9099）とNext.jsサーバー（3101）を自動で起動・終了します。専用の`.next-auth-test/`に本番モードでビルドし、開発サーバーの再読込が認証処理を中断しないようにしています。`demo-tsugikoko`でGoogle等の認証画面を模擬し、本番ユーザーを作らずにログイン・再読込・別タブ・ログアウト・連携・解除・キャンセルを確認します。エミュレーターの接続は明示した環境変数とループバックのホスト名が揃った場合に限定しています。公開時に`NEXT_PUBLIC_AUTH_EMULATOR_URL`を設定しないでください。

## Firebase App Hosting

`apphosting.yaml`に試作用の実行設定を用意しています。待機インスタンス0台、最大1台、CPU 1、メモリ512 MiBです。この設定は月額料金の上限を保証するものではありません。

Google Cloudプロジェクト`tsugikoko`を作成済みです。`.firebaserc`で接続先、`firebase.json`でApp HostingのバックエンドID`tsugikoko`と送信対象外ファイルを指定しています。

2026年10月18日にFirebaseの有効化・既存請求先への接続（Blaze）・初回デプロイを完了しました。リージョンは`asia-east1`（台湾）です。

公開URL: https://tsugikoko--tsugikoko.asia-east1.hosted.app

更新時はこのディレクトリから実行します。

```sh
firebase login
firebase deploy --only apphosting:tsugikoko --project tsugikoko
```

既存プロジェクトとバックエンドを使用するため、`firebase init`の再実行は不要です。アプリのルートは`.`、Node.jsは22系です。ローカルソースからデプロイするため、GitHubへのコミット・pushは不要です。[Firebase公式ドキュメント](https://firebase.google.com/docs/app-hosting/alt-deploy)

公開環境の表示・操作確認は次のコマンドで実行できます。

```sh
E2E_BASE_URL=https://tsugikoko--tsugikoko.asia-east1.hosted.app npm run test:e2e
```

## 画像

画像は`public/images/landing/`に保存しています。以下のUnsplash写真を[Unsplash License](https://unsplash.com/license)に基づいて試作用に使用しています（2026年10月18日確認）。料理写真は利用イメージで、ツギココに掲載される実店舗や推薦結果を表すものではありません。

| ファイル | 撮影者 | 元ページ |
|---|---|---|
| `brunch.webp` | Caramel | [Cafe brunch spread](https://unsplash.com/photos/a-table-topped-with-lots-of-plates-of-food-4h9Ffh6aawI) |
| `coffee.webp` | shche_ team | [A cup of coffee on a saucer](https://unsplash.com/photos/a-cup-of-coffee-on-a-saucer-heKg-V9yHwc) |
| `salad.webp` | Monika Grabkowska | [Vegetable salad](https://unsplash.com/photos/vegetable-salad-pCxJvSeSB5A) |

写真の出典はサイトのフッターからも確認できます。サイト共通画像の分類はCONTEXT.mdの配置方針を参照してください。今回の料理写真はトップページ専用のため`landing/`にまとめています。

## Git管理

`AGENTS.md`、`CLAUDE.md`、`.agent-bridge/`、環境変数の実値、依存パッケージ、ビルド結果、テスト結果はコミット対象外です。
