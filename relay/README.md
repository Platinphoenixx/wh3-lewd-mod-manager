# Relay (Cloudflare Worker)

Lets players send **problem reports** and **contributions** (new mod, feedback, rule, correction, fix for a mod that does not start) from
the app without any account. Free Cloudflare plan; nothing to maintain once it runs.

| Path | What happens |
| --- | --- |
| `POST /report` | The report text the player saw in the app is stored privately (Cloudflare KV, 180 days). |
| `POST /contribution` | Becomes a GitHub issue in the project repository, labelled with its type – the same as a contribution made on GitHub; a maintainer labels it `accepted` as before. |
| `GET /reports` | All stored reports, for the weekly catalog update (needs the export token). |
| `POST /setup` | A mod list a player shares from a profile (load order, the template it builds on, name, notes, how far they played). Stored in KV; one with own or unknown packs also becomes a GitHub issue labelled `setup` for review. Links in the texts are removed. |
| `POST /vote` | "It worked / it didn't" for a template or shared setup, after a game session of 20 minutes or more. One vote per installation and setup (a new one replaces the old), stored as KV metadata under a salted hash of the install id. |
| `POST /flag` | "This rule of the catalog is wrong": one flag per installation and rule (a new one replaces the old, `withdraw` takes it back), kept in KV under a salted hash of the install id. All flags on a rule are one GitHub issue, labelled `flag`; after a decision a new flag opens a new issue with what came later. What the player writes is public there. |
| `GET /setups`, `GET /votes`, `GET /flags` | For the daily catalog update (`curator/fetch_community.py`, needs the export token); votes and flags come out as counts only. |

Privacy: no IP addresses or names are stored. The rate limit counts under a salted hash
of the IP (5 per minute, Cloudflare's rate limiter; nothing of it is stored). Reports carry a random id the app made once per installation,
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
4. `npx wrangler deploy` – prints the address (`https://wh3lmm-relay.<name>.workers.dev`).
5. Secrets (the worker has to exist first):
   ```
   npx wrangler secret put GITHUB_TOKEN     # paste the token from step 2
   .\set-secrets.ps1                        # makes EXPORT_TOKEN and SALT, stores them in Cloudflare and
                                            # RELAY_EXPORT_TOKEN in the GitHub repository (needs gh auth login)
   ```
6. `gh secret set RELAY_URL --body <address>` (or GitHub → Settings → Secrets and variables → Actions).
7. Put the address into `DEFAULTS.relayUrl` in `app/src/shared/api.ts` and release the app.

## Reading reports

The weekly update stores only counts. To read the full reports (for a modder, or to check an error):
```
RELAY_URL=… RELAY_EXPORT_TOKEN=… python curator/fetch_reports.py --dump reports.json
```
Keep `reports.json` out of the repository.
