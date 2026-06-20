@echo off
echo ========================================
echo  Supermarket Management System
echo ========================================
echo.
echo Starting backend...
start "Backend" cmd /k "cd /d C:\Users\yoga\Desktop\project\SMS-main && C:\Users\yoga\AppData\Local\Programs\Python\Python311\python.exe -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload"

echo Waiting for backend to start...
timeout /t 5 /nobreak > nul

echo Starting Cloudflare tunnel...
start "Tunnel" cmd /k "C:\Users\yoga\Downloads\cloudflared-windows-amd64.exe tunnel --url http://localhost:8000"

echo.
echo ========================================
echo  Both services are starting!
echo  Check the "Tunnel" window for your URL
echo  Update backend\.env FRONTEND_URL with it
echo  Then restart the Backend window
echo ========================================
pause
