# Installs the claude CLI on PATH from the desktop app's bundled copy, then starts it once
# so you can pick a theme and log in. Clears CLAUDE* vars inherited from the desktop app
# first, so the CLI uses its own login instead of the host session's.
Get-ChildItem env: | Where-Object { $_.Name -match '^CLAUDE' } | ForEach-Object { Remove-Item "env:$($_.Name)" }

$bundled = Get-ChildItem "$env:LOCALAPPDATA\Claude-Data" -Recurse -Filter claude.exe -Depth 5 |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
Write-Host "Installing from $bundled"
& $bundled install

$installed = "$env:USERPROFILE\.local\bin\claude.exe"
if (-not (Test-Path $installed)) { Write-Host "Install did not create $installed; stopping."; exit 1 }
$env:PATH = "$env:USERPROFILE\.local\bin;$env:PATH"

Write-Host ""
Write-Host "Now pick a theme and log in. When you see the prompt box, type /exit and press Enter."
& $installed
Write-Host ""
& $installed auth status
