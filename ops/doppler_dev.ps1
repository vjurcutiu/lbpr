$ErrorActionPreference = "Stop"

if (-not $env:DOPPLER_PROJECT) { throw "DOPPLER_PROJECT missing" }
if (-not $env:DOPPLER_CONFIG_FRONTEND) { throw "DOPPLER_CONFIG_FRONTEND missing" }
if (-not $env:DOPPLER_CONFIG_BACKEND) { throw "DOPPLER_CONFIG_BACKEND missing" }
if (-not $env:DOPPLER_TOKEN_SPA) { throw "DOPPLER_TOKEN_SPA missing" }
if (-not $env:DOPPLER_TOKEN_API) { throw "DOPPLER_TOKEN_API missing" }

Write-Host "[doppler] writing static/spa/.env"
Push-Location "static/spa"
$env:DOPPLER_TOKEN = $env:DOPPLER_TOKEN_SPA
doppler secrets download `
  --no-file `
  --format env `
  --project $env:DOPPLER_PROJECT `
  --config $env:DOPPLER_CONFIG_FRONTEND |
  Out-File -Encoding ascii ".env"
Pop-Location

Write-Host "[doppler] writing backend/.env"
Push-Location "backend"
$env:DOPPLER_TOKEN = $env:DOPPLER_TOKEN_API
doppler secrets download `
  --no-file `
  --format env `
  --project $env:DOPPLER_PROJECT `
  --config $env:DOPPLER_CONFIG_BACKEND |
  Out-File -Encoding ascii ".env"
Pop-Location
