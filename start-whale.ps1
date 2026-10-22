param([switch]$NoBrowser,[switch]$Quiet)
& (Join-Path $PSScriptRoot 'distribution\control.ps1') -Action start -NoBrowser:$NoBrowser
