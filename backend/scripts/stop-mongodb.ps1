param([int]$Port = 27017)

$ErrorActionPreference = 'Stop'
$backend = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $backend '.data\mongod.pid'

if (Test-Path $pidFile) {
  $mongodPid = Get-Content $pidFile | Select-Object -First 1
  $process = Get-Process -Id $mongodPid -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $mongodPid
    Write-Host "mongod (PID $mongodPid) dihentikan."
  } else {
    Write-Host 'PID tersimpan sudah tidak berjalan.'
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
} else {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($listener) {
    Write-Host "PID tidak tercatat. Hentikan proses pemilik port $Port secara manual."
  } else {
    Write-Host "Tidak ada MongoDB yang berjalan di port $Port."
  }
}
