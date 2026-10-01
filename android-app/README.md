# Android版 出張健診

現在のWebアプリを全画面WebViewで表示するAndroidアプリです。IndexedDB、Service Worker、カメラ権限、Android内蔵NFCによるFeliCa Lite-Sの読取り・書込みに対応します。

## ビルド

1. Android Studioをインストールする。
2. `android-app` フォルダーを開く。
3. SDK 35をインストールしてGradle同期する。
4. We3で「開発者向けオプション」「USBデバッグ」を有効化する。
5. USB接続後、Android Studioの実行ボタンから端末へインストールする。

## 他端末へのテスト配布

`gradlew.bat assembleDebug` で生成した `app/build/outputs/apk/debug/app-debug.apk` を、Web配信用の
`downloads/mobile-exam-entry-android-v0.1.1.apk` として配置します。端末では
`/android-download.html` を開き、APKをダウンロードしてインストールします。

このAPKは社内テスト用です。正式運用版は専用のリリース署名鍵を作成し、鍵を安全な場所へ
バックアップしたうえで署名してください。同じアプリを更新するには、常に同じ署名鍵が必要です。

カードはPC版と同じMEX1二重スロット形式です。受付時の受診者紐付けはAndroid端末内に保存されます。同じカードを別端末で使う場合、その端末でも受付登録が必要です。
