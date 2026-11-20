@echo off
title IKA-MARA - Serveur
cd /d "%~dp0"

rem --- Node.js : PATH, sinon installation portable connue ---
where npm >nul 2>nul
if errorlevel 1 set "PATH=D:\Users\moussa\node-v20.18.0-win-x64;%PATH%"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable. Installez Node.js puis relancez ce fichier.
  pause
  exit /b 1
)

rem --- Arreter un ancien serveur reste ouvert sur le port 3000 ---
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /PID %%p /F >nul 2>nul

echo.
echo  ==================================================
echo   IKA-MARA demarre... patientez (30 a 60 secondes)
echo   Le navigateur s'ouvrira tout seul quand ce sera pret.
echo.
echo   Admin  : https://localhost:3000/login
echo   Agent  : https://localhost:3000/agent/connexion
echo.
echo   Laissez cette fenetre OUVERTE pendant l'utilisation.
echo   Pour arreter : fermez cette fenetre.
echo  ==================================================
echo.

rem --- Ouvrir le navigateur seulement quand le serveur repond (max 3 min) ---
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "$fin=(Get-Date).AddMinutes(3); while((Get-Date) -lt $fin){ try { $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',3000); $c.Close(); Start-Sleep 2; Start-Process 'https://localhost:3000/login'; break } catch { Start-Sleep 2 } }"

call npm run dev:https

echo.
echo Le serveur s'est arrete. Lisez le message ci-dessus.
pause
