@echo off
setlocal
cd /d "%~dp0"
git config user.name "Jocelin Dahin"
git config user.email "jocelindahin796@gmail.com"
echo.
echo Colle l'URL HTTPS du depot GitHub vide, par exemple :
echo https://github.com/votre-compte/rh-control.git
echo.
set /p REPO_URL=URL du depot GitHub : 
if "%REPO_URL%"=="" (
  echo URL manquante.
  pause
  exit /b 1
)
git remote remove origin >nul 2>nul
git remote add origin "%REPO_URL%"
git branch -M main
git push -u origin main
pause
