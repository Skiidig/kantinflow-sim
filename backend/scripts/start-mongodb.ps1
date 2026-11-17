param(
  [int]$Port = 27017,
  [string]$ReplicaSet = 'rs0'
)

$ErrorActionPreference = 'Stop'
$backend = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $backend '.tools\mongodb'
$zip = Join-Path $backend '.tools\mongodb.zip'
$dataDir = Join-Path $backend '.data\mongodb'
$logFile = Join-Path $backend '.data\mongod.log'
$pidFile = Join-Path $backend '.data\mongod.pid'
$downloadUrl = 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-7.0.14.zip'

function Find-Mongod {
  if (-not (Test-Path $toolsDir)) { return $null }
  return Get-ChildItem $toolsDir -Recurse -Filter 'mongod.exe' -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

$mongod = Find-Mongod
if (-not $mongod) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $zip) | Out-Null
  if (-not (Test-Path $zip)) {
    Write-Host "Mengunduh MongoDB portabel (~620 MB, sekali saja)..."
    $partial = "$zip.part"
    & curl.exe -L --fail --show-error -o $partial $downloadUrl
    if ($LASTEXITCODE -ne 0) {
      Remove-Item $partial -ErrorAction SilentlyContinue
      throw 'Unduhan MongoDB gagal. Periksa koneksi internet lalu coba lagi.'
    }
    Move-Item $partial $zip
  }
  Write-Host 'Mengekstrak MongoDB...'
  New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
  & tar.exe -xf $zip -C $toolsDir
  if ($LASTEXITCODE -ne 0) { throw 'Ekstraksi MongoDB gagal.' }
  $mongod = Find-Mongod
  if (-not $mongod) { throw 'mongod.exe tidak ditemukan setelah ekstraksi.' }
}

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logFile) | Out-Null

$alreadyRunning = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $alreadyRunning) {
  $arguments = @(
    '--dbpath', $dataDir,
    '--port', "$Port",
    '--bind_ip', '127.0.0.1',
    '--replSet', $ReplicaSet,
    '--logpath', $logFile,
    '--logappend'
  )
  $process = Start-Process -FilePath $mongod.FullName -ArgumentList $arguments -WindowStyle Hidden -PassThru
  $process.Id | Set-Content -Path $pidFile

  $deadline = (Get-Date).AddSeconds(30)
  $ready = $false
  do {
    $tcp = [System.Net.Sockets.TcpClient]::new()
    try {
      $tcp.Connect('127.0.0.1', $Port)
      $ready = $true
    } catch {
      Start-Sleep -Milliseconds 500
    } finally {
      $tcp.Dispose()
    }
  } until ($ready -or (Get-Date) -gt $deadline)
  if (-not $ready) { throw "MongoDB tidak siap di port $Port. Lihat $logFile." }
  Write-Host "mongod berjalan (PID $($process.Id)) di 127.0.0.1:$Port."
} else {
  Write-Host "Port $Port sudah memiliki proses yang mendengarkan; memakai MongoDB yang ada."
}

& node (Join-Path $PSScriptRoot 'init-replica.mjs') $Port $ReplicaSet
if ($LASTEXITCODE -ne 0) { throw 'Inisialisasi replica set gagal.' }

Write-Host ''
Write-Host 'Langkah berikutnya:'
Write-Host '  npm.cmd run seed:reset'
Write-Host '  npm.cmd start'
