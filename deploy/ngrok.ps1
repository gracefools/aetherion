# Shares the locally running game (docker compose, port 8080) on the internet through ngrok.
#   powershell -ExecutionPolicy Bypass -File deploy\ngrok.ps1            # a random https address
#   powershell -ExecutionPolicy Bypass -File deploy\ngrok.ps1 -Domain my-name.ngrok-free.app   # your reserved domain
# Needs: ngrok installed and signed in once (ngrok config add-authtoken <token>), and TRUST_PROXY=1 in deploy\.env
# (so the server sees each player's real address for its per-address limits). Stop with Ctrl+C.
param([string]$Domain = '', [int]$Port = 8080)

if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) { Write-Error 'ngrok is not installed: https://ngrok.com/download'; exit 1 }
try { Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/" -TimeoutSec 5 | Out-Null }
catch { Write-Error "The game is not answering on port $Port. Start it first: docker compose -f deploy/docker-compose.yml up -d"; exit 1 }

$ngArgs = @('http', "$Port")
if ($Domain) { $ngArgs += "--url=$Domain" }
Write-Host 'Starting ngrok. The public address is shown below (and at http://127.0.0.1:4040).'
Write-Host 'Players open the https address; the game connects over wss on the same address automatically.'
& ngrok @ngArgs
