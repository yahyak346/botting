@echo off
title Drop Monitor
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install the LTS version from the page that just opened, restart your PC, then double-click this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split(\".\").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)"
if errorlevel 1 (
  echo Your Node.js is too old. Install the LTS version from the page that just opened, then try again.
  start "" https://nodejs.org
  pause
  exit /b 1
)

echo Starting Drop Monitor... keep this window open. Close it to stop the bot.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3001"
node src/index.ts
echo.
echo Drop Monitor stopped.
pause
