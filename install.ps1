# Prefetch installer for Windows
# Usage: irm https://raw.githubusercontent.com/Sph3ricalPeter/prefetch/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
$repo = "Sph3ricalPeter/prefetch"

Write-Host ""
Write-Host "  Prefetch — installing latest release..." -ForegroundColor Cyan
Write-Host ""

# Get latest release info
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
$version = $release.tag_name
Write-Host "  Version: $version" -ForegroundColor DarkGray

# Find the Windows NSIS installer asset
$asset = $release.assets | Where-Object { $_.name -match "x64-setup\.exe$" } | Select-Object -First 1
if (-not $asset) {
    Write-Host "  Error: no Windows installer found in release $version" -ForegroundColor Red
    exit 1
}

$url = $asset.browser_download_url
$fileName = $asset.name
$tempDir = Join-Path $env:TEMP "prefetch-install"
$installerPath = Join-Path $tempDir $fileName

# Download
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

Write-Host "  Downloading $fileName..." -ForegroundColor DarkGray
Invoke-WebRequest -Uri $url -OutFile $installerPath -UseBasicParsing

# Run installer
Write-Host "  Running installer..." -ForegroundColor DarkGray
Start-Process -FilePath $installerPath -Wait

# Cleanup
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "  Prefetch $version installed." -ForegroundColor Green
Write-Host ""
