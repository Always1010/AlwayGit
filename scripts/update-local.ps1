param(
  [string]$CodePath,
  [string]$Profile,
  [switch]$InstallOnly,
  [string]$Target = 'auto',
  [string]$Vsix,
  [switch]$PackageOnly
)

$ErrorActionPreference = 'Stop'
if ($InstallOnly -and $PackageOnly) { throw '-InstallOnly and -PackageOnly cannot be used together.' }
if ($Vsix -and -not $InstallOnly) { throw '-Vsix requires -InstallOnly.' }

# Preserve the previous Windows default: no arguments means build and install.
# For the interactive platform/operation menu, run node scripts/install.mjs.
$installerArguments = @((Join-Path $PSScriptRoot 'install.mjs'), '--target', $Target)
if ($InstallOnly) { $installerArguments += '--install-only' }
elseif ($PackageOnly) { $installerArguments += '--package-only' }
else { $installerArguments += '--build-install' }
if ($CodePath) { $installerArguments += @('--code-path', $CodePath) }
if ($PSBoundParameters.ContainsKey('Profile')) { $installerArguments += "--profile=$Profile" }
if ($Vsix) { $installerArguments += @('--vsix', $Vsix) }

& node @installerArguments
if ($LASTEXITCODE -ne 0) { throw "AlwayGit installer failed (exit code $LASTEXITCODE)." }
