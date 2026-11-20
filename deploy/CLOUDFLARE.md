# Putting Aetherion on the internet with a Cloudflare Tunnel

A Cloudflare Tunnel connects your computer to Cloudflare from the inside, so no router ports need
opening. Players reach the game over https and wss. Unlike free ngrok there is no warning page, so the
game can be installed as an app (desktop and phone).

Install the connector once:

```powershell
winget install --id Cloudflare.cloudflared
```

Keep `TRUST_PROXY=1` in `deploy\.env`, as for ngrok.

## A. Quick tunnel (no account, address changes on every start)

```powershell
docker compose -f deploy/docker-compose.yml up -d
powershell -ExecutionPolicy Bypass -File deploy\cloudflare.ps1
```

Share the `https://<words>.trycloudflare.com` address it prints. Quick tunnels are meant for testing:
the address is new each time, there is no uptime promise, and very busy servers can be limited.

## B. Your own address (needs a Cloudflare account and a domain on Cloudflare)

Done once:

```powershell
cloudflared tunnel login                      # opens the browser: pick your domain
cloudflared tunnel create aetherion           # creates the tunnel and its credentials file
cloudflared tunnel route dns aetherion play.example.com
```

Then create `%USERPROFILE%\.cloudflared\config.yml` (use the tunnel id and file printed by `create`):

```yaml
tunnel: aetherion
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: play.example.com
    service: http://localhost:8080
  - service: http_status:404
```

Run it:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\cloudflare.ps1 -Name aetherion
```

To keep it running in the background with Windows, install it as a service instead:
`cloudflared service install` (run as administrator; it uses the same config file).

## C. Your own address, run by Docker next to the game

Create the tunnel in the Cloudflare dashboard (Zero Trust > Networks > Tunnels > Create, type
"Cloudflared"). Add a public hostname, for example `play.example.com`, pointing to `http://game:8080`.
Copy the tunnel token into `deploy\.env` (never commit that file):

```
CF_TUNNEL_TOKEN=<the long token>
```

Start the game with the tunnel:

```powershell
docker compose -f deploy/docker-compose.yml --profile tunnel up -d
```

## Checking it

Open the address in Chrome or Edge: an install icon appears at the right of the address bar
(Firefox cannot install sites). On Android: menu > Install app. On iPhone: Share > Add to Home Screen.
