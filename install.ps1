<#
.SYNOPSIS
    Install the Aether CLI on Windows.

.DESCRIPTION
    Detects Node.js (>= 20), offers to install via winget if missing,
    clones or updates the repo, installs dependencies, and links the
    CLI onto PATH.

.PARAMETER Yes
    Run non-interactively (assume "yes" to all prompts).
#>
[CmdletBinding()]
param(
    [switch]$Yes
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$RepoUrl   = "https://github.com/hemansubedi10/aether.git"
$MinNode   = 20
$InstallRoot = if ($env:AETHER_INSTALL_DIR) { $env:AETHER_INSTALL_DIR } else { "$env:USERPROFILE\.aether" }
$BinDir     = if ($env:AETHER_BIN_DIR)  { $env:AETHER_BIN_DIR }  else { "$env:USERPROFILE\.local\bin" }

function Say($msg)   { Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn($msg)  { Write-Warning $msg }
function Err($msg)   { Write-Error $msg }
function Die($msg)   { Write-Error "error: $msg"; exit 1 }

# ---------------------------------------------------------------------------
# OS check
# ---------------------------------------------------------------------------
if ($IsWindows -ne $true) {
    if ($IsLinux -eq $true -or $IsMacOS -eq $true) {
        Die "This installer is for Windows. Use install.sh instead: bash install.sh"
    }
}
Say "Detected platform: Windows"

# ---------------------------------------------------------------------------
# Node.js check
# ---------------------------------------------------------------------------
function Get-NodeMajorVersion {
    $p = Get-Command node -ErrorAction SilentlyContinue
    if (-not $p) { return $null }
    try {
        $v = (& node -p "process.version" 2>$null)
        if ($v -match '\d+') { return [int]$Matches[0] }
    } catch {}
    return $null
}

$nodeMajor = Get-NodeMajorVersion
if (-not $nodeMajor) {
    Say "Node.js >= v$MinNode not found."
    $install = $false
    if ($Yes) {
        $install = $true
    } else {
        $ans = Read-Host "Install Node.js now via winget? [Y/n]"
        if ([string]::IsNullOrWhiteSpace($ans)) { $ans = "y" }
        $install = ($ans -match '^(y|yes)$')
    }
    if (-not $install) {
        Die "Node.js >= v$MinNode is required. Install it manually from https://nodejs.org and re-run this script."
    }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Die "winget not found. Install Node.js manually from https://nodejs.org and re-run this script."
    }
    Say "Installing Node.js via winget..."
    winget install --id OpenJS.NodeJS --source winget --silent --accept-source-agreements
    $env:PATH = "$env:ProgramFiles\nodejs;$env:PATH"
    $nodeMajor = Get-NodeMajorVersion
    if (-not $nodeMajor) { Die "Node.js install failed. Install it manually from https://nodejs.org." }
}

if ($nodeMajor -lt $MinNode) {
    Die "Node.js v$nodeMajor detected, but >= v$MinNode is required. Install Node.js >= v$MinNode from https://nodejs.org."
}
Say "Node.js $(node -v) detected."

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Die "npm not found. Reinstall Node.js from https://nodejs.org (include npm)."
}

# ---------------------------------------------------------------------------
# Acquire the source
# ---------------------------------------------------------------------------
$repoDir = Join-Path $InstallRoot "repo"
if (Test-Path $repoDir) {
    if (Test-Path (Join-Path $repoDir ".git")) {
        Say "Updating existing checkout at $repoDir ..."
        & git -C $repoDir fetch --depth=1 origin
        & git -C $repoDir reset --hard origin/main
        & git -C $repoDir clean -fd
    } else {
        Say "Existing directory at $repoDir is not a git repo. Removing it..."
        Remove-Item -Recurse -Force $repoDir
        Say "Cloning $RepoUrl ..."
        & git clone --depth 1 $RepoUrl $repoDir
    }
} else {
    Say "Cloning $RepoUrl ..."
    & git clone --depth 1 $RepoUrl $repoDir
}

# ---------------------------------------------------------------------------
# Install dependencies
# ---------------------------------------------------------------------------
Say "Installing npm dependencies..."
& npm install --no-audit --no-fund --prefix $repoDir

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
if (Test-Path (Join-Path $repoDir "package.json")) {
    $pkg = Get-Content (Join-Path $repoDir "package.json") -Raw
    if ($pkg -match '"build"') {
        Say "Building TypeScript..."
        try {
            & npm run build --prefix $repoDir
        } catch {
            Warn "Build failed; the CLI will run via tsx instead."
        }
    }
}

# ---------------------------------------------------------------------------
# Link the CLI onto PATH
# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$linkAether      = Join-Path $BinDir "aether.cmd"
$linkAetherShim  = Join-Path $BinDir "aether"
$linkServer      = Join-Path $BinDir "aether-server.cmd"
$linkServerShim  = Join-Path $BinDir "aether-server"

# .cmd wrappers so cmd.exe finds them; shim scripts for PowerShell/WSL.
Set-Content -LiteralPath $linkAether -Value "@echo off`n`"%USERPROFILE%\nodejs\npx.exe`" tsx `"%USERPROFILE%\.aether\repo\src\index.ts`" %*" -Encoding UTF8
Set-Content -LiteralPath $linkServer -Value "@echo off`n`"%USERPROFILE%\nodejs\npx.exe`" tsx `"%USERPROFILE%\.aether\repo\src\server.ts`" %*" -Encoding UTF8
Set-Content -LiteralPath $linkAetherShim -Value "#!/usr/bin/env bash`nexec npx tsx `"$InstallRoot/repo/src/index.ts`" `"$@`" -Encoding UTF8
Set-Content -LiteralPath $linkServerShim -Value "#!/usr/bin/env bash`nexec npx tsx `"$InstallRoot/repo/src/server.ts`" `"$@`" -Encoding UTF8

# Ensure bin dir is on PATH for the current user
$machinePath = [Environment]::GetEnvironmentVariable("PATH", [EnvironmentVariableTarget]::Machine)
$userPath     = [Environment]::GetEnvironmentVariable("PATH", [EnvironmentVariableTarget]::User)
if ($machinePath -notlike "*$BinDir*") {
    Say "Adding $BinDir to machine PATH..."
    [Environment]::SetEnvironmentVariable("PATH", "$machinePath;$BinDir", [EnvironmentVariableTarget]::Machine)
}
if ($userPath -notlike "*$BinDir*") {
    Say "Adding $BinDir to user PATH..."
    [Environment]::SetEnvironmentVariable("PATH", "$userPath;$BinDir", [EnvironmentVariableTarget]::User)
}
$env:PATH = "$BinDir;$env:PATH"

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------
Say "Aether installed successfully."
Write-Host ""
Write-Host "Run it with:"
Write-Host "  aether ""your prompt here"""
Write-Host "  aether                 # interactive TUI"
Write-Host "  aether-server         # start HTTP server"
Write-Host ""
Write-Host "If 'aether' is not found, start a new terminal or run:"
Write-Host "  [Environment]::SetEnvironmentVariable(""PATH"", `"$env:PATH`", ""User"")"
Write-Host ""
Write-Host "Verify:  aether --version"
