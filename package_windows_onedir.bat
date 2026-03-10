@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "BUILD_SCRIPT=%ROOT%scripts\build_windows_onedir.py"
set "VENV_PY=%ROOT%backend\.venv\Scripts\python.exe"
set "RUNNER="

if exist "%VENV_PY%" (
  set "RUNNER=%VENV_PY%"
) else (
  where py >nul 2>nul
  if not errorlevel 1 (
    set "RUNNER=py -3"
  ) else (
    set "RUNNER=python"
  )
)

echo [RUN] Packaging Aindexer...
echo [RUN] Script: %BUILD_SCRIPT%
echo [RUN] Runner: %RUNNER%

%RUNNER% "%BUILD_SCRIPT%"
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  echo.
  echo [ERROR] Build failed with exit code %RC%.
  echo [HINT] Check packaged launcher logs under dist\Aindexer\data\logs\ if they exist.
  pause
  exit /b %RC%
)

echo.
echo [OK] Build complete. Check dist\
pause
exit /b 0
