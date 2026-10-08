@echo off
cd /d "%~dp0"
setlocal

echo ================================================
echo   KING ACADEMY SCHOOL REGISTRATION SYSTEM
echo ================================================
echo.
echo Installing required packages...
npm install
if errorlevel 1 (
  echo.
  echo npm install failed. Please make sure Node.js 18+ and internet access are available.
  pause
  exit /b 1
)

echo.
echo Starting King Academy Registration System...
echo If port 3000 is busy, the system will automatically use the next available port.
echo.
npm start
pause
