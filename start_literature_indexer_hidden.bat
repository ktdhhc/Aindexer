@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "VENV_PY=%BACKEND%\.venv\Scripts\python.exe"
set "VENV_PYW=%BACKEND%\.venv\Scripts\pythonw.exe"
set "REQ_HASH_FILE=%BACKEND%\.venv\.requirements.sha256"

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

netstat -ano | findstr /R /C:":8000 .*LISTENING" >nul
if %errorlevel%==0 exit /b 1

if exist "%VENV_PYW%" (
  start "" "%VENV_PYW%" "%BACKEND%\launcher_hidden.py"
) else (
  start "" /min "%VENV_PY%" "%BACKEND%\launcher_hidden.py"
)
exit /b 0
