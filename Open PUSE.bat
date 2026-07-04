@echo off
setlocal
title PUSE - Pokemon Unbound Save Editor

cd /d "%~dp0frontend"
if errorlevel 1 (
    echo Could not find the frontend folder.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is not installed or not on your PATH.
    echo Install Node.js 20+ from https://nodejs.org/ then try again.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo First run: installing dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        pause
        exit /b 1
    )
)

echo.
echo Starting your personal PUSE build...
echo Browser will open at http://localhost:5173
echo Keep this window open while you use PUSE. Close it to stop the app.
echo.

npm run dev -- --open

pause
