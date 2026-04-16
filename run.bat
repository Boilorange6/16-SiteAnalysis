@echo off
chcp 65001 > nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

title SiteAnalysis MVP Launcher

echo ==========================================
echo   SiteAnalysis MVP Launcher
echo   (Cheongwadae Site Analysis)
echo ==========================================
echo.

REM Check Node.js installation
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed.
    echo         Install Node.js LTS from https://nodejs.org/ then re-run.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js !NODE_VER! detected
echo.

REM Step 1/2: Check dependencies
if not exist "node_modules" (
    echo [1/2] node_modules not found - running npm install
    echo       ^(first run may take a few minutes^)
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed. Check network or permissions.
        pause
        exit /b 1
    )
    echo.
    echo [DONE] Dependencies installed
) else (
    echo [1/2] node_modules exists - skipping install
)

echo.
echo [2/2] Starting Next.js dev server...
echo       Browser will open http://localhost:3000 in about 5 seconds.
echo       Press Ctrl+C then Y in this window to stop the server.
echo.

REM Open browser asynchronously after 5 seconds
start "" cmd /c "timeout /t 5 /nobreak > nul & start http://localhost:3000"

REM Run dev server (foreground)
call npm run dev

echo.
echo ==========================================
echo   Server stopped.
echo ==========================================
pause
endlocal
