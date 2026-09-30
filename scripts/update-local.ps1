param(
  [string]$CodePath,
  [string]$Profile,
  [switch]$InstallOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$installRecordPath = Join-Path $projectRoot 'artifacts/local-install.json'
$previousTarget = if (Test-Path -LiteralPath $installRecordPath) { Get-Content -LiteralPath $installRecordPath -Raw | ConvertFrom-Json } else { $null }

if (-not $CodePath) {
  $CodePath = if ($env:ALWAYGIT_CODE_CLI) { $env:ALWAYGIT_CODE_CLI } elseif ($previousTarget.codePath) { $previousTarget.codePath } else { (Get-Command code -ErrorAction Stop).Source }
}
if (-not $PSBoundParameters.ContainsKey('Profile')) {
  $Profile = if ($env:ALWAYGIT_VSCODE_PROFILE) { $env:ALWAYGIT_VSCODE_PROFILE } else { $previousTarget.profile }
}
$cliPath = (Get-Command $CodePath -ErrorAction Stop).Source
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$extensionId = "$($manifest.publisher).$($manifest.name)"
$profileArguments = if ($Profile) { @('--profile', $Profile) } else { @() }

Push-Location -LiteralPath $projectRoot
try {
  if (-not $InstallOnly) {
    & node (Join-Path $PSScriptRoot 'package.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Packaging failed. The installed extension was not changed.' }
  }
  $packagePath = Join-Path $projectRoot 'artifacts/alwaygit.vsix'
  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { throw "Missing package: $packagePath" }

  # Validate the archive even when InstallOnly skips the build.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($packagePath)
  try {
    $entry = $archive.GetEntry('extension/package.json')
    if ($null -eq $entry) { throw 'The package does not contain an extension manifest.' }
    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { $packagedManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  } finally { $archive.Dispose() }
  if ("$($packagedManifest.publisher).$($packagedManifest.name)" -ne $extensionId -or $packagedManifest.version -ne $manifest.version) {
    throw 'Package identity or version differs from the project. Rebuild before installing.'
  }

  Write-Output "Installing $extensionId@$($manifest.version) using $cliPath (Profile: $(if ($Profile) { $Profile } else { 'default' }))"
  & $cliPath --install-extension $packagePath --force @profileArguments
  if ($LASTEXITCODE -ne 0) { throw 'VS Code installation failed. Do not report the update as installed.' }
  $installed = @(& $cliPath --list-extensions --show-versions @profileArguments)
  if ($LASTEXITCODE -ne 0 -or $installed -notcontains "$extensionId@$($manifest.version)") {
    throw 'Could not verify the installed extension version.'
  }
  $record = [ordered]@{ codePath = $cliPath; profile = $Profile; extensionId = $extensionId; version = $manifest.version; sha256 = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash; installedAt = [DateTime]::UtcNow.ToString('o') }
  $record | ConvertTo-Json | Set-Content -LiteralPath $installRecordPath -Encoding UTF8
  Write-Output "Installed and verified: $extensionId@$($manifest.version). Restart VS Code when convenient."
} finally {
  Pop-Location
}
