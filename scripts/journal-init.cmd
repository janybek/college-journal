@echo off
chcp 65001 >nul
cd /d "%~dp0.."
node backend\node\server.js --init
echo.
pause
