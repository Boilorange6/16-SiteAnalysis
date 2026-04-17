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

REM Kill any existing process occupying port 3000
set "OLDPID="
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr /R ":3000 "') do (
    if not defined OLDPID set "OLDPID=%%a"
)
if defined OLDPID (
    echo [INFO] Port 3000 is in use by PID !OLDPID!. Terminating old server...
    taskkill /F /PID !OLDPID! >nul 2>nul
    timeout /t 2 /nobreak > nul
    echo [INFO] Old server terminated.
    echo.
)

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
echo       Browser will open automatically when server is ready.
echo       Press Ctrl+C then Y in this window to stop the server.
echo.

REM Open browser asynchronously, polling until server is ready
start "" cmd /c "
:poll
curl.exe -s --max-time 2 -o NUL http://localhost:3000 2>NUL
if errorlevel 1 (
    timeout /t 1 /nobreak > NUL
    goto poll
)
start http://localhost:3000"

REM Run dev server (foreground)
call npm run dev

echo.
echo ==========================================
echo   Server stopped.
echo ==========================================
pause
endlocal
