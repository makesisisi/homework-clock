param (
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '../release/signed')
)

$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$launcher = Get-Item -LiteralPath (Join-Path $OutputDirectory "Kexi-$($manifest.version)-Windows-x64.exe")
$appDirectory = Join-Path $OutputDirectory 'win-unpacked'
if (!(Get-ChildItem -LiteralPath $appDirectory -File -Filter '*.exe')) {
    throw 'Windows application executable is missing.'
}
$binaries = @(Get-ChildItem -LiteralPath $appDirectory -File -Recurse |
    Where-Object { $_.Extension -in '.exe', '.dll', '.node' })

$invalid = foreach ($file in @($launcher) + $binaries) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($signature.Status -ne 'Valid') {
        "$($file.Name): $($signature.Status)"
    } elseif ($null -eq $signature.TimeStamperCertificate) {
        "$($file.Name): missing timestamp"
    }
}
if ($invalid) {
    throw ("Windows signature verification failed: " + ($invalid -join ', '))
}

Write-Output "Verified timestamped Authenticode signatures for $($launcher.Name) and $($binaries.Count) application binaries."
Write-Output "Publisher: $((Get-AuthenticodeSignature -LiteralPath $launcher.FullName).SignerCertificate.Subject)"
