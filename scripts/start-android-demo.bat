@echo off
setlocal EnableExtensions

title Mobile Exam Android Demo

set "SCRCPY_EXE="
for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\Genymobile.scrcpy_*") do (
  for /d %%S in ("%%~fD\scrcpy-win64-*") do (
    if exist "%%~fS\scrcpy.exe" set "SCRCPY_EXE=%%~fS\scrcpy.exe"
  )
)

if not defined SCRCPY_EXE (
  echo scrcpy was not found.
  echo Run: winget install --exact --id Genymobile.scrcpy
  pause
  exit /b 1
)

for %%F in ("%SCRCPY_EXE%") do set "SCRCPY_DIR=%%~dpF"
set "ADB_EXE=%SCRCPY_DIR%adb.exe"

echo Checking the Android device...
"%ADB_EXE%" start-server >nul 2>&1

set "ANDROID_DEVICE="
for /f "skip=1 tokens=1,2" %%A in ('"%ADB_EXE%" devices') do (
  if "%%B"=="device" set "ANDROID_DEVICE=%%A"
)

if not defined ANDROID_DEVICE (
  echo.
  echo No Android device was detected.
  echo 1. Enable USB debugging on the phone.
  echo 2. Connect the phone to this PC with a USB cable.
  echo 3. Approve the USB debugging prompt on the phone.
  echo 4. Run this BAT file again.
  echo.
  pause
  exit /b 2
)

echo Connected device: %ANDROID_DEVICE%
echo Starting the phone screen. Close the window to finish.

"%SCRCPY_EXE%" --serial=%ANDROID_DEVICE% --stay-awake --max-size=1080 --video-bit-rate=8M --window-title="Mobile Exam Android"

endlocal
