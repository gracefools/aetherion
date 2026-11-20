# Shares the locally running game (docker compose, port 8080) on the internet through a Cloudflare
# Tunnel. Unlike free ngrok there is no warning page in front of the game, so the browser can read the
# app files and players can install Aetherion on desktop and phone.
#
#   powershell -ExecutionPolicy Bypass -File deploy\cloudflare.ps1
#       Quick tunnel: no account, a random https://<words>.trycloudflare.com address that changes on
#       every start. Good for testing and sharing with friends.
#
#   powershell -ExecutionPolicy Bypass -File deploy\cloudflare.ps1 -Name aetherion
#       Named tunnel: a fixed address on your own domain (set up once, see deploy\CLOUDFLARE.md).
#
# Needs: cloudflared installed (winget install --id Cloudflare.cloudflared), and TRUST_PROXY=1 in
# deploy\.env (so the server sees each player's real address for its per-address limits). Stop with Ctrl+C.
param([string]$Name = '', [int]$Port = 8080)

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Error 'cloudflared is not installed. Install it with: winget install --id Cloudflare.cloudflared  (then open a new terminal)'
  exit 1
}
try { Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/" -TimeoutSec 5 | Out-Null }
catch { Write-Error "The game is not answering on port $Port. Start it first: docker compose -f deploy/docker-compose.yml up -d"; exit 1 }

if ($Name) {
  Write-Host "Starting the named tunnel '$Name' (its address is the hostname you routed to it)."
  & cloudflared tunnel run $Name
} else {
  Write-Host 'Starting a quick tunnel. Look for the line with https://....trycloudflare.com below: that is the address to share.'
  Write-Host 'Players open the https address; the game connects over wss on the same address automatically.'
  & cloudflared tunnel --no-autoupdate --url "http://localhost:$Port"
}
