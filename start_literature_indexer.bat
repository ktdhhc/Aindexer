@echo off
setlocal EnableExtensions

echo [INFO] start_literature_indexer.bat now defaults to classic mode.
echo [INFO] Use start_literature_indexer_classic.bat or start_literature_indexer_v2.bat for explicit launch.
call "%~dp0start_literature_indexer_classic.bat"
