$ErrorActionPreference = "Stop"
$helperUrl = "http://127.0.0.1:8765"
$nativeExe = Join-Path $PSScriptRoot "felica-native\bin\mobile-exam-felica.exe"

Write-Host "出張健診 FeliCa接続確認" -ForegroundColor Cyan
Write-Host ""

try {
  $health = Invoke-RestMethod -Uri "$helperUrl/health" -TimeoutSec 3
  Write-Host "[OK] FeliCa補助アプリ: 起動中 (version $($health.version))" -ForegroundColor Green
} catch {
  Write-Host "[NG] FeliCa補助アプリに接続できません。デスクトップの『FeliCa補助アプリ起動』を実行してください。" -ForegroundColor Red
  Read-Host "Enterキーで終了"
  exit 1
}

if (-not (Test-Path -LiteralPath $nativeExe)) {
  Write-Host "[NG] FeliCa読取プログラムがありません。再セットアップしてください。" -ForegroundColor Red
  Read-Host "Enterキーで終了"
  exit 1
}

Write-Host "PaSoRiにFeliCa Lite-Sカードを置いてください。"
Read-Host "置いたらEnterキーを押す"
try {
  $result = & $nativeExe 2>&1 | Out-String
  $card = $result | ConvertFrom-Json
  if (-not $card.ok) { throw $card.error }
  Write-Host "[OK] PaSoRiとカードを読み取れました。" -ForegroundColor Green
  Write-Host "リーダー: $($card.reader)"
  Write-Host "カードIDm: $($card.idm)"
} catch {
  Write-Host "[NG] カードを読み取れませんでした。" -ForegroundColor Red
  Write-Host $_.Exception.Message
  Write-Host "PaSoRiのUSB接続、カード位置、WinUSBドライバー（interface 0/1）を確認してください。"
  Read-Host "Enterキーで終了"
  exit 1
}

Read-Host "Enterキーで終了"

