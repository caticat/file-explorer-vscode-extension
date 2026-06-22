# .\publish.ps1 -VsceToken <你的vsce-token> -OvsxToken <你的ovsx-token>


param(
    [Parameter(Mandatory = $true)]
    [string]$VsceToken,

    [Parameter(Mandatory = $true)]
    [string]$OvsxToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Run-Step {
    param([string]$Name, [scriptblock]$Action)
    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: $Name" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

# Build
Run-Step "Build" {
    npm run compile
}

# Package
Run-Step "Package" {
    vsce package
}

# Get the generated .vsix file
$vsix = Get-ChildItem -Filter "*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $vsix) {
    Write-Host "ERROR: No .vsix file found" -ForegroundColor Red
    exit 1
}
Write-Host "Using package: $($vsix.Name)" -ForegroundColor Green

# Publish to VS Code Marketplace
Run-Step "Publish to VS Code Marketplace" {
    vsce publish -p $VsceToken
}

# Publish to Open VSX (Cursor Marketplace)
Run-Step "Publish to Open VSX (Cursor)" {
    ovsx publish $vsix.FullName -p $OvsxToken
}

Write-Host "`nAll done!" -ForegroundColor Green
