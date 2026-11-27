$ErrorActionPreference = 'Stop'

# Official institution facts and reviewed public URL evidence at a fixed revision.
$revision = 'd0567a2602d098671fbfeaa44b03c0ce1433b4d7'
$source = "https://raw.githubusercontent.com/lingion/sleepy/$revision"
$options = @{ TimeoutSec = 25 }
$official = Invoke-RestMethod "$source/scripts/data/official_schools.json" @options
$schools = Invoke-RestMethod "$source/app/src/main/assets/schools.json" @options
$audit = Invoke-RestMethod "$source/docs/catalog/manifest.json" @options

if ($official.Count -ne 3377 -or @($official | Where-Object region -eq 'mainland').Count -ne 3196) {
  throw 'The official institution snapshot is incomplete.'
}

$verified = @{}
foreach ($item in $audit.ownershipAudit.decisions) {
  if ($item.ownershipStatus -eq 'verified') { $verified[$item.catalogId] = $item }
}

$schoolNames = @{}
foreach ($school in $schools) {
  if (-not $schoolNames.ContainsKey($school.name)) { $schoolNames[$school.name] = @() }
  $schoolNames[$school.name] += $school
}

$regionNames = @{ hongkong = '香港'; macau = '澳门'; taiwan = '台湾' }
$records = foreach ($item in $official) {
  $name = $item.name.Trim()
  $region = $item.province
  if ($regionNames.ContainsKey($item.region)) { $region = $regionNames[$item.region] }
  $simple = [Microsoft.VisualBasic.Strings]::StrConv($name, [Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese, 2052)
  $candidates = @($schoolNames[$name] | Where-Object { $null -ne $_ })
  $keywords = @()
  if ($simple -cne $name) { $keywords += $simple }
  $keywords += @($candidates.sortKeyFull | Where-Object { $_ -cmatch '^[a-z0-9]{2,100}$' })
  $keywords += @($candidates.aliases | Where-Object { $_ -match '^[\u3400-\u9FA5a-zA-Z0-9]{2,24}$' })

  $entry = ''
  $base = ''
  $links = foreach ($candidate in $candidates) {
    if (-not $candidate.catalogId) { continue }
    $evidence = $verified[$candidate.catalogId]
    if (-not $evidence -or $evidence.name -cne $name -or $candidate.url -cne $evidence.operationalUrl) { continue }
    $uri = $null
    if (-not [Uri]::TryCreate($candidate.url, [UriKind]::Absolute, [ref]$uri)) { continue }
    if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or -not $uri.IsDefaultPort -or $uri.Host -notmatch '\.[a-z]{2,63}$' -or $uri.Host -match '\.(?:local|lan|test|example|invalid|onion)$') { continue }
    # Only public routes and known nonsensitive routing parameters are retained.
    if ($uri.AbsolutePath -notmatch '^/[a-zA-Z0-9_./!~-]*$' -or $uri.Fragment -or $uri.Query -notmatch '^(\?(?:(?:av|contextPath|gnmkdm|layout)=[a-zA-Z0-9_./~-]*&?)+)?$') { continue }
    [pscustomobject]@{ Uri = $uri; Type = $candidate.type }
  }
  foreach ($link in $links) {
    if (-not $entry) { $entry = $link.Uri.AbsoluteUri }
    if ($link.Type -ne 'zf_new' -or $link.Uri.Host -notmatch '\.edu\.cn$') { continue }
    if ($link.Uri.AbsolutePath -match '^(/jwglxt)(?:/|$)' -or $link.Uri.AbsolutePath -match '^()/(?:xtgl/login_slogin|kbcx/xskbcx_cxXskbcxIndex)\.html$') {
      $base = $link.Uri.GetLeftPart([UriPartial]::Authority) + $Matches[1]
      $entry = $link.Uri.AbsoluteUri
      break
    }
  }
  [ordered]@{ id = $item.id; name = $name; region = $region; aliases = (($keywords | Sort-Object -Unique) -join ' '); entry = $entry; base = $base }
}

if (@($records.id | Sort-Object -Unique).Count -ne $official.Count -or @($records | Where-Object base).Count -lt 50) {
  throw 'The directory has duplicate IDs or the public route snapshot changed.'
}

$destination = Join-Path $PSScriptRoot '../electron/timetable-school-directory.json'
$lines = $records | ForEach-Object { '  ' + (ConvertTo-Json -InputObject $_ -Compress) }
[IO.File]::WriteAllText($destination, "[`n" + ($lines -join ",`n") + "`n]`n")
Write-Output "Institutions $($records.Count), HTTPS teaching portals $(@($records | Where-Object entry).Count), Zhengfang routes $(@($records | Where-Object base).Count)"
