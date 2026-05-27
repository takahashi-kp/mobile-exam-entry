# 出張健診 検査項目入力

ブラウザで動くローカルファーストの入力アプリです。

- ローカル保存: IndexedDB
- オフライン対応: Service Worker
- クラウド同期: 画面の「同期」タブで REST API URL と APIキーを設定
- 対応画面: スマホ、タブレット、PC

## 使い方

`index.html` をブラウザで開きます。PWA/オフライン機能まで確認する場合は、ローカルサーバーで開いてください。

```powershell
python -m http.server 4173
```

その後 `http://localhost:4173` を開きます。

## クラウド同期API

設定したURLに、未同期レコードを `POST` します。APIキーを設定した場合は `Authorization: Bearer <APIキー>` を付けます。

クラウド読込では、同じURLに `GET` し、レコード配列を受け取ります。

同梱の `cloud_api_example.py` は最小の同期APIです。社内サーバーやクラウドVMに置いて起動し、アプリの同期URLに `http://サーバー名:8787` を設定します。

```powershell
python cloud_api_example.py
```

## GitHub / Render で共有する

このアプリは静的ファイルだけで動くため、Render では Static Site として公開します。

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

1. Render の Dashboard で New > Static Site を選びます。
2. GitHub のリポジトリを接続します。
3. Blueprint を使う場合は、このリポジトリ直下の `render.yaml` を選びます。
4. 手動設定する場合は以下にします。

```text
Build Command: 空欄
Publish Directory: .
```

公開後は `https://<サービス名>.onrender.com/` で開けます。

注意: Render に置くのは入力画面本体です。クラウド同期先 API は別途用意し、アプリの「同期」画面で API URL と API キーを設定してください。
