@echo off
title Helper MML v2 - MAE
rem Roda o helper a partir da pasta deste .bat (ex.: C:\MML)
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (python mml_helper_v2.py %*) else (py mml_helper_v2.py %*)
pause
