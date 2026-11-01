# Creates the relay's export token and salt and stores them where they are needed (Cloudflare and the
# GitHub repository's Actions secrets) without showing them. Needs `npx wrangler login` and `gh auth login`.
# The GitHub token for creating issues is set separately: npx wrangler secret put GITHUB_TOKEN
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function New-Secret {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([Convert]::ToBase64String($bytes) -replace '[+/=]', '')
}

$export = New-Secret
$salt = New-Secret
$export | npx --yes wrangler@4 secret put EXPORT_TOKEN
$salt | npx --yes wrangler@4 secret put SALT
gh secret set RELAY_EXPORT_TOKEN --body $export
Write-Host 'EXPORT_TOKEN and SALT are set in Cloudflare, RELAY_EXPORT_TOKEN in GitHub.'
