@echo off
setlocal EnableExtensions

set "START_MODE=v2"
set "START_PATH=/v2/"

echo [INFO] Using v2 launcher.

call "%~dp0start_literature_indexer_debug.bat"
