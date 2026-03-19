@echo off
setlocal EnableExtensions

set "START_MODE=v2"
set "START_URL=http://127.0.0.1:8000/v2/"

echo [INFO] Using v2 launcher.
call "%~dp0start_literature_indexer_debug.bat"
