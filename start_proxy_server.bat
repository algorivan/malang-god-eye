@echo off
title MALANG GOD-EYE LOCAL SERVER (PORT 8088)
echo ============================================================
echo  MALANG GOD-EYE: Starting Local Server on http://localhost:8088/
echo  Zero CORS - Reverse Proxy Integrated
echo ============================================================
powershell -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port 8088
pause
