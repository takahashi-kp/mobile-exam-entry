param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "dist")
)

$ErrorActionPreference = "Stop"
$version = Get-Date -Format "yyyyMMdd-HHmm"
$packageName = "mobile-exam-entry-windows11-felica-$version"
$stage = Join-Path $OutputDirectory $packageName
$zip = "$stage.zip"

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }

New-Item -ItemType Directory -Force -Path (Join-Path $stage "windows-setup") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage "felica-native\bin") | Out-Null

Copy-Item -LiteralPath (Join-Path $PSScriptRoot "felica-helper.ps1") -Destination $stage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "start-felica-helper.bat") -Destination $stage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "felica-native\bin\mobile-exam-felica.exe") -Destination (Join-Path $stage "felica-native\bin")
Copy-Item -Path (Join-Path $PSScriptRoot "windows-setup\*") -Destination (Join-Path $stage "windows-setup") -Recurse

$zadig = Join-Path $PSScriptRoot "tools\zadig-2.9.exe"
if (Test-Path -LiteralPath $zadig) {
  Copy-Item -LiteralPath $zadig -Destination (Join-Path $stage "windows-setup")
} else {
  Write-Warning "tools\zadig-2.9.exe がないため、Zadigはパッケージに含まれません。"
}

Compress-Archive -LiteralPath $stage -DestinationPath $zip -CompressionLevel Optimal
Write-Host "作成しました: $zip" -ForegroundColor Green

