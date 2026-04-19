@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "VENV_PY=%BACKEND%\.venv\Scripts\python.exe"
set "REQ_HASH_FILE=%BACKEND%\.venv\.requirements.sha256"
if not defined START_HOST set "START_HOST=127.0.0.1"
if not defined BASE_PORT set "BASE_PORT=8000"
if not defined START_MODE set "START_MODE=classic"
if not defined START_PATH set "START_PATH=/"

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

set "APP_PORT="
set "PORT_TMP=%TEMP%\aindexer_port_%RANDOM%_%RANDOM%.txt"
set "PORT_LOG=%ROOT%data\logs\port.log"
"%VENV_PY%" "%ROOT%scripts\allocate_port.py" --host %START_HOST% --preferred %BASE_PORT% --log "%PORT_LOG%" > "%PORT_TMP%"
if errorlevel 1 (
  if exist "%PORT_TMP%" del /q "%PORT_TMP%" >nul 2>nul
  echo [ERROR] Failed to allocate an available port.
  pause
  exit /b 1
)
if exist "%PORT_TMP%" set /p APP_PORT=<"%PORT_TMP%"
if exist "%PORT_TMP%" del /q "%PORT_TMP%" >nul 2>nul

if not defined APP_PORT (
  echo [ERROR] Failed to allocate an available port.
  pause
  exit /b 1
)

if /I not "%APP_PORT%"=="%BASE_PORT%" (
  echo [WARN] Port %BASE_PORT% is occupied. Switched to %APP_PORT%.
)

if not defined START_URL set "START_URL=http://%START_HOST%:%APP_PORT%%START_PATH%"

echo [RUN] Browser will open after server starts...
echo [RUN] Target mode: %START_MODE%
echo [RUN] Listening on: http://%START_HOST%:%APP_PORT%/
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process '%START_URL%'"

echo [RUN] Starting uvicorn in this window (visible mode)...
echo [RUN] Press Ctrl+C to stop server.
"%VENV_PY%" -m uvicorn app.main:app --host %START_HOST% --port %APP_PORT%

set "RC=%errorlevel%"
echo.
echo [INFO] Server process exited with code %RC%.
pause
exit /b %RC%
