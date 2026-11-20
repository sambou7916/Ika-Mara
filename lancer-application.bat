@echo off
title IKA-MARA - Serveur Local
echo ========================================================
echo           DEMARRAGE DE L'APPLICATION IKA-MARA
echo ========================================================
echo.

set "PATH=D:\Users\moussa\node-v20.18.0-win-x64;%PATH%"
cd /d "d:\Ika-MARA"

echo Ouverture automatique dans votre navigateur...
timeout /t 3 /nobreak >nul
start http://localhost:3000/admin

echo Lancement du serveur Next.js...
node.exe "node_modules\next\dist\bin\next" dev

pause
