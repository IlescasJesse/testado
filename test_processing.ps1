# Script de prueba para procesar PDF con preset activo
param([switch]$KillServer)

$ErrorActionPreference = "Stop"

Set-Location "C:\Users\ilesm\Desktop\testado"

# Matar proceso existente en puerto 3001 si está activo
Write-Output "Verificando puerto 3001..."
$line = (netstat -ano | findstr ':3001' | Select-Object -First 1)
if ($line) {
  $processId = ($line -replace '\s+',' ' -split ' ')[-1]
  Write-Output "Matando PID $processId en puerto 3001..."
  taskkill /PID $processId /F /T | Out-Null
  Start-Sleep -Seconds 1
}

# Iniciar servidor en background
Write-Output "Iniciando servidor Node.js..."
$serverProcess = Start-Process -FilePath node -ArgumentList 'server.js' -WindowStyle Hidden -PassThru

# Esperar a que el servidor responda
Write-Output "Esperando a que servidor responda..."
$retries = 0
$maxRetries = 15
$serverReady = $false

while ($retries -lt $maxRetries) {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001" -UseBasicParsing -TimeoutSec 2
    $serverReady = $true
    Write-Output "Servidor listo!"
    break
  } catch {
    $retries++
    Start-Sleep -Seconds 1
  }
}

if (-not $serverReady) {
  Write-Output "El servidor no respondió en tiempo límite"
  $serverProcess | Stop-Process -Force
  exit 1
}

# Obtener primer PDF de contratos/
Write-Output "Buscando PDF en carpeta contratos/..."
$contractObj = Get-ChildItem -Path ".\contratos\" -Filter "*.pdf" | Select-Object -First 1

if (-not $contractObj) {
  Write-Output "No hay PDFs en carpeta contratos/"
  $serverProcess | Stop-Process -Force
  exit 0
}

$contract = $contractObj.Name
Write-Output "Usando contrato: $contract"

# Obtener preset activo
Write-Output "Consultando preset activo..."
$active = $null
try {
  $active = Invoke-RestMethod "http://localhost:3001/api/config/active" -ErrorAction Stop
} catch {
  Write-Output "No se pudo obtener preset activo: $_"
}

if ($active -and $active.presetName) {
  Write-Output "Preset activo encontrado: $($active.presetName)"
  
  # Cargar configuración del preset
  try {
    $presetConfig = Invoke-RestMethod "http://localhost:3001/api/config/load?name=$([System.Uri]::EscapeDataString($active.presetName))" -ErrorAction Stop
    
    if ($presetConfig) {
      Write-Output "Configuración del preset cargada"
      
      # Crear JSON con regiones
      $regionsMap = @{}
      $regionsMap[$contract] = $presetConfig
      $regionsJson = $regionsMap | ConvertTo-Json -Depth 10
      $regionsJson | Out-File -Encoding UTF8 ".\regions.json"
      
      Write-Output "Enviando PDF con regiones del preset..."
      curl.exe -s -X POST "http://localhost:3001/api/process" `
        -F "files=@.\contratos\$contract" `
        -F "regions=@.\regions.json;type=application/json" `
        -o ".\response.json"
      
      Write-Output "Respuesta del servidor:"
      Get-Content ".\response.json"
    } else {
      Write-Output "No se pudo cargar configuración del preset; enviando sin regiones..."
      curl.exe -s -X POST "http://localhost:3001/api/process" `
        -F "files=@.\contratos\$contract" `
        -o ".\response.json"
      Get-Content ".\response.json"
    }
  } catch {
    Write-Output "Error cargando preset: $_"
    curl.exe -s -X POST "http://localhost:3001/api/process" `
      -F "files=@.\contratos\$contract" `
      -o ".\response.json"
    Get-Content ".\response.json"
  }
} else {
  Write-Output "No hay preset activo; enviando PDF sin regiones..."
  curl.exe -s -X POST "http://localhost:3001/api/process" `
    -F "files=@.\contratos\$contract" `
    -o ".\response.json"
  Get-Content ".\response.json"
}

# Verificar si se generó archivo procesado
Start-Sleep -Seconds 2
Write-Output ""
Write-Output "Verificando archivo procesado..."
if (Test-Path ".\tested_Censurado\$contract") {
  Write-Output "✅ Archivo procesado encontrado en: tested_Censurado\$contract"
  $fileSize = (Get-Item ".\tested_Censurado\$contract").Length
  Write-Output "Tamaño: $fileSize bytes"
} else {
  Write-Output "❌ Archivo procesado no encontrado"
}

# Limpiar
Write-Output "Deteniendo servidor..."
$serverProcess | Stop-Process -Force
Write-Output "Prueba completada"
