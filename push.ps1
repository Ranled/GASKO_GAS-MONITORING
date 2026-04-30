# GasKo Auto-Version Push Script
# Usage: .\push.ps1 "your commit message"
# Automatically bumps version patch (1.0.1 -> 1.0.2), commits, and pushes.

param(
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$versionFile = "$PSScriptRoot\version.js"

# Read current version from version.js
$content = Get-Content $versionFile -Raw
if ($content -match "GASKO_VERSION = '(\d+)\.(\d+)\.(\d+)'") {
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    $patch = [int]$Matches[3]
} else {
    Write-Host "ERROR: Could not find version in version.js" -ForegroundColor Red
    exit 1
}

# Bump patch version
$patch++
$newVersion = "$major.$minor.$patch"

# Write back to version.js
$newContent = $content -replace "GASKO_VERSION = '\d+\.\d+\.\d+'", "GASKO_VERSION = '$newVersion'"
Set-Content $versionFile $newContent -NoNewline

Write-Host "Version bumped: $major.$minor.$($patch-1) -> $newVersion" -ForegroundColor Cyan

# Git add, commit, push
git add .
git commit -m "v$newVersion - $Message"
git push origin main

Write-Host ""
Write-Host "Pushed v$newVersion to GitHub!" -ForegroundColor Green
