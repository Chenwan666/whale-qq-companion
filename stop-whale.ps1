param([switch]$Background)
& (Join-Path $PSScriptRoot 'distribution\control.ps1') -Action stop
