@echo off
setlocal

set "ROOT=%~dp0"
set "VENV_PY=%ROOT%backend\.venv\Scripts\python.exe"

if exist "%VENV_PY%" (
  "%VENV_PY%" "%ROOT%scripts\build_windows_onedir.py"
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    py -3 "%ROOT%scripts\build_windows_onedir.py"
  ) else (
    python "%ROOT%scripts\build_windows_onedir.py"
  )
)

if %errorlevel% neq 0 (
  echo.
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

echo.
echo [OK] Build complete. Check dist\
pause
