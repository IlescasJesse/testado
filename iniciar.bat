@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   TESTADO — Sistema de Contratos
echo ========================================
echo.

REM ─────────────────────────────────────────
REM 1. Verificar Node.js
REM ─────────────────────────────────────────
echo [1/4] Verificando Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js no esta instalado.
    echo Instala Node.js desde https://nodejs.org/ y vuelve a intentarlo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo OK: Node.js %%v

REM ─────────────────────────────────────────
REM 2. Instalar dependencias si hace falta
REM ─────────────────────────────────────────
echo.
echo [2/4] Verificando dependencias...
if not exist "node_modules\" (
    echo Instalando dependencias (puede tardar unos minutos)...
    call npm install
    if errorlevel 1 (
        echo ERROR: Fallo la instalacion de dependencias.
        pause
        exit /b 1
    )
) else (
    echo OK: Dependencias ya instaladas.
)

REM ─────────────────────────────────────────
REM 3. Compilar packages y API
REM ─────────────────────────────────────────
echo.
echo [3/4] Compilando codigo (packages + API + Web)...
call npm run build
if errorlevel 1 (
    echo ERROR: Fallo la compilacion.
    echo Revisa los errores arriba y corrigelos antes de reintentar.
    pause
    exit /b 1
)
echo OK: Compilacion exitosa.

REM ─────────────────────────────────────────
REM 4. Detectar puerto para la API
REM ─────────────────────────────────────────
echo.
echo [4/4] Iniciando servidores...
echo.

REM Verificar si el puerto 3001 esta libre (legacy server.js puede ocuparlo)
netstat -an | findstr ":3001 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo AVISO: Puerto 3001 ocupado por otro proceso ^(server.js legacy^).
    echo Usando puerto 3010 para la API nueva.
    echo La interfaz web estara en http://localhost:3000
    echo.
    set PORT=3010
    set NEXT_PUBLIC_API_URL=http://localhost:3010
) else (
    echo Puerto 3001 libre. Usando puerto 3001 para la API.
    echo.
    set PORT=3001
)

REM ─────────────────────────────────────────
REM Levantar API en ventana separada
REM ─────────────────────────────────────────
echo Iniciando API (puerto %PORT%)...
start "TESTADO-API" cmd /k "cd /d %~dp0 && set PORT=%PORT% && set NEXT_PUBLIC_API_URL=%NEXT_PUBLIC_API_URL% && node apps/api/dist/server.js"

REM Esperar a que la API arranque
timeout /t 3 /nobreak >nul

REM ─────────────────────────────────────────
REM Levantar Web en esta ventana
REM ─────────────────────────────────────────
echo Iniciando interfaz web (puerto 3000)...
echo.
echo ========================================
echo   Sistema listo!
echo ========================================
echo.
echo   Interfaz:  http://localhost:3000
echo   API:       http://localhost:%PORT%
echo.
echo   Para acceso desde otros equipos en la red,
echo   usa la IP de este equipo en lugar de localhost.
echo   (Ejemplo: http://192.168.1.X:3000)
echo.
echo   Cierra ESTA ventana para detener la WEB.
echo   Cierra la ventana TESTADO-API para detener la API.
echo.

cd /d %~dp0\apps\web && npx next start
