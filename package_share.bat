@echo off
setlocal

set "ROOT=%~dp0"
set "SCRIPT=%ROOT%scripts\package_share.py"
set "VENV_PY=%ROOT%backend\.venv\Scripts\python.exe"

if exist "%VENV_PY%" (
  "%VENV_PY%" "%SCRIPT%"
  goto :after_run
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%SCRIPT%"
  goto :after_run
)

where python >nul 2>nul
if %errorlevel%==0 (
  python -c "import sys; sys.exit(0 if sys.version_info[0] >= 3 else 1)" >nul 2>nul
  if %errorlevel%==0 (
    python "%SCRIPT%"
    goto :after_run
  )
)

echo [ERROR] Python 3 not found.
echo.
echo Please install Python 3, OR run start_literature_indexer.bat once to create backend\.venv,
echo then run this script again.
pause
exit /b 1

:after_run

if %errorlevel% neq 0 (
  echo.
  echo [ERROR] Package failed.
  pause
  exit /b 1
)

echo.
echo [OK] Package created under dist\
pause
