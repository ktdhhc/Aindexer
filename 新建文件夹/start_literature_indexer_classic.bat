@echo off
setlocal EnableExtensions

set "START_MODE=classic"
set "START_PATH=/"

echo [INFO] Using classic launcher.
call "%~dp0start_literature_indexer_debug.bat"
