# Puts the startup shortcut of the journal server in, takes it out, or tells whether it is there.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Install | -Remove | -Status [-StartupDir <folder>] [-Name <shortcut name>]
# Nothing else in the system is changed.
param(
  [switch]$Install,
  [switch]$Remove,
  [switch]$Status,
  [string]$StartupDir = [Environment]::GetFolderPath('Startup'),
  [string]$Name = 'Journal server'
)
$ErrorActionPreference = 'Stop'
if (@($Install, $Remove, $Status | Where-Object { $_ }).Count -ne 1) {
  Write-Output 'Use exactly one of: -Install, -Remove, -Status'
  exit 2
}
$link = Join-Path $StartupDir ($Name + '.lnk')
$script = Join-Path $PSScriptRoot 'serve-hidden.vbs'

if ($Install) {
  if (-not (Test-Path -LiteralPath $script)) { Write-Output "Not found: $script"; exit 1 }
  New-Item -ItemType Directory -Force -Path $StartupDir | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $shortcut.Arguments = '"' + $script + '"'
  $shortcut.WorkingDirectory = Split-Path -Parent $PSScriptRoot
  $shortcut.Save()
  Write-Output "Installed: $link"
  exit 0
}
if ($Remove) {
  if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link -Force; Write-Output "Removed: $link" }
  else { Write-Output "Not installed: $link" }
  exit 0
}
if (Test-Path -LiteralPath $link) {
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
  Write-Output "Installed: $link"
  Write-Output ("Runs: " + $shortcut.TargetPath + ' ' + $shortcut.Arguments)
  exit 0
}
Write-Output "Not installed: $link"
exit 1
