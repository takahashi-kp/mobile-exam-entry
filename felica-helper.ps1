param(
  [int]$Port = 8765,
  [string]$StorePath = (Join-Path $env:LOCALAPPDATA "MobileExamFelica\bindings.dat"),
  [string]$BackupPath = (Join-Path $env:LOCALAPPDATA "MobileExamFelica\card-backups.dat"),
  [string]$NativeExe = (Join-Path $PSScriptRoot "felica-native\bin\mobile-exam-felica.exe"),
  [switch]$Probe,
  [switch]$ProbeBlocks
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

function ConvertTo-Hashtable($Value) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [Collections.IDictionary]) {
    $table = @{}
    foreach ($key in $Value.Keys) { $table[$key] = ConvertTo-Hashtable $Value[$key] }
    return $table
  }
  if ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) {
    return @($Value | ForEach-Object { ConvertTo-Hashtable $_ })
  }
  if ($Value -is [Management.Automation.PSCustomObject]) {
    $table = @{}
    foreach ($property in $Value.PSObject.Properties) { $table[$property.Name] = ConvertTo-Hashtable $property.Value }
    return $table
  }
  return $Value
}

function Invoke-NativeFelicaReader {
  if (-not (Test-Path -LiteralPath $NativeExe)) { return $null }
  $output = & $NativeExe 2>&1
  if (-not $output) { throw "The native FeliCa reader returned no data." }
  $result = ConvertTo-Hashtable ((($output | ForEach-Object { [string]$_ }) -join "`n") | ConvertFrom-Json)
  if (-not $result.ok) { throw ([string]$result.error) }
  return $result
}

function Assert-SCardResult([int]$Result, [string]$Operation) {
  if ($Result -ne 0) {
    $unsignedResult = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$Result), 0)
    $hex = ('0x{0:X8}' -f $unsignedResult)
    if ($hex -eq '0x80100069') { throw "$Operation failed ($hex): The card was removed or reset. Place the card on the reader again." }
    throw "$Operation failed ($hex)"
  }
}

function Get-FelicaCard {
  $native = Invoke-NativeFelicaReader
  if ($native) {
    return [ordered]@{ ok = $true; reader = $native.reader; idm = $native.idm; pmm = $native.pmm; transport = "usb" }
  }
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

function Get-FelicaUserBlocks {
  $native = Invoke-NativeFelicaReader
  if ($native) {
    $allBytes = [Collections.Generic.List[byte]]::new()
    foreach ($block in $native.blocks) {
      for ($index = 0; $index -lt $block.hex.Length; $index += 2) { $allBytes.Add([Convert]::ToByte($block.hex.Substring($index, 2), 16)) }
    }
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { $hash = (($sha256.ComputeHash($allBytes.ToArray()) | ForEach-Object { $_.ToString('X2') }) -join '') } finally { $sha256.Dispose() }
    return [ordered]@{ ok = $true; reader = $native.reader; transport = "usb"; idm = $native.idm; pmm = $native.pmm; serviceCode = $native.serviceCode; blockCount = $native.blockCount; sha256 = $hash; blocks = $native.blocks }
  }
  $context = [IntPtr]::Zero
  $card = [IntPtr]::Zero
  try {
    Assert-SCardResult ([WinSCardNative]::SCardEstablishContext(2, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$context)) "SCardEstablishContext"
    [uint32]$length = 0
    Assert-SCardResult ([WinSCardNative]::SCardListReaders($context, $null, $null, [ref]$length)) "SCardListReaders"
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

    $blocks = @()
    $attempts = @()
    $selectedFormat = $null
    foreach ($format in @('pcsc', 'pcsc-le')) {
      $candidateBlocks = @()
      $formatSucceeded = $true
      foreach ($blockNumber in 0..13) {
        [byte[]]$command = 0xFF, 0xB0, 0x00, 0x00, 0x04, 0x01, 0x01, 0x80, ([byte]$blockNumber)
        if ($format -eq 'pcsc-le') { $command += 0x10 }
        [byte[]]$response = New-Object byte[] 64
        [uint32]$responseLength = $response.Length
        Assert-SCardResult ([WinSCardNative]::SCardTransmit($card, [ref]$pci, $command, $command.Length, [IntPtr]::Zero, $response, [ref]$responseLength)) "SCardTransmit"
        if ($responseLength -ne 18 -or $response[16] -ne 0x90 -or $response[17] -ne 0x00) {
          $attempts += [ordered]@{
            format = $format
            block = $blockNumber
            response = (($response[0..([Math]::Max(0, $responseLength - 1))] | ForEach-Object { $_.ToString('X2') }) -join '')
          }
          $formatSucceeded = $false
          break
        }
        $candidateBlocks += [ordered]@{
          number = $blockNumber
          hex = (($response[0..15] | ForEach-Object { $_.ToString('X2') }) -join '')
        }
      }
      if ($formatSucceeded) {
        $selectedFormat = $format
        $blocks = $candidateBlocks
        break
      }
    }
    if (-not $selectedFormat) {
      return [ordered]@{ ok = $false; error = "FeliCa user blocks could not be read with the standard PC/SC Read Binary command."; attempts = $attempts }
    }
    $allBytes = [Collections.Generic.List[byte]]::new()
    foreach ($block in $blocks) {
      for ($index = 0; $index -lt $block.hex.Length; $index += 2) { $allBytes.Add([Convert]::ToByte($block.hex.Substring($index, 2), 16)) }
    }
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { $hash = (($sha256.ComputeHash($allBytes.ToArray()) | ForEach-Object { $_.ToString('X2') }) -join '') } finally { $sha256.Dispose() }
    [ordered]@{ ok = $true; reader = $reader; format = $selectedFormat; blockCount = $blocks.Count; sha256 = $hash; blocks = $blocks }
  } finally {
    if ($card -ne [IntPtr]::Zero) { [void][WinSCardNative]::SCardDisconnect($card, 0) }
    if ($context -ne [IntPtr]::Zero) { [void][WinSCardNative]::SCardReleaseContext($context) }
  }
}

function Invoke-FelicaTransparentReadProbe {
  throw "This legacy transparent probe is disabled. Use the native USB reader instead."
  $context = [IntPtr]::Zero
  $card = [IntPtr]::Zero
  $steps = [Collections.Generic.List[object]]::new()
  try {
    Assert-SCardResult ([WinSCardNative]::SCardEstablishContext(2, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$context)) "SCardEstablishContext"
    [uint32]$length = 0
    Assert-SCardResult ([WinSCardNative]::SCardListReaders($context, $null, $null, [ref]$length)) "SCardListReaders"
    $buffer = New-Object char[] $length
    Assert-SCardResult ([WinSCardNative]::SCardListReaders($context, $null, $buffer, [ref]$length)) "SCardListReaders"
    $reader = ((-join $buffer).Trim([char]0).Split([char]0) | Where-Object { $_ -match 'FeliCa|PaSoRi|SONY' } | Select-Object -First 1)
    if (-not $reader) { throw "No FeliCa reader was found." }
    [uint32]$protocol = 0
    Assert-SCardResult ([WinSCardNative]::SCardConnect($context, $reader, 3, 0, [ref]$card, [ref]$protocol)) "SCardConnectDirect"
    $pci = New-Object WinSCardNative+SCARD_IO_REQUEST
    $pci.dwProtocol = 4
    $pci.cbPciLength = [Runtime.InteropServices.Marshal]::SizeOf([type][WinSCardNative+SCARD_IO_REQUEST])

    [byte[]]$featureResponse = New-Object byte[] 256
    [uint32]$featureLength = 0
    $getFeatureCode = [uint32]0x00313520
    Assert-SCardResult ([WinSCardNative]::SCardControl($card, $getFeatureCode, $null, 0, $featureResponse, $featureResponse.Length, [ref]$featureLength)) "GetFeatureRequest"
    [uint32]$escapeControlCode = 0
    for ($featureIndex = 0; $featureIndex + 5 -lt $featureLength; $featureIndex += 6) {
      if ($featureResponse[$featureIndex] -eq 0x13 -and $featureResponse[$featureIndex + 1] -eq 0x04) {
        $escapeControlCode = ([uint32]$featureResponse[$featureIndex + 2] -shl 24) -bor ([uint32]$featureResponse[$featureIndex + 3] -shl 16) -bor ([uint32]$featureResponse[$featureIndex + 4] -shl 8) -bor [uint32]$featureResponse[$featureIndex + 5]
        break
      }
    }
    if (-not $escapeControlCode) { $escapeControlCode = [uint32]0x003136B0 }
    $steps.Add([ordered]@{
      name = "reader-features"
      nativeResult = "0x00000000"
      response = (($featureResponse[0..([Math]::Max(0, $featureLength - 1))] | ForEach-Object { $_.ToString('X2') }) -join '')
      escapeControlCode = ('0x{0:X8}' -f $escapeControlCode)
    })

    function Send-ProbeApdu([string]$Name, [byte[]]$Command) {
      [byte[]]$response = New-Object byte[] 512
      [uint32]$responseLength = $response.Length
      $result = [WinSCardNative]::SCardControl($card, $escapeControlCode, $Command, $Command.Length, $response, $response.Length, [ref]$responseLength)
      $hex = if ($responseLength) { (($response[0..($responseLength - 1)] | ForEach-Object { $_.ToString('X2') }) -join '') } else { "" }
      $unsignedResult = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$result), 0)
      $steps.Add([ordered]@{ name = $Name; nativeResult = ('0x{0:X8}' -f $unsignedResult); response = $hex })
      if ($result -ne 0) { throw "$Name failed" }
      return [byte[]]$response[0..($responseLength - 1)]
    }

    function Get-TransparentResponseData([byte[]]$Response) {
      $index = 0
      while ($index -lt ($Response.Length - 2)) {
        $tag = $Response[$index]
        $index++
        if ($tag -eq 0xFF) { $tag = (0xFF00 -bor $Response[$index]); $index++ }
        if ($index -ge $Response.Length) { break }
        $valueLength = [int]$Response[$index]
        $index++
        if ($valueLength -eq 0x81) { $valueLength = [int]$Response[$index]; $index++ }
        if ($index + $valueLength -gt $Response.Length) { break }
        if ($tag -eq 0x97) { return [byte[]]$Response[$index..($index + $valueLength - 1)] }
        $index += $valueLength
      }
      throw "Transparent response did not contain card data."
    }

    [void](Send-ProbeApdu "start-session" ([byte[]](0xFF,0xC2,0x00,0x00,0x02,0x81,0x00,0x00)))
    [void](Send-ProbeApdu "activate-felica" ([byte[]](0xFF,0xC2,0x00,0x02,0x04,0x8F,0x02,0x03,0x01,0x00)))
    [byte[]]$pollingCommand = 0x06,0x00,0xFF,0xFF,0x01,0x00
    [byte[]]$pollingExchange = @(0xFF,0xC2,0x00,0x01,0x08,0x95,0x06) + $pollingCommand + @(0x00)
    $pollingResponse = Send-ProbeApdu "poll-card" $pollingExchange
    $pollingData = Get-TransparentResponseData $pollingResponse
    if ($pollingData.Length -lt 10 -or $pollingData[1] -ne 0x01) { throw "FeliCa polling response was invalid." }
    [byte[]]$idm = $pollingData[2..9]
    [byte[]]$felicaCommand = @(0x10,0x06) + $idm + @(0x01,0x0B,0x00,0x01,0x80,0x00)
    [byte[]]$exchange = @(0xFF,0xC2,0x00,0x01,0x12,0x95,0x10) + $felicaCommand + @(0x00)
    $readResponse = Send-ProbeApdu "read-block-0" $exchange
    $readData = Get-TransparentResponseData $readResponse
    [ordered]@{ ok = $true; reader = $reader; idm = (($idm | ForEach-Object { $_.ToString('X2') }) -join ''); cardResponse = (($readData | ForEach-Object { $_.ToString('X2') }) -join ''); steps = $steps }
  } catch {
    [ordered]@{ ok = $false; error = $_.Exception.Message; steps = $steps }
  } finally {
    if ($card -ne [IntPtr]::Zero) {
      try {
        [byte[]]$endCommand = 0xFF,0xC2,0x00,0x00,0x02,0x82,0x00,0x00
        [byte[]]$endResponse = New-Object byte[] 64
        [uint32]$endLength = $endResponse.Length
        [void][WinSCardNative]::SCardControl($card, $escapeControlCode, $endCommand, $endCommand.Length, $endResponse, $endResponse.Length, [ref]$endLength)
      } catch {}
      [void][WinSCardNative]::SCardDisconnect($card, 0)
    }
    if ($context -ne [IntPtr]::Zero) { [void][WinSCardNative]::SCardReleaseContext($context) }
  }
}

function Read-Bindings {
  if (-not (Test-Path -LiteralPath $StorePath)) { return @{} }
  $encrypted = [IO.File]::ReadAllBytes($StorePath)
  $plain = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $json = [Text.Encoding]::UTF8.GetString($plain)
  $object = ConvertTo-Hashtable ($json | ConvertFrom-Json)
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

function Write-CardBackup($Backup) {
  $directory = Split-Path -Parent $BackupPath
  [IO.Directory]::CreateDirectory($directory) | Out-Null
  $backups = @{}
  if (Test-Path -LiteralPath $BackupPath) {
    $encrypted = [IO.File]::ReadAllBytes($BackupPath)
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $existing = ConvertTo-Hashtable ([Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json)
    if ($existing) { $backups = $existing }
  }
  $backups[$Backup.idm] = @{ capturedAt = [DateTime]::UtcNow.ToString('o'); data = $Backup }
  $json = $backups | ConvertTo-Json -Depth 12 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $temp = "$BackupPath.tmp"
  [IO.File]::WriteAllBytes($temp, $encrypted)
  Move-Item -LiteralPath $temp -Destination $BackupPath -Force
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
  return ConvertTo-Hashtable ($json | ConvertFrom-Json)
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

if ($ProbeBlocks) {
  Get-FelicaUserBlocks | ConvertTo-Json -Depth 6 -Compress
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
      } elseif ($method -eq 'POST' -and $path -eq '/card/backup') {
        $backup = Get-FelicaUserBlocks
        if ($backup.ok) { Write-CardBackup $backup }
        Send-Response $writer 200 $backup $origin
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
