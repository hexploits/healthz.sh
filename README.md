# healthz.sh

Multi-region API health checker on AWS. Lambdas run in N regions on a schedule, check your endpoints, and write results to a DynamoDB global table. A static Next.js dashboard on CloudFront shows uptime, latency by region, and health status.

## Live Examples

- [status.hexploits.cloud](https://status.hexploits.cloud) — dark mode, default branding
- [status.swarmd.ai](https://status.swarmd.ai) — light mode, custom logo, font, and primary color

## Screenshots

<p>
  <img src="screenshots/dark.png" alt="Dashboard — dark mode" width="49%">
  <img src="screenshots/light.png" alt="Dashboard — light mode" width="49%">
</p>
<p>
  <img src="screenshots/dark-service.png" alt="Service detail — dark mode" width="49%">
  <img src="screenshots/light-service.png" alt="Service detail — light mode" width="49%">
</p>

## Architecture

```
healthz.yaml
     │
     ├── DynamoDB Global Table (primary region + replicas)
     ├── Lambda Checker × N regions (EventBridge scheduled)
     └── CloudFront → S3 (static UI) + API Gateway → Lambda (API)
```

## Quick Start

**Prerequisites:** Node.js 22+, AWS CLI (configured), Docker (for local dev only)

### Deploy to AWS

1. Copy the example config and edit it with your endpoints, regions, and branding:

```bash
cp healthz.yaml.example healthz.yaml
```

2. Edit `healthz.yaml` with your endpoints and regions (see [Configuration](#configuration) below)

3. Deploy:

```bash
aws sso login          # or however you authenticate
./deploy.sh
```

The script handles everything: CDK bootstrap, build, deploy, and prints the dashboard URL.

> **Note:** `healthz.yaml` contains your specific endpoints and infrastructure settings and is excluded from version control via `.gitignore`. Only the example file is tracked.

### Local Development

```bash
npm ci
npm run dev:db         # start DynamoDB Local (Docker)
npm run dev:seed       # seed with realistic test data
npm run dev            # start API + UI on localhost:3000
```

Branding options are set via environment variables in dev mode (the deploy script sets these automatically from `healthz.yaml`):

```bash
NEXT_PUBLIC_COMPANY_NAME="My Company" \
NEXT_PUBLIC_COMPANY_URL="https://example.com" \
NEXT_PUBLIC_LOGO_DARK="logo-dark.png" \
NEXT_PUBLIC_LOGO_LIGHT="logo-light.png" \
NEXT_PUBLIC_FONT=true \
NEXT_PUBLIC_THEME_MODE="dark" \
NEXT_PUBLIC_PRIMARY_COLOR="#3717EB" \
npm run dev
```

All are optional — only include the ones you need.

## Configuration

All configuration lives in `healthz.yaml`. Start by copying the example:

```bash
cp healthz.yaml.example healthz.yaml
```

```yaml
checks:
  - name: My API             # display name (slugified for storage)
    url: https://example.com/health
    interval: 5m             # check frequency: 1m, 5m, 15m, 1h, etc.
    timeout: 10s             # request timeout: 5s, 10s, 30s
    expected_status: 200     # HTTP status that means healthy
    method: GET              # optional, defaults to GET
    headers:                 # optional request headers
      Authorization: Bearer xxx

regions:
  - us-east-1               # each region gets its own Lambda checker
  - eu-west-1
  - ap-southeast-2

settings:
  primary_region: eu-west-1  # dashboard + master DB deployed here
  retention_days: 180        # auto-delete old data via DynamoDB TTL
  table_name: healthz-checks

branding:
  company_name: My Company   # header text (fallback when no logo)
  company_url: https://example.com
  theme_mode: both           # "both" (default), "dark", or "light"
  primary_color: "#3717EB"   # hex color for headings and brand text
```

### What each setting does

| Setting | Effect |
|---|---|
| `checks[].interval` | EventBridge rule schedule for that check |
| `checks[].timeout` | `AbortController` timeout on the Lambda's `fetch()` call |
| `checks[].expected_status` | Response status compared against this to determine `healthy: true/false` |
| `regions` | One Lambda + EventBridge rules deployed per region. DynamoDB replicas in each. |
| `primary_region` | Where the dashboard (S3 + CloudFront + API Gateway) and master DynamoDB table live |
| `retention_days` | TTL on DynamoDB records — data auto-expires after this period |
| `branding.company_name` | Displayed in the top-left of the dashboard header |
| `branding.company_url` | The header company name links to this URL |
| `branding.theme_mode` | `both` (default, shows toggle), `dark` (forced dark), or `light` (forced light) |
| `branding.primary_color` | Hex color (e.g. `"#3717EB"`) applied to headings, service names, and brand text |

### Logo

Place logo files in `packages/ui/public/`:

| File | Purpose |
|---|---|
| `logo-dark.png` | Shown when dark mode is active |
| `logo-light.png` | Shown when light mode is active |

Both are optional. If only one is provided, it's used for both modes. If neither is present, the `company_name` text is displayed instead. The deploy script detects these automatically.

Example logos (`logo-dark.png` and `logo-light.png`) are included in the repo as a reference — replace them with your own.

### Custom Font

1. Place your font files (`.woff2`, `.otf`, `.ttf`, etc.) in `packages/ui/public/fonts/`
2. Update the `@font-face` `src` paths in `packages/ui/src/app/globals.css` to point to your files
3. The deploy script detects font files automatically and enables the custom font

The `@font-face` declarations use the family name `CustomFont` — don't change this, it's referenced by the Tailwind config. Just update the `src` URLs to match your font filenames.

### Custom Domain

By default, your dashboard is served on a CloudFront-generated URL (e.g. `d1234abcd.cloudfront.net`). To serve it on your own domain instead, add a `domain` block to your config. This attaches your domain to the CloudFront distribution with a valid SSL certificate.

#### Cloudflare / External DNS

Add the domain names to the config:

```yaml
domain:
  names:
    - status.example.com
```

Run `./deploy.sh`. On first run it will:

1. Request an ACM certificate in us-east-1 (free)
2. Print the DNS validation records you need to add with your DNS provider
3. Exit and ask you to re-run

Add the CNAME validation records with your DNS provider (if using Cloudflare, use **DNS only / grey cloud, not proxied**), wait a minute, then re-run `./deploy.sh`. It picks up where it left off — validates the cert, deploys everything, and prints the final CNAME to point your domain at CloudFront.

After deployment, create a CNAME record pointing your domain to the CloudFront distribution domain printed in the output. Keep the ACM validation CNAME record in place permanently — AWS uses it to auto-renew the certificate.

#### Route53

If your DNS is in Route53, it's fully automated — no manual steps:

```yaml
domain:
  names:
    - status.example.com
  hosted_zone_id: Z0123456789
  zone_name: example.com
```

CDK creates the certificate, validates it via Route53, and creates the alias record to CloudFront. One `./deploy.sh` and you're done.

## Updating

Change `healthz.yaml` and re-run `./deploy.sh`. The deploy is idempotent:

- Adding/removing regions creates/destroys checker stacks and DynamoDB replicas
- Changing intervals updates EventBridge rules in-place
- Changing the primary region migrates the dashboard and cleans up the old one
- Unchanged stacks are skipped (no-op)

## Tear Down

```bash
cd infra && npx cdk destroy --all
```

The DynamoDB table uses a `RETAIN` policy — delete it manually from the AWS console if needed.

## Cost

For small-scale use (a few checks, 3-4 regions, 1-5min intervals), this runs within AWS free tier or costs a few cents/month.

## License

MIT — see [LICENSE](LICENSE).
