param(
  [int]$Port = 8765,
  [string]$StorePath = (Join-Path $env:LOCALAPPDATA "MobileExamFelica\bindings.dat"),
  [switch]$Probe
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class WinSCardNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct SCARD_IO_REQUEST {
    public UInt32 dwProtocol;
    public UInt32 cbPciLength;
  }

  [DllImport("winscard.dll")]
  public static extern int SCardEstablishContext(UInt32 scope, IntPtr reserved1, IntPtr reserved2, out IntPtr context);
  [DllImport("winscard.dll", CharSet = CharSet.Unicode)]
  public static extern int SCardListReaders(IntPtr context, string groups, char[] readers, ref UInt32 readersLength);
  [DllImport("winscard.dll", CharSet = CharSet.Unicode)]
  public static extern int SCardConnect(IntPtr context, string reader, UInt32 shareMode, UInt32 preferredProtocols, out IntPtr card, out UInt32 activeProtocol);
  [DllImport("winscard.dll")]
  public static extern int SCardTransmit(IntPtr card, ref SCARD_IO_REQUEST sendPci, byte[] sendBuffer, UInt32 sendLength, IntPtr recvPci, byte[] recvBuffer, ref UInt32 recvLength);
  [DllImport("winscard.dll")]
  public static extern int SCardDisconnect(IntPtr card, UInt32 disposition);
  [DllImport("winscard.dll")]
  public static extern int SCardReleaseContext(IntPtr context);
}
"@

function Assert-SCardResult([int]$Result, [string]$Operation) {
  if ($Result -ne 0) {
    $hex = ('0x{0:X8}' -f ([uint32]$Result))
    throw "$Operation failed ($hex)"
  }
}

function Get-FelicaCard {
  $context = [IntPtr]::Zero
  $card = [IntPtr]::Zero
  try {
    Assert-SCardResult ([WinSCardNative]::SCardEstablishContext(2, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$context)) "SCardEstablishContext"
    [uint32]$length = 0
    $result = [WinSCardNative]::SCardListReaders($context, $null, $null, [ref]$length)
    Assert-SCardResult $result "SCardListReaders"
    $buffer = New-Object char[] $length
    Assert-SCardResult ([WinSCardNative]::SCardListReaders($context, $null, $buffer, [ref]$length)) "SCardListReaders"
    $readers = (-join $buffer).Trim([char]0).Split([char]0) | Where-Object { $_ }
    $reader = $readers | Where-Object { $_ -match 'FeliCa|PaSoRi|SONY' } | Select-Object -First 1
    if (-not $reader) { $reader = $readers | Select-Object -First 1 }
    if (-not $reader) { throw "No smart-card reader was found." }

    [uint32]$protocol = 0
    Assert-SCardResult ([WinSCardNative]::SCardConnect($context, $reader, 2, 3, [ref]$card, [ref]$protocol)) "SCardConnect"
    $pci = New-Object WinSCardNative+SCARD_IO_REQUEST
    $pci.dwProtocol = $protocol
    $pci.cbPciLength = [Runtime.InteropServices.Marshal]::SizeOf([type][WinSCardNative+SCARD_IO_REQUEST])
    [byte[]]$command = 0xFF, 0xCA, 0x00, 0x00, 0x00
    [byte[]]$response = New-Object byte[] 64
    [uint32]$responseLength = $response.Length
    Assert-SCardResult ([WinSCardNative]::SCardTransmit($card, [ref]$pci, $command, $command.Length, [IntPtr]::Zero, $response, [ref]$responseLength)) "SCardTransmit"
    if ($responseLength -lt 10 -or $response[$responseLength - 2] -ne 0x90 -or $response[$responseLength - 1] -ne 0x00) {
      throw "The card did not return a valid FeliCa IDm."
    }
    $idm = (($response[0..7] | ForEach-Object { $_.ToString('X2') }) -join '')
    [ordered]@{ ok = $true; reader = $reader; idm = $idm }
  } finally {
    if ($card -ne [IntPtr]::Zero) { [void][WinSCardNative]::SCardDisconnect($card, 0) }
    if ($context -ne [IntPtr]::Zero) { [void][WinSCardNative]::SCardReleaseContext($context) }
  }
}

function Read-Bindings {
  if (-not (Test-Path -LiteralPath $StorePath)) { return @{} }
  $encrypted = [IO.File]::ReadAllBytes($StorePath)
  $plain = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $json = [Text.Encoding]::UTF8.GetString($plain)
  $object = $json | ConvertFrom-Json -AsHashtable
  if ($null -eq $object) { return @{} }
  return $object
}

function Write-Bindings([hashtable]$Bindings) {
  $directory = Split-Path -Parent $StorePath
  [IO.Directory]::CreateDirectory($directory) | Out-Null
  $json = $Bindings | ConvertTo-Json -Depth 8 -Compress
  $plain = [Text.Encoding]::UTF8.GetBytes($json)
  $encrypted = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $temp = "$StorePath.tmp"
  [IO.File]::WriteAllBytes($temp, $encrypted)
  Move-Item -LiteralPath $temp -Destination $StorePath -Force
}

function Get-RequestBody($Reader, [int]$ContentLength) {
  if ($ContentLength -le 0) { return @{} }
  if ($ContentLength -gt 65536) { throw "Request body is too large." }
  $chars = New-Object char[] $ContentLength
  $read = 0
  while ($read -lt $ContentLength) {
    $count = $Reader.Read($chars, $read, $ContentLength - $read)
    if ($count -le 0) { break }
    $read += $count
  }
  $json = -join $chars[0..($read - 1)]
  if (-not $json) { return @{} }
  return $json | ConvertFrom-Json -AsHashtable
}

$allowedOrigins = @(
  "https://mobile-exam-entry-b6w9-z574.onrender.com",
  "http://127.0.0.1:4173",
  "http://localhost:4173"
)

function Send-Response($Writer, [int]$Status, $Payload, [string]$Origin = "") {
  $json = $Payload | ConvertTo-Json -Depth 8 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $statusText = if ($Status -eq 200) { "OK" } elseif ($Status -eq 204) { "No Content" } elseif ($Status -eq 400) { "Bad Request" } elseif ($Status -eq 403) { "Forbidden" } elseif ($Status -eq 404) { "Not Found" } elseif ($Status -eq 409) { "Conflict" } else { "Internal Server Error" }
  $Writer.Write("HTTP/1.1 $Status $statusText`r`n")
  $Writer.Write("Content-Type: application/json; charset=utf-8`r`n")
  $Writer.Write("Content-Length: $($bytes.Length)`r`n")
  $Writer.Write("Cache-Control: no-store`r`n")
  if ($Origin -and $allowedOrigins -contains $Origin) {
    $Writer.Write("Access-Control-Allow-Origin: $Origin`r`n")
    $Writer.Write("Vary: Origin`r`n")
    $Writer.Write("Access-Control-Allow-Private-Network: true`r`n")
    $Writer.Write("Access-Control-Allow-Headers: Content-Type`r`n")
    $Writer.Write("Access-Control-Allow-Methods: GET, POST, OPTIONS`r`n")
  }
  $Writer.Write("Connection: close`r`n`r`n")
  $Writer.Flush()
  if ($bytes.Length) { $Writer.BaseStream.Write($bytes, 0, $bytes.Length); $Writer.BaseStream.Flush() }
}

if ($Probe) {
  Get-FelicaCard | ConvertTo-Json -Compress
  exit 0
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "Mobile Exam FeliCa helper"
Write-Host "Listening only on http://127.0.0.1:$Port"
Write-Host "Press Ctrl+C to stop. No card data is written by this version."

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 5000
      $stream = $client.GetStream()
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 4096, $true)
      $writer = [IO.StreamWriter]::new($stream, [Text.Encoding]::ASCII, 4096, $true)
      $writer.NewLine = "`r`n"
      $requestLine = $reader.ReadLine()
      if (-not $requestLine) { continue }
      $parts = $requestLine.Split(' ')
      $method = $parts[0].ToUpperInvariant()
      $path = $parts[1].Split('?')[0]
      $headers = @{}
      while ($true) {
        $line = $reader.ReadLine()
        if ([string]::IsNullOrEmpty($line)) { break }
        $separator = $line.IndexOf(':')
        if ($separator -gt 0) { $headers[$line.Substring(0, $separator).Trim().ToLowerInvariant()] = $line.Substring($separator + 1).Trim() }
      }
      $origin = [string]$headers['origin']
      if ($origin -and $allowedOrigins -notcontains $origin) {
        Send-Response $writer 403 @{ ok = $false; error = "Origin is not allowed." }
        continue
      }
      if ($method -eq 'OPTIONS') {
        Send-Response $writer 204 @{} $origin
        continue
      }
      $contentLength = if ($headers.ContainsKey('content-length')) { [int]$headers['content-length'] } else { 0 }
      $body = Get-RequestBody $reader $contentLength
      if ($method -eq 'GET' -and $path -eq '/health') {
        Send-Response $writer 200 @{ ok = $true; service = "mobile-exam-felica-helper"; version = "0.1.0" } $origin
      } elseif ($method -eq 'POST' -and $path -eq '/card/read') {
        Send-Response $writer 200 (Get-FelicaCard) $origin
      } elseif ($method -eq 'POST' -and $path -eq '/binding/lookup') {
        $idm = ([string]$body.idm).Trim().ToUpperInvariant()
        if ($idm -notmatch '^[0-9A-F]{16}$') { Send-Response $writer 400 @{ ok = $false; error = "Invalid IDm." } $origin; continue }
        $bindings = Read-Bindings
        Send-Response $writer 200 @{ ok = $true; binding = $bindings[$idm] } $origin
      } elseif ($method -eq 'POST' -and $path -eq '/binding/save') {
        $idm = ([string]$body.idm).Trim().ToUpperInvariant()
        $patientCode = ([string]$body.patientCode).Trim()
        $groupId = ([string]$body.groupId).Trim()
        if ($idm -notmatch '^[0-9A-F]{16}$' -or -not $patientCode -or -not $groupId) { Send-Response $writer 400 @{ ok = $false; error = "IDm, patientCode and groupId are required." } $origin; continue }
        $bindings = Read-Bindings
        $existing = $bindings[$idm]
        if ($existing -and -not [bool]$body.overwrite -and ($existing.patientCode -ne $patientCode -or $existing.groupId -ne $groupId)) {
          Send-Response $writer 409 @{ ok = $false; error = "Card is already bound."; binding = $existing } $origin
          continue
        }
        $now = [DateTime]::UtcNow.ToString('o')
        $bindings[$idm] = @{ idm = $idm; patientCode = $patientCode; groupId = $groupId; createdAt = $(if ($existing.createdAt) { $existing.createdAt } else { $now }); updatedAt = $now }
        Write-Bindings $bindings
        Send-Response $writer 200 @{ ok = $true; binding = $bindings[$idm] } $origin
      } else {
        Send-Response $writer 404 @{ ok = $false; error = "Not found." } $origin
      }
    } catch {
      try { Send-Response $writer 500 @{ ok = $false; error = $_.Exception.Message } $origin } catch {}
    } finally {
      $client.Dispose()
    }
  }
} finally {
  $listener.Stop()
}
