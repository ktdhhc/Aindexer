@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "VENV_PY=%BACKEND%\.venv\Scripts\python.exe"
set "BOOTSTRAP_TYPE="
set "BOOTSTRAP_PY="

cd /d "%BACKEND%"

REM Reuse existing venv first
if exist "%VENV_PY%" (
  "%VENV_PY%" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
  if not errorlevel 1 goto venv_ready
  echo [WARN] Existing .venv is not Python 3.10+, recreating...
  rmdir /s /q .venv >nul 2>nul
)

REM Bootstrap from conda python (preferred)
if defined CONDA_PREFIX (
  if exist "%CONDA_PREFIX%\python.exe" (
    set "BOOTSTRAP_TYPE=path"
    set "BOOTSTRAP_PY=%CONDA_PREFIX%\python.exe"
  )
)
if "%BOOTSTRAP_TYPE%"=="" if exist "%USERPROFILE%\miniconda3\python.exe" (
  set "BOOTSTRAP_TYPE=path"
  set "BOOTSTRAP_PY=%USERPROFILE%\miniconda3\python.exe"
)
if "%BOOTSTRAP_TYPE%"=="" if exist "%USERPROFILE%\anaconda3\python.exe" (
  set "BOOTSTRAP_TYPE=path"
  set "BOOTSTRAP_PY=%USERPROFILE%\anaconda3\python.exe"
)
if "%BOOTSTRAP_TYPE%"=="" if exist "%ProgramData%\miniconda3\python.exe" (
  set "BOOTSTRAP_TYPE=path"
  set "BOOTSTRAP_PY=%ProgramData%\miniconda3\python.exe"
)
if "%BOOTSTRAP_TYPE%"=="" if exist "%ProgramData%\anaconda3\python.exe" (
  set "BOOTSTRAP_TYPE=path"
  set "BOOTSTRAP_PY=%ProgramData%\anaconda3\python.exe"
)

REM Fallback to py launcher
if "%BOOTSTRAP_TYPE%"=="" (
  where py >nul 2>nul
  if %errorlevel%==0 set "BOOTSTRAP_TYPE=py"
)

REM Fallback to python in PATH
if "%BOOTSTRAP_TYPE%"=="" (
  where python >nul 2>nul
  if %errorlevel%==0 set "BOOTSTRAP_TYPE=python"
)

if "%BOOTSTRAP_TYPE%"=="" (
  echo [ERROR] No usable .venv found and no Python 3.10+ bootstrap interpreter detected.
  echo         Please install Python 3.10+ or Miniconda/Anaconda.
  pause
  exit /b 1
)

if "%BOOTSTRAP_TYPE%"=="path" (
  "%BOOTSTRAP_PY%" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
  if errorlevel 1 goto bootstrap_too_old
  echo [INIT] Creating virtual environment from "%BOOTSTRAP_PY%"...
  "%BOOTSTRAP_PY%" -m venv .venv
) else if "%BOOTSTRAP_TYPE%"=="py" (
  py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
  if errorlevel 1 goto bootstrap_too_old
  echo [INIT] Creating virtual environment from py -3...
  py -3 -m venv .venv
) else (
  python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
  if errorlevel 1 goto bootstrap_too_old
  echo [INIT] Creating virtual environment from python...
  python -m venv .venv
)

if not exist "%VENV_PY%" (
  echo [ERROR] Failed to create .venv
  pause
  exit /b 1
)

:venv_ready
echo [INIT] Upgrading pip toolchain...
"%VENV_PY%" -m ensurepip --upgrade >nul 2>nul
"%VENV_PY%" -m pip install --upgrade pip setuptools wheel
if %errorlevel% neq 0 (
  echo [ERROR] Failed to upgrade pip toolchain.
  pause
  exit /b 1
)

echo [INIT] Installing dependencies...
"%VENV_PY%" -m pip install -r requirements.txt
if %errorlevel% neq 0 (
  echo [ERROR] Dependency installation failed.
  pause
  exit /b 1
)

netstat -ano | findstr /R /C:":8000 .*LISTENING" >nul
if %errorlevel%==0 (
  echo [ERROR] Port 8000 is already in use.
  echo         Close the existing server or start on another port.
  pause
  exit /b 1
)

echo [RUN] Starting server: http://127.0.0.1:8000
start "" "http://127.0.0.1:8000"
"%VENV_PY%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000

echo.
echo Server stopped.
pause
exit /b 0

:bootstrap_too_old
echo [ERROR] Bootstrap Python is too old. Please use Python 3.10+.
pause
exit /b 1
