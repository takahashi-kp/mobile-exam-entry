# サーバーレス本番構成メモ

## 方針

画面上は1受診者の入力画面として見せるが、保存単位は検査グループ別に分ける。

- 受診者ヘッダー: 受付番号、個人番号、氏名、予定グループなど
- 検査グループ値: 身体計測、尿検査、血圧など担当者別の入力値
- 進捗サマリ: 各グループの済/未

これにより、身体計測担当と尿検査担当が同じ受診者を同時に入力しても、別グループの値を上書きしにくい。

## DynamoDB案

単一テーブルまたは用途別テーブルで運用する。

```text
PK = TENANT#<tenant_id>#GROUP#<group_id>#PATIENT#<patient_code>
SK = META
SK = EXAM#身体
SK = EXAM#尿
SK = EXAM#血圧
SK = EXAM#視力
SK = EXAM#聴力
SK = EXAM#診察
SK = PROGRESS
```

保存時は該当する `EXAM#<group>` だけを更新する。

同じグループを同時に更新する場合は、`version` を使い、DynamoDB の `ConditionExpression` で衝突を検知する。

## API受信形式

現在のローカル版は、クラウド同期時に以下の `entityType` で送信する予定。

- `record_header`
- `exam_group_value`
- `progress_summary`

### record_header

```json
{
  "entityType": "record_header",
  "id": "record-id",
  "scheduleGroupId": "group-id",
  "patientCode": "10001",
  "data": {
    "受付番号": "12345",
    "個人番号": "10001",
    "氏名": "山田 太郎"
  }
}
```

### exam_group_value

```json
{
  "entityType": "exam_group_value",
  "recordId": "record-id",
  "patientCode": "10001",
  "groupKey": "身体",
  "version": 3,
  "values": {
    "身長": "170.1",
    "体重": "65.0",
    "腹囲": "80.0"
  }
}
```

### progress_summary

```json
{
  "entityType": "progress_summary",
  "recordId": "record-id",
  "patientCode": "10001",
  "progress": {
    "身体": "済",
    "尿": "未"
  }
}
```

## 初期本番で省略するもの

- リアルタイム同時編集
- 項目単位の細かい履歴
- 医療機関横断の分析画面
- WebSocket常時接続

## 初期本番で必須に近いもの

- Cognito等によるログイン
- MFA
- tenant_id / group_id による権限チェック
- CSV出力権限
- 操作ログ
- S3へのCSV取込/出力
- 監査ログとバックアップ

## 端末内データ削除

初期運用は手動削除を標準にする。

- 削除対象は同期済みデータのみ
- 未同期または同期失敗が1件でもあれば削除不可
- 予定グループ単位で削除
- 削除前に件数と確認メッセージを表示

本番APIでは、クラウド側が保存成功時に `cloud_ack_id` または `synced_at` を返す。
端末側はこの受信確認があるデータだけ削除可能にする。

将来的な管理者設定:

- 手動削除
- 同期完了から7日後に自動削除
- 健診終了確認後に削除可能
