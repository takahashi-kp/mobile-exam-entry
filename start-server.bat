@echo off
setlocal
cd /d "C:\Users\inumo\Documents\Codex\2026-04-28\pc-10"
echo Starting local server for 出張健診 検査項目入力...
echo.
echo URL:
echo   http://127.0.0.1:4173/
echo.
echo Press Ctrl+C in this window to stop the server.
echo.
start "" "http://127.0.0.1:4173/"
"C:\Users\inumo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m http.server 4173 --bind 127.0.0.1
pause
