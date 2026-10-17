$ErrorActionPreference = 'Stop'
try {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    Start-Process 'https://nodejs.org/en/download'
    throw 'Install Node.js LTS, close this window, then run WordPet-Setup.cmd again.'
  }
  $nodeVersion = & node -p process.versions.node
  $nodeMajor = [int]($nodeVersion.Trim().Split('.')[0])
  if ($nodeMajor -lt 20) { throw 'Update Node.js to the current LTS version, then run setup again.' }
  $configPath = Join-Path $PSScriptRoot 'wordpet-config.json'
  if (-not (Test-Path -LiteralPath $configPath)) { throw 'Use the complete WordPet setup archive from the ChatGPT message.' }
  $configText = Get-Content -LiteralPath $configPath -Raw
  $config = $configText | ConvertFrom-Json
  if (-not $config.scriptProjectId -or -not $config.spreadsheetId -or -not $config.webAppUrl) { throw 'The private Google project configuration is incomplete.' }
  $setupDirectory = Join-Path $env:LOCALAPPDATA 'WordPet'
  New-Item -ItemType Directory -Path $setupDirectory -Force | Out-Null
  $authPath = Join-Path $setupDirectory '.clasprc.json'
  Write-Host '1. Enable Google Apps Script API in the page that opens.'
  Start-Process 'https://script.google.com/home/usersettings'
  Read-Host 'Turn on Google Apps Script API, then press Enter'
  Write-Host '2. Sign in to the Google account that owns WordPet.'
  & npx.cmd --yes --package=@google/clasp@3.4.1 -- clasp --auth $authPath login
  if ($LASTEXITCODE -ne 0) { throw 'Google sign-in did not finish. No deployment was performed.' }
  & npx.cmd --yes --package=@google/clasp@3.4.1 -- clasp --auth $authPath list-deployments $config.scriptProjectId
  if ($LASTEXITCODE -ne 0) { throw 'This Google account cannot access WordPet. Check the account and Apps Script API setting.' }
  $credentialText = Get-Content -LiteralPath $authPath -Raw
  $credentialObject = $credentialText | ConvertFrom-Json
  if (-not $credentialObject.tokens.default.refresh_token) { throw 'Google did not return a reusable authorization. Run setup again.' }
  $items = @(
    @{ Name = 'WORDPET_CONFIG_JSON'; Value = $configText },
    @{ Name = 'WORDPET_CLASPRC_JSON'; Value = $credentialText }
  )
  foreach ($item in $items) {
    Set-Clipboard -Value $item.Value
    Write-Host ('Save a GitHub secret named ' + $item.Name)
    Write-Host 'Paste into the Secret field with Ctrl+V, then click Add secret.'
    Write-Host 'Keep this value out of chat, source files and screenshots.'
    Start-Process ('https://github.com/alena-tutor/alena-tutor.github.io/settings/secrets/actions/new?name=' + $item.Name)
    Read-Host 'After saving this GitHub secret, press Enter'
    if ((Get-Clipboard -Raw) -eq $item.Value) { Set-Clipboard -Value '' }
  }
  $items = $null
  $configText = $null
  $credentialText = $null
  $credentialObject = $null
  Write-Host '4. Click Run workflow on the GitHub page, keep Publish checked, then Run workflow.'
  Start-Process 'https://github.com/alena-tutor/alena-tutor.github.io/actions/workflows/wordpet.yml'
  Write-Host 'Setup is complete only when the Google deployment job succeeds.'
} catch {
  Write-Host ('Setup stopped: ' + $_.Exception.Message) -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}
Read-Host 'Press Enter to close'
