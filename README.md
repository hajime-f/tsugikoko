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
- URLからの店舗登録、非公開マイリスト、店名・住所・メモの編集、30日間のごみ箱
- 対応する公式ページ・食べログ・一休などからの店名・住所・料理ジャンルの自動補完
- 非公開の訪問記録（訪問日・任意の星1〜5・任意の感想）、再訪履歴、記録の編集・削除
- ログイン状態の維持と未ログイン時の`/home`から`/login`への移動
- スマートフォン中心のログイン後ホーム（マイリスト・おすすめの空状態）
- アカウント表示、認証方法の追加・解除（最後の方法は解除不可）
- URL入力の検証と、ログイン完了後のマイリストへの自動保存
- 保存操作を試せる画面内デモ
- モバイルメニュー、FAQ、プライバシー説明、画像クレジット

Google認証と店舗保存は実際のFirebaseに接続します。訪問記録・評価は利用でき、レコメンドは準備中です。ログイン前にURLを入力して「保存してはじめる」を押すと、ログイン完了後にFirestoreへ非公開で自動保存します。URLは保存成功まで`sessionStorage`でログインしたユーザーにひも付けて保持し、失敗時は入力欄から再試行できます。再読み込みや同じURLの再試行でも、サーバーで重複を防ぎます。未保存のURLはログアウト時に消去しますが、登録済みの店舗はログアウト後も残ります。試作中は検索エンジン向けにnoindexを指定しています。

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

`/home`の表示制御に加え、店舗APIはFirebase Admin SDKでIDトークンと失効を検証します。所有者はトークンのUIDから決定し、入力からは受け取りません。Firestore Rulesでクライアントからの直接アクセスを拒否し、個人データは認証済みAPIだけで扱います。応答は`private, no-store`です。

## 動作確認

```sh
npm run build
npm run typecheck
npm run test:e2e
npm run test:unit
npm run test:auth
npm run test:rules
```

E2Eテストはインストール済みのGoogle Chromeを使い、本番ビルドをポート3100で起動します。スマホ相当の画面幅とPC幅で、URL検証・ダイアログ・メニュー・保存デモ・FAQを確認します。iOS Safariの実機検証は別途必要です。

`test:auth`はFirebase CLIとJava 21以上を使用し、Auth Emulator（9099）・Firestore Emulator（8080）・Next.jsサーバー（3101）を自動で起動・終了します。専用の`.next-auth-test/`に本番モードでビルドし、開発サーバーの再読込が認証処理を中断しないようにしています。`demo-tsugikoko`でGoogle等の認証画面を模擬し、本番ユーザーを作らずにログイン・再読込・別タブ・ログアウト・連携・解除・キャンセルを確認します。エミュレーターの接続は明示した環境変数とループバックのホスト名が揃った場合に限定しています。公開時に`NEXT_PUBLIC_AUTH_EMULATOR_URL`や`FIRESTORE_EMULATOR_HOST`を設定しないでください。店舗E2Eでは本番へ書き込まず、エミュレーターにだけ検証用の取得結果を投入します。`test:rules`はFirestoreへの直接アクセス拒否も確認します。macOSでHomebrewのJavaを利用する場合は、実行時に`PATH="$(brew --prefix openjdk@21)/bin:$PATH" npm run test:auth`のように指定できます。

## 店舗登録と自動取得

- `/api/places`で登録と30件単位の一覧取得、`/api/places/[id]`で編集・再取得・ごみ箱・復元を行います。
- マイリスト・ごみ箱は先頭30件を表示し、末尾の300px手前までスクロールすると次の30件を自動で読み込みます。追加取得は重複実行を防ぎ、失敗時は表示済みの店舗を残して末尾から再試行できます。「もっと見る」は手動操作・自動読み込み非対応環境用にも残します。定期更新・画面への復帰・編集後も読み込み済みのページ数を維持し、タブ切り替え前の古い応答は反映しません。
- 店舗カードの上部には、判定できた料理ジャンルに対応する共通のイメージ写真を表示します。ジャンルが不明な場合は、店舗IDごとに固定した4色の淡い背景と装飾アイコンを表示します。不明ジャンルの装飾はCSS・SVGで描画します。一覧の見出し・タブ・追加操作はスクロール中も上部に残ります。装飾の色・アイコンは店舗のジャンルや評価を表しません。
- `users/{uid}/savedPlaces`に本人の記録、`places`に確認済みの共通店舗情報、`placeSources`に取得元と1日分の再利用情報を分けます。本人の追記は共通情報へ反映しません。
- 同じURLは追跡パラメータを除いて正規化し、トランザクションで重複登録を防ぎます。食べログの口コミ・写真ページ、一休のプランページ、XやInstagramの共有URLも店舗・投稿単位に揃えます。異なる取得元の共通店舗照合は、取得できた店名と住所の完全一致を使い、名前だけで支店を統合しません。
- 保存・編集・再取得の合計は、試作時は1ユーザーあたり20回/分・200回/日。再取得は1分間隔、通常の取得結果は1日再利用します。本人による「再取得」では10分より古い結果を使わず元ページを読み直します。取得方式のバージョンが変わった場合は古いキャッシュを使いません。
- URLを先に保存し、本番ではCloud Tasksのジョブで取得を継続します。外部取得は8秒・1.5MBまで、対応サイトの店舗URLまたは管理者専用設定で有効化したURLに限定し、リダイレクトを追いません。中断した処理はFirestoreの状態を基に一覧再表示時に最大3回まで再開します。Cloud Tasks無効時は90秒の処理リースが切れれば再開でき、ジョブ登録日時には左右されません。登録から10分間のジョブ再登録待ちはCloud Tasks有効時だけ適用します。
- Cloud Tasksのキュー`place-extraction`（asia-east1）・呼び出し用サービスアカウント・必要な権限を構築し、`PLACE_TASKS_ENABLED=true`に設定しました。内部APIはOIDCで呼び出し元を検証します。ローカル・エミュレーター、または`PLACE_TASKS_ENABLED=false`の環境ではCloud Tasks APIを呼ばず`after`を使い、内部APIは401を返します。無効時はプロセス異常終了からの復旧に一覧の再表示が必要です。
- 自動補完は本人の追記を上書きしません。写真・紹介文・口コミ・OGP画像は保存・表示せず、独自のアイコンを表示します。
- ごみ箱は30日間復元可能です。`purgeAt`のTTLで保存記録を削除し、期限超過した記録はTTLの実行待ちでもAPIから非表示にします。共通店舗情報とURL対応用のハッシュは別管理です。

### JSON-LD優先・Geminiによる補完

- `src/server/extraction/parser.ts`でJSON-LDの店舗名・住所を解析します。配列・`@graph`・住所の`@id`参照に対応し、複数店舗や不完全な住所を勝手に確定しません。店舗を特定できた場合はAIを呼びません。
- JSON-LDで特定できない場合は、取得済みHTMLのうち取得元ごとに確認したテキストをGeminiへ渡します。ブラウザー自動操作、画像解析、検索、URL Contextは使用せず、取得を拒否されたURLをAIに取得させることもありません。
- AIはVertex AIの`gemini-3.5-flash-lite`、globalエンドポイント、最小思考設定を使用します。最大6,000文字かつ12,000バイトのページテキスト、リクエスト全体20,000バイト、出力512トークン、15秒、1試行に制限します。上限を超える入力は切り捨てず確認待ちにします。AIが返した店名・住所と根拠の引用が入力内にあるか検証し、推測による補完を除外します。引用の一致だけで店舗の取り違えを完全には防げないため、実例による精度検証を継続します。
- AI呼び出しは全体で日30回・月500回、ユーザーごとに日10回まで。Firestoreトランザクションで呼び出し前に枠を予約します。境界は日本時間、失敗・中断した試行も回数に含めます。`extractionLimits/ai`と`users/{uid}/limits/ai`で管理します。これはFirebase全体の課金上限を保証するものではありません。
- `apphosting.yaml`の`PLACE_AI_ENABLED=true`、`PLACE_AI_PROJECT=tsugikoko`で有効化します。無効化は前者を`false`にして再デプロイします。APIキーは不要で、App HostingのサービスアカウントによるApplication Default Credentialsを使用します。プロジェクトで`aiplatform.googleapis.com`を有効にし、実行アカウントに`aiplatform.endpoints.predict`と`serviceusage.services.use`のカスタムロール`projects/tsugikoko/roles/placeExtractor`を付与します。
- エミュレーターでは実AIへの接続を停止します。`npm run test:unit`で抽出・AI切り替え・応答検証、`npm run test:extraction`でエミュレーター上の保存と並行した課金回数制限、`npm run test:auth`で画面操作を確認できます。エミュレーターテストにはJava 21が必要です。
- AIの利用不可・上限到達・店舗特定失敗はURLと個人メモを保持して画面に理由を表示します。取得のリースは90秒で、古い試行が新しい試行を上書きしないよう識別子を確認します。取得元・実際の取得方法・AIモデル・取得日時を共通情報の出典に記録します。

仕様確認（2026年10月18日）: [Gemini 3.5 Flash-Lite](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite)、[構造化出力](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output)、[データの取扱い](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance)、[料金](https://cloud.google.com/vertex-ai/generative-ai/pricing)。Googleによるモデル学習への利用は事前の許可・指示がない限り行われませんが、キャッシュや不正利用監視等の保持条件は別途適用されます。個人の保存・評価・メモをページ解析AIへ送ることはありません。

### ジャンル別のカード画像

- 取り込み時にJSON-LDの`servesCuisine`と飲食店の型を読み、店舗情報欄の「ジャンル」「料理ジャンル」等、店舗名を含むページタイトル、店名の明示的な語を補完に使います。本文中のメニュー紹介や口コミ・ナビゲーション・関連記事は分類根拠にしません。判断できない場合は不明のままにします。
- JSON-LDで店名・住所を取得できない場合は、既存のGemini呼び出しで料理分類と引用根拠も受け取ります。根拠が元の入力に存在することを検証し、分類だけのための追加AI呼び出しは行いません。ジャンルを収集していない旧キャッシュは、次の取り込み・再取得でページを読み直します。
- 対応画像は寿司・焼肉・焼き鳥・中華・イタリアン・フレンチ・和食・ラーメン・カレー・そば・カフェ・ベーカリーの12種類です。未対応・不明の場合は従来の装飾を残します。ジャンルは店舗の同一判定キーには含めず、共通店舗・取得キャッシュ・個人の保存記録へ保持します。
- 画像は実店舗の料理・内装を示すものではなく、ジャンル共通のイメージです。カードにジャンル名と「イメージ」を表示し、代替テキストでも実店舗の写真ではないことを明示します。外部サイトの写真を転載・直リンクしません。
- 11種類は組み込みの`image_gen`で生成し、720px幅のAVIF（約13〜23KB）とWebPに変換して`public/images/genres/`に配置しました。カフェは既存の提供画像`public/images/landing/coffee-provided`を共用します。AVIF優先・遅延読み込みで、同一ジャンルの画像をブラウザーが再利用できます。
- 元画像は`assets/originals/genres/`に保管し、Git・配信対象から除外します。生成方法・最終プロンプト一式は[`assets/genre-images.json`](assets/genre-images.json)に記録しています。サイトの実行時に画像を生成する処理はありません。

### 訪問記録と評価

- カードの「行ってきた」から訪問日、星1〜5（任意）、感想（任意・2,000文字以内）を記録します。日付の初期値は日本時間の今日で、未来日・実在しない日付はサーバーでも拒否します。未評価は`null`として星の値と区別します。
- 1件でも訪問記録がある店舗は「訪問済み」、0件なら「行きたい」に表示します。再訪は別の記録として残し、編集・確認付きの削除ができます。最後の記録を削除すると「行きたい」に戻ります。
- `PATCH /api/places/[id]`の`addVisit`・`editVisit`・`deleteVisit`で更新し、`GET /api/places/[id]`で本人の履歴を訪問日の新しい順に10件ずつ返します。同日の記録は作成順で並べます。一覧には訪問件数・直近の訪問日と評価だけを返し、感想は含めません。
- 店舗一覧は`status=saved|visited|all`で分類します。旧データも移行せず利用できるよう、取得範囲30件を分類して次のカーソルを返します。該当する店舗がないページにもカーソルがあれば続けて遅延読み込みし、更新時は読み込み済みの範囲を維持します。
- 訪問操作は本人のIDトークンから所有者を決定し、常に非公開です。追加は操作ごとのUUIDで再送による二重登録を防ぎ、編集・削除は更新時刻を照合して別画面の更新を上書きしません。Firestoreへの直接アクセスは禁止です。
- 試作版では履歴を保存店舗ドキュメント内に保持し、1店舗100回を上限とします。感想の長さとの組み合わせでドキュメントの容量超過を避け、`visits`はインデックス対象から除外します。店舗統合時には履歴と直近の評価も引き継ぎます。上限超過・ID衝突で安全に統合できない場合は、元の記録を残します。
- ごみ箱からの復元時にも履歴を保持します。ごみ箱では履歴を閲覧できますが変更はできません。30日の期限後はAPIからアクセスできず、TTLで店舗と一緒に削除します。期限後の再登録は履歴なしで作成します。
- 非公開の保存・評価も将来のユーザー横断レコメンドに利用する方針です。今回は推薦計算や公開レビュー、写真の添付は追加していません。

### 取得元の確認記録（2026年10月18日）

| 対象 | 実装・判断 |
|---|---|
| [BISTRO FRANKY HOTELの公式ページ](https://www.tabisurucafe.com/bistro-franky-hotel) | 店名・所在地・料理ジャンルの事実情報を自動取得。[公開方針](https://www.tabisurucafe.com/general-5)とrobots.txtを確認。創作的表現を含まない個別の事実情報の利用として採用し、紹介文・写真・地図は除外。AIへ送る範囲はページタイトル・所在地の連絡先段落・料理ジャンル欄だけ。明示的なライセンス取得や専門家の法的確認を済ませたという意味ではない。robots.txtのみを利用許諾とは扱わない。 |
| [食べログの例](https://tabelog.com/tokyo/A1303/A130302/13323066/) | ユーザーの明示的な試作指示により、店舗URLをJSON-LD優先・AI補完の対象に追加。[利用規約](https://tabelog.com/help/rules/)の制限を確認しているが、運営者の許諾は未取得。停止要請時には対象から外す。 |
| 一休レストラン | ユーザーの明示的な試作指示により、6桁の店舗IDを持つURLを解析対象に追加。JSON-LDがない場合はタイトル・見出し・所在地候補をAIへ送る。運営者の許諾は未取得。停止要請時には対象から外す。 |
| 登録済みの公式サイト・Instagram等 | ユーザーが再解析を依頼したURLを管理者専用設定で個別に有効化する。Instagram等の全URLを対象にするものではない。 |
| その他の未対応ページ | URLだけを保存して「情報確認待ち」とする。 |

取得範囲は`src/server/extraction/sources.ts`と`registry.ts`で管理します。追加のURLは`extractionSources/{正規化URLのSHA-256}`に`{ url, enabled: true }`を設定します。クライアントからの読み書きは禁止され、個人の登録URLを公開コードへ列挙しません。`enabled: false`で追加URLを停止できます。食べログ・一休の標準対応は`sources.ts`の対応設定を外して再デプロイすることで停止します。ページの構造変更や複数住所で判定が曖昧になった場合、HTTP拒否・ログイン要求の場合は確定せず、URLを保持します。写真・口コミ・紹介文は保存・転載しません。

既存店舗の再解析は所有者UIDに限定し、ごみ箱を除いた保存記録に対して実行します。管理者処理では`processExtraction(uid, id, { forceRefresh: true })`でキャッシュを使わず再取得でき、編集済みの店名・住所・個人メモは保持します。AIの回数制限も通常どおり適用します。

Firestoreは`(default)`、Standard、`asia-east1`で作成し、削除保護を有効化しています。ルール・インデックス・TTLを先に反映してからアプリをデプロイします。

```sh
firebase deploy --only firestore --project tsugikoko
firebase deploy --only apphosting:tsugikoko --project tsugikoko
```

本番のAdmin SDKはApp HostingのApplication Default Credentialsを使い、秘密鍵ファイルは不要です。[Firebase公式ドキュメント](https://firebase.google.com/docs/app-hosting/about-app-hosting)

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

ログイン前・ログイン後のトップ画像は、ご提供の`shutterstock_646209796.jpg`を軽量化したものです。原本（4,584 × 3,248、12,345,032バイト）は`assets/originals/shutterstock_646209796.jpg`に保管し、Git・デプロイから除外します。

| 配信画像 | サイズ | 容量 |
|---|---|---|
| スマホ用AVIF | 800 × 567 | 51,371バイト |
| PC用AVIF | 1,600 × 1,134 | 155,719バイト |
| スマホ用WebP（AVIF非対応環境用） | 800 × 567 | 90,372バイト |
| PC用WebP（AVIF非対応環境用） | 1,600 × 1,134 | 269,310バイト |

`HeroImage`が画面幅700pxを境に画像を切り替え、AVIF非対応環境にはWebPを配信します。メタデータを除去し、閲覧時には原本を配信しません。

「次の『ここ』がある毎日。」の3枚は、ご提供画像を軽量化して`public/images/landing/`に保存しています。原本は`assets/originals/`へ移動し、Git・デプロイから除外しています。AVIFを優先し、非対応ブラウザーにはWebPを配信します。表示領域に近づいたときに読み込みます。

| 用途 | 原本 | 配信名（AVIF / WebP） | AVIF容量 | WebP容量 |
|---|---|---|---|---|
| コーヒー | `pr00614.jpg` | `coffee-provided` | 11,388バイト | 17,106バイト |
| サラダ | `publicdomainq-0030989pjm.jpg` | `salad-provided` | 23,964バイト | 38,540バイト |
| 食事 | `images.jpg` | `weekend-provided` | 28,643バイト | 48,004バイト |

「見つけた、その時に。」の保存デモにも、同じ`coffee-provided.avif`（非対応環境はWebP）を使用します。同じ画像URLを再利用し、重複ダウンロードを抑えます。料理写真は利用イメージで、ツギココに掲載される実店舗や推薦結果を表すものではありません。

写真の出典はサイトのフッターからも確認できます。サイト共通画像の分類はCONTEXT.mdの配置方針を参照してください。今回の料理写真はトップページ専用のため`landing/`にまとめています。

## Git管理

`AGENTS.md`、`CLAUDE.md`、`.agent-bridge/`、環境変数の実値、依存パッケージ、ビルド結果、テスト結果はコミット対象外です。
