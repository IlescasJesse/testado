@echo off
echo ====================================================
echo  Instalador de QPDF para Testado
echo ====================================================
echo.
echo QPDF es necesario para proteger los PDFs contra edicion.
echo.
echo Opciones de instalacion:
echo.
echo 1. Instalar con Chocolatey (recomendado)
echo 2. Descargar manualmente desde qpdf.sourceforge.io
echo.
echo ====================================================
echo.

REM Verificar si Chocolatey esta instalado
where choco >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Chocolatey detectado. Instalando qpdf...
    echo.
    choco install qpdf -y
    echo.
    echo ====================================================
    echo  QPDF instalado correctamente
    echo ====================================================
    pause
) else (
    echo Chocolatey no esta instalado.
    echo.
    echo Para instalar Chocolatey, ejecuta este comando en PowerShell como Administrador:
    echo Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    echo.
    echo Despues vuelve a ejecutar este archivo.
    echo.
    echo O descarga QPDF manualmente desde: https://qpdf.sourceforge.io/
    echo.
    pause
)
