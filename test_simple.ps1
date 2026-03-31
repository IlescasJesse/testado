# Simple test script - process one PDF with preset
Set-Location "C:\Users\ilesm\Desktop\testado"

# Kill existing process
$line = (netstat -ano | findstr ':3001' | Select-Object -First 1)
if ($line) {
  $processId = ($line -replace '\s+',' ' -split ' ')[-1]
  taskkill /PID $processId /F /T | Out-Null
  Start-Sleep -Seconds 1
}

# Start server and capture output
Write-Output "Starting server..."
$serverProcess = Start-Process -FilePath node -ArgumentList 'server.js' -NoNewWindow -PassThru

# Wait for server
Start-Sleep -Seconds 2

# Get first PDF
$contract = (Get-ChildItem -Path ".\contratos\" -Filter "*.pdf" | Select-Object -First 1).Name
Write-Output "Using: $contract"

# Get active preset
Write-Output "Checking active preset..."
$active = Invoke-RestMethod "http://localhost:3001/api/config/active" -ErrorAction SilentlyContinue
if ($active -and $active.presetName) {
  Write-Output "Preset: $($active.presetName)"
  
  # Load preset config
  $presetConfig = Invoke-RestMethod "http://localhost:3001/api/config/load?name=$([System.Uri]::EscapeDataString($active.presetName))" -ErrorAction SilentlyContinue
  
  if ($presetConfig) {
    Write-Output "Preset config loaded, sending POST..."
    $regionsMap = @{}
    $regionsMap[$contract] = $presetConfig
    $regionsMap | ConvertTo-Json -Depth 10 | Out-File -Encoding UTF8 ".\regions.json"
    
    Write-Output "Regions JSON content:"
    Get-Content ".\regions.json"
    
    Write-Output "Posting to /api/process..."
    curl.exe -s -X POST "http://localhost:3001/api/process" `
      -F "files=@.\contratos\$contract" `
      -F "regions=@.\regions.json;type=application/json"
  }
}

# Wait a bit for processing
Start-Sleep -Seconds 3

# Check output
if (Test-Path ".\tested_Censurado\$contract") {
  Write-Output "Output file exists"
  $size = (Get-Item ".\tested_Censurado\$contract").Length
  Write-Output "Size: $size bytes"
} else {
  Write-Output "Output file NOT found"
}

# Stop server
Write-Output "Stopping server..."
$serverProcess | Stop-Process -Force
