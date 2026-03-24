@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "VENV_PY=%BACKEND%\.venv\Scripts\python.exe"
set "VENV_PYW=%BACKEND%\.venv\Scripts\pythonw.exe"
set "REQ_HASH_FILE=%BACKEND%\.venv\.requirements.sha256"
if not defined START_HOST set "START_HOST=127.0.0.1"
if not defined START_PATH set "START_PATH=/"
if not defined BASE_PORT set "BASE_PORT=8000"

cd /d "%BACKEND%"
if errorlevel 1 exit /b 1

if not exist "%VENV_PY%" (
  where py >nul 2>nul
  if %errorlevel%==0 (
    py -3 -m venv .venv
  ) else (
    python -m venv .venv
  )
)
if not exist "%VENV_PY%" exit /b 1

set "CUR_REQ_HASH="
set "OLD_REQ_HASH="
for /f "skip=1 tokens=1" %%i in ('certutil -hashfile "requirements.txt" SHA256 ^| findstr /R /I "^[0-9A-F][0-9A-F]"') do if not defined CUR_REQ_HASH set "CUR_REQ_HASH=%%i"
if exist "%REQ_HASH_FILE%" set /p OLD_REQ_HASH=<"%REQ_HASH_FILE%"

if /I not "%CUR_REQ_HASH%"=="%OLD_REQ_HASH%" (
  "%VENV_PY%" -m pip install --upgrade pip setuptools wheel >nul 2>nul
  if errorlevel 1 exit /b 1
  "%VENV_PY%" -m pip install -r requirements.txt >nul 2>nul
  if errorlevel 1 exit /b 1
  >"%REQ_HASH_FILE%" (<nul set /p="%CUR_REQ_HASH%")
)

set "APP_PORT="
set "PORT_TMP=%TEMP%\aindexer_port_%RANDOM%_%RANDOM%.txt"
set "PORT_LOG=%ROOT%data\logs\port.log"
"%VENV_PY%" "%ROOT%scripts\allocate_port.py" --host %START_HOST% --preferred %BASE_PORT% --log "%PORT_LOG%" > "%PORT_TMP%"
if errorlevel 1 (
  if exist "%PORT_TMP%" del /q "%PORT_TMP%" >nul 2>nul
  exit /b 1
)
if exist "%PORT_TMP%" set /p APP_PORT=<"%PORT_TMP%"
if exist "%PORT_TMP%" del /q "%PORT_TMP%" >nul 2>nul

if not defined APP_PORT exit /b 1

set "APP_HOST=%START_HOST%"
set "APP_PORT=%APP_PORT%"
set "APP_START_PATH=%START_PATH%"
if not defined START_URL set "START_URL=http://%APP_HOST%:%APP_PORT%%APP_START_PATH%"
set "APP_START_URL=%START_URL%"

if exist "%VENV_PYW%" (
  start "" "%VENV_PYW%" "%BACKEND%\launcher_hidden.py"
) else (
  start "" /min "%VENV_PY%" "%BACKEND%\launcher_hidden.py"
)
exit /b 0
