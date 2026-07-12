@echo off
echo Closing all Edge processes...
taskkill /f /im msedge.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo Starting Edge with remote debugging on port 9222...
start "" msedge --remote-debugging-port=9222 --no-first-run
echo Waiting for Edge to start...
timeout /t 3 /nobreak >nul
echo.
echo Check: http://127.0.0.1:9222/json/version
echo If it shows JSON, you're good to start the server.
echo.
pause
