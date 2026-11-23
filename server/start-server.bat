@echo off
title Exec Office - Server
cd /d "%~dp0"
echo.
echo  ===============================================
echo   Exec Office - Database Server
echo   On this PC:        http://localhost:5080
echo   On office PCs:     http://THIS-PC-IP:5080
echo   Keep this window open while you work.
echo  ===============================================
echo.
echo  Waiting for SQL Server to be ready...
:waitsql
sc query "MSSQL$SQLEXPRESS" | find "RUNNING" >nul
if errorlevel 1 (
  timeout /t 3 /nobreak >nul
  goto waitsql
)
echo  SQL Server is running. Starting...
echo.
dotnet run --no-launch-profile -c Release
echo.
echo  The server stopped. Press any key to close.
pause >nul
