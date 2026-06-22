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

# Package (vsce automatically runs vscode:prepublish)
$packageName = "workspace-file-explorer-$((Get-Content package.json | ConvertFrom-Json).version).vsix"
$packagePath = Join-Path $PSScriptRoot $packageName

if (Test-Path -LiteralPath $packagePath) {
    Remove-Item -LiteralPath $packagePath -Force
}

Run-Step "Package" {
    vsce package --out $packagePath
}

if (-not (Test-Path -LiteralPath $packagePath)) {
    Write-Host "ERROR: No .vsix file found" -ForegroundColor Red
    exit 1
}
Write-Host "Using package: $packageName" -ForegroundColor Green

# Publish to VS Code Marketplace
Run-Step "Publish to VS Code Marketplace" {
    vsce publish --packagePath $packagePath -p $VsceToken
}

# Publish to Open VSX (Cursor Marketplace)
Run-Step "Publish to Open VSX (Cursor)" {
    ovsx publish $packagePath -p $OvsxToken
}

Write-Host "`nAll done!" -ForegroundColor Green
