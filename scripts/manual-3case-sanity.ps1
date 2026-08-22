Set-Location "A:\Aryan Drive\newproject\hoarding_B"
$base = 'http://localhost:3001/api'

function Login($email, $password, $deviceId) {
  $payload = @{ email = $email; password = $password; deviceId = $deviceId; deviceName = 'sanity-script' } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body $payload -TimeoutSec 25
}

$ownerLogin = Login 'owner@demo.com' 'Password@123' 'sanity-owner'
$salesLogin = Login 'sales@demo.com' 'Password@123' 'sanity-sales'
$ownerHeaders = @{ Authorization = "Bearer $($ownerLogin.data.accessToken)" }
$salesHeaders = @{ Authorization = "Bearer $($salesLogin.data.accessToken)" }

$allHoardingRes = Invoke-RestMethod -Method Get -Uri "$base/hoardings" -Headers $ownerHeaders -TimeoutSec 30
$groups = @($allHoardingRes.data)
$flat = @()
foreach ($g in $groups) { if ($g.hoardings) { $flat += @($g.hoardings) } }
$ref = $flat | Select-Object -First 1
$refBefore = if ($ref) { [string]$ref.status } else { '' }

$rentsRes = Invoke-RestMethod -Method Get -Uri "$base/property-rents" -Headers $ownerHeaders -TimeoutSec 30
$rentRows = @($rentsRes.data.rows)
$firstRent = $rentRows | Select-Object -First 1

$case1 = [ordered]@{ case = 'landlord_rent_edit'; pass = $false; details = '' }
if ($firstRent) {
  $payload = [ordered]@{
    landlordName        = [string]$firstRent.landlord
    propertyGroupId     = [string]$firstRent.propertyGroupId
    location            = [string]$firstRent.location
    rentAmount          = [double]$firstRent.rentAmount
    incrementCycleYears = [int]$firstRent.incrementCycleYears
    incrementType       = [string]$firstRent.incrementType
    incrementValue      = [double]$firstRent.incrementValue
    rentStartDate       = (Get-Date $firstRent.rentStartDate).ToString('yyyy-MM-dd')
    paymentFrequency    = [string]$firstRent.paymentFrequency
    reminderDays        = @($firstRent.reminderDays)
  }
  $saveBody = $payload | ConvertTo-Json -Depth 8
  $saveRes = Invoke-RestMethod -Method Post -Uri "$base/property-rents" -Headers $ownerHeaders -ContentType 'application/json' -Body $saveBody -TimeoutSec 30
  $landlordNameEsc = [System.Uri]::EscapeDataString([string]$firstRent.landlord)
  $byLandlord = Invoke-RestMethod -Method Get -Uri "$base/property-rents/by-landlord/$landlordNameEsc" -Headers $ownerHeaders -TimeoutSec 30

  $afterHoardingRes = Invoke-RestMethod -Method Get -Uri "$base/hoardings" -Headers $ownerHeaders -TimeoutSec 30
  $afterFlat = @()
  foreach ($g in @($afterHoardingRes.data)) { if ($g.hoardings) { $afterFlat += @($g.hoardings) } }
  $refAfter = if ($ref) { [string](($afterFlat | Where-Object { $_.id -eq $ref.id } | Select-Object -First 1).status) } else { '' }
  $unchanged = if ($ref) { $refBefore -eq $refAfter } else { $true }

  $case1.pass = ([bool]$saveRes.success -and [bool]$byLandlord.success -and $unchanged)
  $case1.details = "saveSuccess=$($saveRes.success); byLandlordSuccess=$($byLandlord.success); refHoarding=$($ref.code); statusBefore=$refBefore; statusAfter=$refAfter"
}
else {
  $case1.details = 'No property-rent rows found'
}

$case2 = [ordered]@{ case = 'sales_block_book'; pass = $false; details = '' }
$candidate = $flat | Where-Object { @('available', 'on_rent') -contains ([string]$_.status).ToLower() } | Select-Object -First 1
if ($candidate) {
  $from = (Get-Date).AddDays(2).ToString('yyyy-MM-dd')
  $createPayload = [ordered]@{
    hoardingId     = [string]$candidate.id
    dateFrom       = $from
    durationMonths = 3
    notes          = 'sanity-script'
    client         = @{ name = 'Sanity Client'; phone = '9999999999'; email = 'sanity@example.com'; companyName = 'Sanity Co' }
  } | ConvertTo-Json -Depth 8

  try {
    $createRes = Invoke-RestMethod -Method Post -Uri "$base/booking-tokens" -Headers $salesHeaders -ContentType 'application/json' -Body $createPayload -TimeoutSec 30
    $tokenId = [string]$createRes.data.blockId
    $confirmPayload = @{ executionType = 'IN_HOUSE_DESIGN' } | ConvertTo-Json
    $confirmRes = Invoke-RestMethod -Method Post -Uri "$base/booking-tokens/$tokenId/confirm" -Headers $salesHeaders -ContentType 'application/json' -Body $confirmPayload -TimeoutSec 30

    $case2.pass = ([bool]$createRes.success -and [bool]$confirmRes.success)
    $case2.details = "hoarding=$($candidate.code); initialStatus=$($candidate.status); blockSuccess=$($createRes.success); confirmSuccess=$($confirmRes.success); tokenId=$tokenId"
  }
  catch {
    $errMsg = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    $case2.details = "hoarding=$($candidate.code); initialStatus=$($candidate.status); error=$errMsg"
  }
}
else {
  $case2.details = 'No hoarding in available/on_rent status found for block/book test'
}

$case3 = [ordered]@{ case = 'owner_dashboard_totals'; pass = $false; details = '' }
$dash = Invoke-RestMethod -Method Get -Uri "$base/dashboard/owner" -Headers $ownerHeaders -TimeoutSec 30
$dedupe = @{}
foreach ($r in $rentRows) {
  $landlordKey = ([string]$r.landlord).Trim().ToLower()
  $key = if ($landlordKey) { $landlordKey } else { 'group:' + [string]$r.propertyGroupId }
  if (-not $dedupe.ContainsKey($key)) { $dedupe[$key] = $true }
}
$expectedTotalProperties = $dedupe.Keys.Count
$actualTotalProperties = [int]$dash.data.totalProperties
$case3.pass = ([bool]$dash.success -and $actualTotalProperties -eq $expectedTotalProperties)
$case3.details = "mode=$($dash.data.mode); expectedTotalProperties=$expectedTotalProperties; actualTotalProperties=$actualTotalProperties; monthlyLoad=$($dash.data.totalMonthlyRentLoad)"

$result = [ordered]@{
  timestamp = (Get-Date).ToString('s')
  case1     = $case1
  case2     = $case2
  case3     = $case3
}

$result | ConvertTo-Json -Depth 8
