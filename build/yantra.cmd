@echo off
rem The `yantra` CLI for an installed YANTRA. Add this folder (<install dir>\resources\bin) to PATH.
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\YANTRA.exe" "%~dp0..\app.asar\out\main\cli.js" %*
exit /b %ERRORLEVEL%
