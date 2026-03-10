@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "VENV_PY=%BACKEND%\.venv\Scripts\python.exe"
set "REQ_HASH_FILE=%BACKEND%\.venv\.requirements.sha256"

echo [INFO] Root: %ROOT%
echo [INFO] Backend: %BACKEND%

cd /d "%BACKEND%"
if errorlevel 1 (
  echo [ERROR] Cannot enter backend directory.
  pause
  exit /b 1
)

if not exist "%VENV_PY%" (
  echo [INIT] .venv not found, creating virtualenv...
  where py >nul 2>nul
  if %errorlevel%==0 (
    py -3 -m venv .venv
  ) else (
    python -m venv .venv
  )
)

if not exist "%VENV_PY%" (
  echo [ERROR] Failed to create/find .venv python.
  pause
  exit /b 1
)

set "CUR_REQ_HASH="
set "OLD_REQ_HASH="
for /f "skip=1 tokens=1" %%i in ('certutil -hashfile "requirements.txt" SHA256 ^| findstr /R /I "^[0-9A-F][0-9A-F]"') do if not defined CUR_REQ_HASH set "CUR_REQ_HASH=%%i"
if exist "%REQ_HASH_FILE%" set /p OLD_REQ_HASH=<"%REQ_HASH_FILE%"

if /I "%CUR_REQ_HASH%"=="%OLD_REQ_HASH%" (
  echo [INIT] Requirements unchanged, skip install.
) else (
  echo [INIT] Installing/updating dependencies...
  "%VENV_PY%" -m pip install --upgrade pip setuptools wheel
  if errorlevel 1 (
    echo [ERROR] pip toolchain upgrade failed.
    pause
    exit /b 1
  )
  "%VENV_PY%" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [ERROR] Dependency install failed.
    pause
    exit /b 1
  )
  >"%REQ_HASH_FILE%" (<nul set /p="%CUR_REQ_HASH%")
)

netstat -ano | findstr /R /C:":8000 .*LISTENING" >nul
if %errorlevel%==0 (
  echo [ERROR] Port 8000 is already in use.
  echo         Close existing process and retry.
  netstat -ano | findstr /R /C:":8000 .*LISTENING"
  pause
  exit /b 1
)

echo [RUN] Browser will open after server starts...
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8000'"

echo [RUN] Starting uvicorn in this window (visible mode)...
echo [RUN] Press Ctrl+C to stop server.
"%VENV_PY%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000

set "RC=%errorlevel%"
echo.
echo [INFO] Server process exited with code %RC%.
pause
exit /b %RC%
