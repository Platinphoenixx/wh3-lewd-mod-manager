# Relay (Cloudflare Worker)

Lets players send **problem reports** and **contributions** (new mod, feedback, rule, correction) from
the app without any account. Free Cloudflare plan; nothing to maintain once it runs.

| Path | What happens |
| --- | --- |
| `POST /report` | The report text the player saw in the app is stored privately (Cloudflare KV, 180 days). |
| `POST /contribution` | Becomes a GitHub issue in the project repository, labelled with its type – the same as a contribution made on GitHub; a maintainer labels it `accepted` as before. |
| `GET /reports` | All stored reports, for the weekly catalog update (needs the export token). |

Privacy: no IP addresses or names are stored. The rate limit (20 per hour) counts under a salted hash
of the IP that expires after the hour. Reports carry a random id the app made once per installation,
so the weekly update counts players, not reports. Only counts reach the public repository
(`curator/raw/error_reports.json`); an error appears in the catalog once 3 or more players reported it.

## Setup (once, about 30 minutes)

1. Create a free Cloudflare account (use the project's mail address).
2. GitHub token for creating issues: GitHub → Settings → Developer settings → Fine-grained tokens →
   *Generate new token*: repository access *only* `wh3-lewd-mod-manager`, permission
   *Issues: Read and write*, nothing else. Copy the token.
3. In this folder:
   ```
   npx wrangler login
   npx wrangler kv namespace create REPORTS
   ```
   Put the printed id into `wrangler.toml` (`id = …`).
4. Secrets (each command asks for the value):
   ```
   npx wrangler secret put GITHUB_TOKEN     # the token from step 2
   npx wrangler secret put EXPORT_TOKEN     # any long random text; also goes to GitHub, step 6
   npx wrangler secret put SALT             # any other long random text
   ```
5. `npx wrangler deploy` – prints the address (`https://wh3lmm-relay.<name>.workers.dev`).
6. GitHub repository → Settings → Secrets and variables → Actions: add `RELAY_URL` (the address) and
   `RELAY_EXPORT_TOKEN` (the export token from step 4).
7. Put the address into `DEFAULTS.relayUrl` in `app/src/shared/api.ts` and release the app.

## Reading reports

The weekly update stores only counts. To read the full reports (for a modder, or to check an error):
```
RELAY_URL=… RELAY_EXPORT_TOKEN=… python curator/fetch_reports.py --dump reports.json
```
Keep `reports.json` out of the repository.
