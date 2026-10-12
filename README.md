# Cloud and Network Service Status

A single-page dashboard for configured cloud and network services. It shows current incidents, service degradation, maintenance in progress, upcoming planned maintenance, and incidents resolved in the last 24 hours.

The page is static HTML, CSS and JavaScript. When it opens, and when you use **Reload status data**, the browser reads the public provider feeds and applies the same filters as the collector. It does not hold credentials. `data/status.json` is a saved snapshot. The page uses that snapshot only for a feed the browser cannot read. A Node.js collector in GitHub Actions refreshes the snapshot so that fallback stays current.

Public feeds are labelled as public. They are not a personalised view of any subscription.

## What the page shows

- Header status calculated only from events that passed the configured filter. The order is major outage, partial outage, degraded performance, maintenance, operational, then unknown or stale. A failed feed is not shown as operational.
- One card each for Microsoft Azure, Google Cloud Platform, Amazon Web Services, Cisco Umbrella, Cloudflare, and Syntura, formerly hSo.
- **Current incidents.**
- **Current and upcoming maintenance** (30 days ahead by default).
- Resolved events kept for 24 hours.
- A disclosure of excluded events and the reason each one was dropped.
- Times on screen in Europe/London, shown as GMT or BST. Stored timestamps are ISO 8601 UTC.

**Reload status data** reads the provider feeds again. It does not stop at the saved snapshot. The collection time in the header is the time of that browser read. A provider that cannot be read keeps its snapshot and is marked stale. The header does not call that a fresh collection of every feed.

## Repository layout

```
/
├── index.html
├── assets/
│   ├── app.js
│   ├── favicon.svg
│   ├── status-model.js
│   └── styles.css
├── config/
│   └── providers.json
├── data/
│   ├── status.json
│   └── mock-status.json
├── scripts/
│   ├── fetch-status.js
│   ├── filter.js
│   ├── mock-data.js
│   ├── serve.js
│   ├── lib/
│   ├── providers/
│   │   ├── azure.js
│   │   ├── gcp.js
│   │   ├── aws.js
│   │   ├── cisco-umbrella.js
│   │   ├── cloudflare.js
│   │   ├── syntura.js
│   │   └── statuspage.js
│   └── schemas/
│       └── status.schema.json
├── tests/
│   └── filtering.test.js
├── .github/workflows/
│   ├── update-status.yml
│   ├── deploy-pages.yml
│   └── deploy-without-commit.yml
├── package.json
├── LICENSE
└── README.md
```

There are no runtime dependencies. Node.js 20 or newer is enough.

## Run it locally

```powershell
node --test tests/
node scripts/fetch-status.js
node scripts/serve.js
```

Open http://127.0.0.1:4173/ . The server listens on `127.0.0.1` only. Set `PORT` to use another port.

`npm test`, `npm run fetch`, `npm run mock` and `npm start` call the same commands.

**Preview mock scenarios** on the page loads `data/mock-status.json`. Those events are fictional and the page says so. Generate that file with:

```powershell
node scripts/fetch-status.js --mock
```

`--mock` never writes `data/status.json`. If `config.mockData` is `true`, the live collector refuses to run, so fiction cannot be published as live status.

Mock scenarios:

1. Azure UK South degradation (included).
2. Azure Asia-only incident (excluded).
3. AWS eu-west-2 outage (included).
4. AWS US-only incident (excluded).
5. Cisco Umbrella global incident (included).
6. Cisco Umbrella EU planned maintenance (included).
7. Cisco APAC-only maintenance (excluded).
8. Cloudflare London (LHR) maintenance (included).
9. Cloudflare Singapore-only maintenance (excluded).
10. Syntura planned maintenance (included).
11. Google Cloud feed stale, with cached europe-west2 data.
12. A mock-only provider with no cached data, shown as unknown.

A resolved UK West incident inside 24 hours and an older UK South incident outside 24 hours are also in the mock file, so the retention rule can be seen.

## Configuration

Edit `config/providers.json`.

| Field | Meaning |
| --- | --- |
| `dashboardTitle`, `organisation`, `timeZone` | Page identity. The collector stores the time zone; the page formats times in Europe/London. |
| `refreshMinutes` | Intended collection interval. The workflow cron is `*/5 * * * *`. |
| `maintenanceLookAheadDays` | Upcoming maintenance window. Default 30. In-progress maintenance is kept even if it started earlier. |
| `recentlyResolvedHours` | How long a resolved or completed event stays on the page. Default 24. |
| `mockData` | Must stay `false` for the live collector. |
| `providers.*.enabled` | Skip a provider when `false`. |
| `allowedRegions`, `allowedLocations`, `allowedServices` | Scope for the dashboard. Matching is case-insensitive. |
| `includeGlobal` | When `true`, an event marked explicitly global can be included. |
| `blockedRegions`, `blockedLocations` | Drop an event that is limited to these places. |
| `syntura.includeWhenUnconfigured` | When the Syntura allow-lists are both empty, published Syntura events are included and badged **Allow-list not set**. Fill `allowedServices` or `allowedLocations` and only matches remain. |

Azure regions in config are `uksouth` and `ukwest`. AWS is `eu-west-2`. Google Cloud is `europe-west2`. Cloudflare London is `LHR`.

An event is included when a structured region or component matches an allowed value, when it is explicitly global, or when it covers several places and at least one is allowed. It is excluded when it is limited to blocked or unrelated places, when it matches no configured scope, or when it is resolved outside the retention window. A missing location is **Unspecified**. It is not treated as global. Each event stores `included`, `inclusionReason`, `matchedRegions` and `matchedComponents`.

## GitHub Actions

### Scheduled collection

`.github/workflows/deploy-without-commit.yml` is the live publisher. It runs on `workflow_dispatch` and on cron `*/5 * * * *`. Five minutes is the shortest interval GitHub documents. GitHub can start a scheduled run later than the cron time, and may pause schedules after 60 days without a repository commit.

The job fetches every provider and deploys the site. It does not commit `data/status.json`. It passes `--publish`, so the saved snapshot gets a new collection time even when the incidents have not changed. The page does not wait for that job: **Reload status data** reads the provider feeds in the browser, and the page does the same when it opens and about every 5 minutes after that. The saved snapshot is used only when a feed cannot be read from the browser. Azure’s public RSS feed does not allow browser requests, so that card keeps the saved snapshot until this job publishes a newer one.

`.github/workflows/update-status.yml` is manual. Run it when the copy of `data/status.json` in the repository should be updated. It commits only when the events or provider errors change, so a timestamp by itself does not create a commit. Permission is `contents: write`. One failed provider keeps that provider’s previous events, marks it stale, and lets the others update. The commit identity is `github-actions[bot]`. The workflow does not print secrets.

### GitHub Pages

`.github/workflows/deploy-pages.yml` deploys on every push to `main`, and on `workflow_dispatch`. It publishes `index.html`, `assets/`, `config/`, `data/`, `scripts/`, `LICENSE` and `README.md`. The page imports the collector from `scripts/`. It does not publish `.git`. The published scripts contain no credentials.

1. Create a repository and push this directory to the `main` branch. If the default branch has another name, change `branches: [main]` in `deploy-pages.yml`.
2. In the repository, open **Settings → Pages → Build and deployment** and choose **GitHub Actions**.
3. Run **Update status data** once from the Actions tab if you want a fresh `data/status.json` before the first Pages deploy. The copy in this repository is a real collection, not mock data.
4. Run **Deploy GitHub Pages**, or push to `main`. The job’s environment URL is the Pages site.
5. Confirm the live page replaces the snapshot collection time after it reads the provider feeds, and that **Preview mock scenarios** loads `data/mock-status.json` without calling those feeds.

The first Pages run needs the `github-pages` environment. GitHub creates it when the deploy workflow runs. No extra hosting service is required.

`deploy-pages.yml` publishes code pushes. It does not fetch provider data. Leave **Refresh published status** as the only scheduled collector so the feeds are not requested twice.

## Repository secrets

Add these under **Settings → Secrets and variables → Actions**. Leave them unset to stay on the public feeds. Never put these values in `config/providers.json`, HTML, JavaScript, or `data/status.json`.

| Secret | Used for |
| --- | --- |
| `AZURE_TENANT_ID` | Azure Service Health. Directory (tenant) ID, a GUID. |
| `AZURE_CLIENT_ID` | App registration client ID, a GUID. |
| `AZURE_CLIENT_SECRET` | Client secret for that app. |
| `AZURE_SUBSCRIPTION_ID` | One subscription GUID, or several separated by commas. |
| `GCP_PROJECT_ID` | Google Cloud project id (`[a-z0-9-]`, 4 to 63 characters). |
| `GCP_ACCESS_TOKEN` | A short-lived access token for the Service Health API. The public collector does not refresh this token. |

Azure app registration needs permission to read Service Health events on those subscriptions (`Microsoft.ResourceHealth/events/read` or an equivalent role such as Monitoring Reader). The collector calls:

`GET https://management.azure.com/subscriptions/{subscriptionId}/providers/Microsoft.ResourceHealth/events?api-version=2025-05-01`

The token request is `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` with scope `https://management.azure.com/.default`. Identifiers are checked as GUIDs before they are placed in a URL. The token, secret, tenant and subscription ids are not written to the log or the JSON file. Impacted subscription ids from the payload are not copied into events.

Google Cloud personalised events use:

`GET https://servicehealth.googleapis.com/v1/projects/{project}/locations/global/events`

Supply a token from your own locked-down refresh step if you need this. This repository does not store a Google refresh token and does not invent a token endpoint.

Account-specific AWS Health is not part of this version. A later EventBridge or Health API integration can write a local file such as `data/aws-account-health.json` (that path is gitignored). The public page must keep working without it. Do not add AWS keys to the browser.

## Integrations that work with no credentials

| Provider | Source | Label on the card |
| --- | --- | --- |
| Azure | `https://azure.status.microsoft/en-gb/status/feed/` | Public Azure Status |
| Google Cloud | `https://status.cloud.google.com/incidents.json` | Public Google Cloud Status |
| AWS | `https://status.aws.amazon.com/rss/all.rss` | Public AWS Health |
| Cisco Umbrella | `https://status.umbrella.cisco.com/api/v2/summary.json` plus the related Statuspage JSON paths | Cisco Umbrella status |
| Cloudflare | `https://www.cloudflarestatus.com/api/v2/summary.json` plus the related Statuspage JSON paths | Cloudflare Status API |
| Syntura, formerly hSo | `https://api.synturastatus.io/data` | Syntura status |

## Integrations that need authentication

| Provider | What the secret adds | Without the secret |
| --- | --- | --- |
| Azure Service Health | Subscription incidents, planned maintenance and health advisories. Card label **Azure Service Health**. | Public Azure RSS. An empty feed means no widespread public incident. It does not mean every subscription is healthy. |
| Google Cloud Service Health | Project events, including events the public board may not list. Card label **Google Cloud Service Health**. | Public `incidents.json` only. |
| AWS Health (account) | Not implemented. Documented so it can be added later. | Public AWS Health RSS only. |

Cisco Umbrella, Cloudflare and Syntura use public status APIs. No extra secret is required.

## Known limitations

**Azure public RSS.** The feed is often an empty channel when Microsoft is not reporting a widespread incident. That result is a successful retrieval and the card stays operational, with the source **Public Azure Status**. Region text is taken from the title and description. UK South and UK West phrases map to `uksouth` and `ukwest`. “Non-regional” and “all regions” mark an event as global. If no known region is named and the text contains the word “global”, the event is also treated as global. A missing region with none of that wording stays unspecified and is excluded.

**Azure Service Health.** Used only when all four Azure secrets are set and valid. A partial set, a failed token call, or an API error falls back to the public RSS and the workflow log says so, without the secret. The portal link on those events is `https://portal.azure.com/`. The collector does not follow a `nextLink` host other than `management.azure.com`, and it stops after five pages.

**Google Cloud public file.** `incidents.json` is a short recent public history, not a project’s Service Health view. Structured locations are used. A hyphenated region id is read from text only when the structured location list is empty. The word “global” in prose is not turned into a location. Events with no location stay unspecified and are excluded unless a later personalised payload marks them global.

**AWS public RSS.** This is public service health, not the events for a specific account. Items can remain in the feed after the practical impact has passed; the feed does not provide a reliable resolved flag for every item, so old items are not dropped only because `pubDate` is old. Region codes are read from the item. `eu-west-2` is London. `me-central-1`, `me-south-1` and other regions outside `allowedRegions` are excluded. A service is treated as global only when the text says all regions or globally, or when the RSS guid slug matches `globalServices` and no region code is present. There is no EventBridge consumer in this repository.

**Cisco Umbrella.** The collector uses the Umbrella status page at `status.umbrella.cisco.com`. It does not read `status.sse.cisco.com` (Secure Access). Secure Connect and CloudLock items are dropped unless the event also names Umbrella. “Global”, “Europe”, “EU”, “EMEA” and “Umbrella Global” can include an event. A blocked region does not exclude an event that is also global or European. The word “global” inside Statuspage boilerplate can match; check the exclusion log if a component looks too broad. Other Cisco products are out of scope until their status source is added to config and the adapter.

**Cloudflare.** Filtering uses Statuspage component names and groups, not the title alone. A trailing `(LHR)` code is London. Geographic components such as China Network are regions, including when they sit in the “Cloudflare Sites and Services” group, so they are not treated as global. If any data centre or geography is listed and none of it is allowed, attached product components do not make the event global. A continent group on its own is outside the configured scope. Platform components with no location, including DNS, CDN, network, Zero Trust, Access, WAF, WARP and Cloudflare One, can be included as global.

**Syntura.** `https://synturastatus.io/` is a single-page app. The collector calls `https://api.synturastatus.io/data`, which is the JSON endpoint the official app loads. Syntura does not publish a stable contract for that URL, so the path can change and the adapter will then fail closed: the last good Syntura events stay, marked stale. Only the first page is requested. Staff fields (`adminuser`, names and hashes) are discarded. Device names that Syntura puts in the public title are kept. The source link is the status site, not an invented per-item URL. With empty allow-lists, events are included until `allowedServices` or `allowedLocations` is filled in.

**Schedule and freshness.** A quiet feed does not make a provider stale. Stale is set only when a later retrieval fails and cached events are reused. In the browser, `generatedAt` is the time that read started, including when the included events have not changed. The repository file is rewritten on a timestamp-only run only when the collector is started with `--publish`.

**Statuspage partial failure.** Cloudflare and Cisco request `/api/v2/summary.json` first, then components, unresolved incidents, incident history, and active and upcoming maintenance. A 404 on a later path is a warning when another path succeeded. If every path fails, that provider fails and the others continue.

## Tests

```powershell
node --test tests/
```

The tests cover the region rules for all six providers, retention, the maintenance look-ahead, mock include and exclude flags, stale and empty-cache status, RSS parsing, and removal of Syntura staff fields. They do not call the network.

## Security

- No provider credentials in the site, the config file, or the committed JSON.
- Provider text is written with `textContent`. The page does not use `innerHTML` for feed content. HTML in summaries is stripped before it is stored.
- External links use `rel="noopener noreferrer"` and an `http` or `https` URL check.
- The page sets a Content Security Policy. `connect-src` allows only this site and the official provider feed hosts: `azure.status.microsoft`, `status.cloud.google.com`, `status.aws.amazon.com`, `www.cloudflarestatus.com`, `status.umbrella.cisco.com` and `api.synturastatus.io`. There is no CORS proxy.
- Collector requests time out after 20 seconds and reject bodies over 8 MB. Malformed JSON and XML fail that provider only.
- GitHub Actions are pinned to commit SHAs. Workflow permissions are limited to the job.

## Licence

MIT. See [LICENSE](LICENSE).
