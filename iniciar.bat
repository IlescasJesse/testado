@echo off
echo ========================================
echo   TESTADO - Servidor de Red
echo ========================================
echo.

echo [1/3] Verificando Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js no esta instalado
    echo Por favor instala Node.js desde https://nodejs.org/
    pause
    exit /b 1
)
echo OK: Node.js instalado

echo.
echo [2/3] Instalando dependencias...
if not exist "node_modules\" (
    echo Instalando paquetes npm...
    call npm install
    if errorlevel 1 (
        echo ERROR: Fallo la instalacion de dependencias
        pause
        exit /b 1
    )
) else (
    echo OK: Dependencias ya instaladas
)

echo.
echo [3/3] Iniciando servidor de red...
echo.
echo ========================================
echo   SERVIDOR ACCESIBLE DESDE TODA LA RED
echo ========================================
echo.

node server.js
