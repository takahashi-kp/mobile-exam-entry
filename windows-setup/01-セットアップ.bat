@echo off
chcp 65001 >nul
title 出張健診 FeliCaセットアップ
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows11.ps1"
if errorlevel 1 (
  echo.
  echo セットアップに失敗しました。表示された内容を確認してください。
)
pause

