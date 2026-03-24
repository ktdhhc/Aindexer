@echo off
setlocal EnableExtensions

set "START_MODE=v2"
set "START_URL=http://127.0.0.1:8000/v2/"

echo [INFO] Using v2 launcher.

:: Preflight: Free port 8000
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python is not available. Please install Python to use the port-freeing helper.
    exit /b 1
)

echo [INFO] Checking port 8000...
python "%~dp0scripts\free_port_8000.py"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Port 8000 is still occupied. Startup aborted.
    exit /b 1
)

call "%~dp0start_literature_indexer_debug.bat"
