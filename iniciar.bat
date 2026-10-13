@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
echo ========================================
echo   TESTADO - Sistema de Contratos
echo ========================================
echo.

REM 1. Verificar Node.js
echo [1/4] Verificando Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js no esta instalado.
    echo Instala Node.js desde https://nodejs.org/ y vuelve a intentarlo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo OK: Node.js %%v

REM 1.5 Verificar si la app ya esta corriendo (evita procesos duplicados)
echo.
echo Verificando si la aplicacion ya esta en ejecucion...
set YA_CORRIENDO=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3010 .*LISTENING" /c:":3011 .*LISTENING"') do (
    set YA_CORRIENDO=1
)
if "%YA_CORRIENDO%"=="1" (
    echo.
    echo ========================================
    echo   La aplicacion YA esta corriendo.
    echo ========================================
    echo.
    echo   Detectados procesos activos en el puerto 3010 y/o 3011.
    echo   Si abres otra instancia vas a tener varios procesos duplicados.
    echo.
    set /p CERRAR="Cerrar la instancia actual y abrir esta nueva? (S/N): "
    if /i "!CERRAR!"=="S" (
        echo Cerrando procesos en 3010 y 3011...
        for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3010 .*LISTENING" /c:":3011 .*LISTENING"') do (
            taskkill /PID %%p /F >nul 2>&1
        )
        timeout /t 2 /nobreak >nul
        echo OK: procesos anteriores cerrados.
    ) else (
        echo Cancelado. Cierra esta ventana; la app anterior sigue corriendo.
        pause
        exit /b 0
    )
)

REM 2. Instalar dependencias si hace falta
echo.
echo [2/4] Verificando dependencias...
if not exist "node_modules\" (
    echo Instalando dependencias ^(puede tardar unos minutos^)...
    call npm install
    if errorlevel 1 (
        echo ERROR: Fallo la instalacion de dependencias.
        pause
        exit /b 1
    )
) else (
    echo OK: Dependencias ya instaladas.
)

REM 3. Compilar packages y API
echo.
echo [3/4] Compilando codigo ^(packages + API + Web^)...
call npm run build
if errorlevel 1 (
    echo ERROR: Fallo la compilacion.
    echo Revisa los errores arriba y corrigelos antes de reintentar.
    pause
    exit /b 1
)
echo OK: Compilacion exitosa.

REM 4. Configurar puertos
echo.
echo [4/4] Iniciando servidores...
echo.

REM Puertos fijos: API en 3011, Web en 3010
set PORT=3011

REM Levantar API en ventana separada
echo Iniciando API (puerto %PORT%)...
if not exist "logs\" mkdir logs
start "TESTADO-API" cmd /k "cd /d %~dp0 && set PORT=%PORT% && node apps/api/dist/server.js > logs\api.log 2>&1 & echo API se detuvo (ver logs\api.log) & type logs\api.log & pause"

REM Esperar a que la API arranque
timeout /t 3 /nobreak >nul

REM Levantar Web en esta ventana
echo Iniciando interfaz web (puerto 3010)...
echo.
echo ========================================
echo   Sistema listo!
echo ========================================
echo.
echo   Interfaz:  http://localhost:3010
echo.
echo   Para acceso desde otros equipos en la red,
echo   usa la IP de este equipo en lugar de localhost.
echo   (Ejemplo: http://192.168.1.X:3010)
echo   La API se accede a traves del mismo puerto,
echo   no es necesario abrir el puerto 3011.
echo.
echo   Cierra ESTA ventana para detener la WEB.
echo   Cierra la ventana TESTADO-API para detener la API.
echo.

cd /d %~dp0\apps\web && set ADMIN_PASSWORD=testado2026 && npx next start -p 3010
echo.
echo El proceso WEB se detuvo. Revisa el error arriba.
pause
