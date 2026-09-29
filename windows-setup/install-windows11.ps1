param(
  [string]$AppUrl = "https://mobile-exam-entry-b6w9-z574.onrender.com/"
)

$ErrorActionPreference = "Stop"
$packageRoot = Split-Path -Parent $PSScriptRoot
$installRoot = Join-Path $env:LOCALAPPDATA "MobileExamFelica\App"
$startupRoot = [Environment]::GetFolderPath("Startup")
$desktopRoot = [Environment]::GetFolderPath("Desktop")

$required = @(
  (Join-Path $packageRoot "felica-helper.ps1"),
  (Join-Path $packageRoot "start-felica-helper.bat"),
  (Join-Path $packageRoot "felica-native\bin\mobile-exam-felica.exe")
)
foreach ($path in $required) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "必要なファイルがありません: $path"
  }
}

New-Item -ItemType Directory -Force -Path (Join-Path $installRoot "felica-native\bin") | Out-Null
Copy-Item -LiteralPath (Join-Path $packageRoot "felica-helper.ps1") -Destination $installRoot -Force
Copy-Item -LiteralPath (Join-Path $packageRoot "start-felica-helper.bat") -Destination $installRoot -Force
Copy-Item -LiteralPath (Join-Path $packageRoot "felica-native\bin\mobile-exam-felica.exe") -Destination (Join-Path $installRoot "felica-native\bin") -Force

$launcher = Join-Path $installRoot "start-felica-helper.bat"
$startupShortcut = Join-Path $startupRoot "出張健診 FeliCa補助アプリ.lnk"
$desktopShortcut = Join-Path $desktopRoot "FeliCa補助アプリ起動.lnk"
$appShortcut = Join-Path $desktopRoot "出張健診システム.url"
$checkShortcut = Join-Path $desktopRoot "FeliCa接続確認.lnk"
$checkScript = Join-Path $installRoot "check-felica.ps1"

Copy-Item -LiteralPath (Join-Path $PSScriptRoot "check-felica.ps1") -Destination $checkScript -Force

$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @($startupShortcut, $desktopShortcut)) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $launcher
  $shortcut.WorkingDirectory = $installRoot
  $shortcut.WindowStyle = 7
  $shortcut.Save()
}

$check = $shell.CreateShortcut($checkShortcut)
$check.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$check.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$checkScript`""
$check.WorkingDirectory = $installRoot
$check.Save()

@"
[InternetShortcut]
URL=$AppUrl
"@ | Set-Content -LiteralPath $appShortcut -Encoding ASCII

$running = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
if (-not $running) {
  Start-Process -FilePath $launcher -WorkingDirectory $installRoot -WindowStyle Minimized
  Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "FeliCa補助アプリのセットアップが完了しました。" -ForegroundColor Green
Write-Host "インストール先: $installRoot"
Write-Host "Windowsログイン時に補助アプリを自動起動します。"
Write-Host "次に『02-RC-S300ドライバー設定.txt』の手順を実施してください。"

