@echo off
setlocal EnableExtensions

set "START_MODE=classic"
set "START_URL=http://127.0.0.1:8000/"

echo [INFO] Using classic launcher.
call "%~dp0start_literature_indexer_debug.bat"
