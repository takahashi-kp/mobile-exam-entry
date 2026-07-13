# 出張健診 検査項目入力

ブラウザで動くローカルファーストの入力アプリです。

- ローカル保存: IndexedDB
- オフライン対応: Service Worker
- クラウド同期: 画面の「同期」タブで REST API URL と APIキーを設定
- 対応画面: スマホ、タブレット、PC

## 特定保健指導の年齢判定

- 下限は年度末年齢40歳以上で判定します。
- 上限は受診日当日に75歳未満であることに加え、75歳の誕生日の6か月前より前に受診していることを条件とします。
- 受診日に74歳で対象となる場合は、判定欄に保健指導完了期限を表示します。

## 使い方

`index.html` をブラウザで開きます。PWA/オフライン機能まで確認する場合は、ローカルサーバーで開いてください。

```powershell
python -m http.server 4173
```

その後 `http://localhost:4173` を開きます。

## クラウド同期API

設定したURLに、未同期レコードを `POST` します。APIキーを設定した場合は `Authorization: Bearer <APIキー>` を付けます。

クラウド読込では、同じURLに `GET` し、レコード配列を受け取ります。

### 複数端末・オフライン同期

- 入力内容は最初に各端末の IndexedDB へ保存します。
- オンライン時は保存後に自動送信し、画面切替、画面復帰、オンライン復帰、30秒間隔で自動読込します。
- レコードは「予定グループ + 受診者コード + 検査グループ」の安定したキーで統合します。
- クラウド読込では未同期・同期失敗のローカル値を上書きしません。
- 空欄の値で既存の測定値を消さず、サーバーは受信した各版を `sync_record_history` に保存します。
- 同じ検査項目へ複数端末から異なる非空値が届いた場合、表示値は後着を採用しますが、過去の受信値は履歴に残ります。

同梱の `cloud_api_example.py` は最小の同期APIです。社内サーバーやクラウドVMに置いて起動し、アプリの同期URLに `http://サーバー名:8787` を設定します。

```powershell
python cloud_api_example.py
```

## GitHub / Render で共有する

このアプリは Flask API と PostgreSQL を使用するため、Render では Python Web Service として公開します。

### GitHub に置く手順

```powershell
git init
git add .
git commit -m "Initial mobile exam entry app"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
git push -u origin main
```

### Render に載せる手順

1. Render の Dashboard で New > Blueprint または Web Service を選びます。
2. GitHub のリポジトリを接続します。
3. Blueprint を使う場合は、このリポジトリ直下の `render.yaml` を選びます。
4. 手動設定する場合は以下にします。

```text
Build Command: pip install -r requirements.txt
Start Command: gunicorn server:app
```

公開後は `https://<サービス名>.onrender.com/` で開けます。

`DATABASE_URL` と、必要に応じて `SYNC_API_KEY` を設定します。秘密情報はGitへ保存しないでください。
