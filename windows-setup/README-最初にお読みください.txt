出張健診システム Windows 11 + FeliCa セットアップ
=================================================

必要なもの
----------
- Windows 11端末
- Google Chrome または Microsoft Edge
- PaSoRi RC-S300
- FeliCa Lite-Sカード
- 初回セットアップ時の管理者権限（ドライバー設定のみ）

セットアップ順序
----------------
1. このZIPファイルを右クリックし「すべて展開」します。
2. 展開したフォルダー内の「windows-setup\01-セットアップ.bat」を実行します。
3. 「windows-setup\02-RC-S300ドライバー設定.txt」に従ってドライバーを設定します。
4. 「windows-setup\03-接続確認.bat」を実行します。
5. デスクトップの「出張健診システム」を開きます。

新端末に入るFeliCa用プログラム
------------------------------
- mobile-exam-felica.exe: RC-S300と直接通信し、カードを読み書きします。
- felica-helper.ps1: Web画面と読取プログラムを127.0.0.1:8765で接続します。
- Windowsログイン時に補助アプリが自動起動します。
- 有償のSony SDKやRust開発環境は不要です。

保存場所とセキュリティ
----------------------
- プログラム: %LOCALAPPDATA%\MobileExamFelica\App
- カード紐付け: %LOCALAPPDATA%\MobileExamFelica\bindings.dat
- カードバックアップ: %LOCALAPPDATA%\MobileExamFelica\card-backups.dat
- 紐付けとバックアップはWindowsユーザー単位のDPAPIで暗号化されます。
- 補助アプリは端末内の127.0.0.1だけで待ち受け、LANやインターネットには公開しません。

運用上の注意
------------
- Windowsは健診専用の標準ユーザーで利用してください。
- BitLocker、画面ロック、Windows Update、ウイルス対策を有効にしてください。
- 同じWindowsユーザーを複数人で共有しないでください。
- 端末紛失時に備え、クラウド同期完了を毎回確認してください。

