# Upload to Chrome Web Store

Publish your extension from CI without opening the Developer Dashboard for every release. This GitHub Action uploads your `.zip` to the [Chrome Web Store](https://chrome.google.com/webstore) and can submit it for review in one step.

**Highlights**

- **API v2 by default when you are ready** — set `publisher-id` (from [Developer Dashboard → Account](https://chrome.google.com/webstore/devconsole/)) to use the [current Chrome Web Store API](https://developer.chrome.com/docs/webstore/api).
- **Still works without `publisher-id`** — falls back to legacy API v1.1 so existing workflows keep running; you will see a reminder to add `publisher-id` before Google retires v1 (after **October 15, 2026**).
- **Upload only or upload + publish** — toggle `publish` when you want a draft upload without submitting for review.

## Before you start

1. Create a **zip** of your extension (same layout you would upload manually).
2. Follow **[How to get your Chrome Web Store credentials](#how-to-get-your-chrome-web-store-credentials)** below to obtain **client ID**, **client secret**, **refresh token**, and (for API v2) **publisher ID** and **extension ID**.
3. Add those values as GitHub **repository secrets** and reference them in your workflow.

The official guide from Google is also worth bookmarking: [Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api).

## How to get your Chrome Web Store credentials

This section walks through the full setup: Google Cloud project, OAuth client, refresh token, and the IDs the action expects. Plan on **20–40 minutes** the first time, especially if you need to configure the consent screen or wait for Google’s review (only if you move out of testing mode).

### Prerequisites

1. **Google account that owns the extension**  
   The account you use when you sign in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/) must be the same one you authorize in the OAuth steps below. The items you manage via the API are tied to that developer identity.

2. **2-Step Verification**  
   Google requires [2-Step Verification](https://support.google.com/accounts/answer/185839) on the account that will publish or update items through the API.

3. **Extension already exists in the store**  
   The Chrome Web Store API updates **existing** items; it does not replace creating the listing the first time in the dashboard. For a **new** extension, complete initial setup (including [store listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) and [privacy](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) where required) before relying on CI uploads.

4. **Optional but recommended: API v2**  
   For API **v2**, you need your **publisher ID** (see [Obtain your publisher ID](https://developer.chrome.com/docs/webstore/using-api#obtain_your_publisher_id)). For **v1.1** (legacy, if you omit `publisher-id`), you still need OAuth credentials; only the REST URLs differ.

---

### Step 1 — Create or choose a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Use the project picker to **create a new project** or select an existing one.  
   The Cloud project is only where the **OAuth client** and **API enablement** live. It does **not** have to match the email domain of your developer account, but the **person who clicks “Allow” in OAuth** must be the developer who owns the store items.

---

### Step 2 — Enable the Chrome Web Store API

1. In the Cloud Console, open **APIs & Services → Library** (or search the top bar for “Chrome Web Store API”).
2. Find **Chrome Web Store API** and click **Enable**.

Without this, token and API calls for the store will fail with errors about the API being disabled.

---

### Step 3 — Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose a user type:
   - **External** — typical for individual developers and public GitHub workflows. While the app is in **Testing**, only **test users** you add can complete OAuth (see below).
   - **Internal** — only if you use Google Workspace and want the app limited to your organization.
3. Fill in the required **app information** (app name, user support email, developer contact).
4. On **Scopes**, you can **Save and continue** without adding scopes manually here; the OAuth Playground (next sections) will request `https://www.googleapis.com/auth/chromewebstore` explicitly.
5. If you chose **External** and the app is in **Testing**, open **Test users** and **add the Google account** that owns your Chrome Web Store items. That account must be able to finish the consent flow.
6. Complete the wizard. If Google requires **verification** for production (broader audience), follow their process; for **Testing** + listed test users, you can proceed for your own account.

---

### Step 4 — Create an OAuth 2.0 Client ID (Web application)

1. Go to **APIs & Services → Credentials**.
2. Click **Create credentials → OAuth client ID**.
3. If prompted, set the **Application type** to **Web application**.
4. Give it a name (e.g. `chrome-webstore-ci`).
5. Under **Authorized redirect URIs**, click **Add URI** and enter exactly:

   `https://developers.google.com/oauthplayground`

   This is the redirect URL used by Google’s [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), which is the easiest way to obtain a **refresh token** once.

6. Click **Create**.
7. A dialog shows the **Client ID** and **Client Secret**. **Copy both** and store them somewhere safe (you will add them to GitHub secrets). You can always create a new secret in the console if you lose it (revoke the old one if compromised).

These map to the action inputs **`client-id`** and **`client-secret`**.

---

### Step 5 — Get a refresh token (OAuth 2.0 Playground)

The action (and the Chrome Web Store API) needs a **refresh token** so CI can obtain short-lived **access tokens** without a browser.

1. Open [OAuth 2.0 Playground](https://developers.google.com/oauthplayground).
2. Click the **gear icon** (⚙) in the top right.
3. Check **Use your own OAuth credentials**.
4. Paste your **OAuth Client ID** and **OAuth Client secret** from Step 4.
5. Close the settings panel.
6. In the left column, find **Chrome Web Store API** (or use **“Enter your own scopes”** at the bottom) and enter this scope exactly:

   `https://www.googleapis.com/auth/chromewebstore`

7. Click **Authorize APIs**.
8. Sign in with the **same Google account** that owns your Chrome Web Store developer account and items. Grant access when asked.
9. Click **Exchange authorization code for tokens**.
10. The response panel shows an **Access token** and a **Refresh token**.

**Important**

- Copy the **Refresh token** and treat it like a password. This is what you store in GitHub as a secret (e.g. `CHROME_REFRESH_TOKEN`). Anyone with refresh token + client id/secret can act as that user for this API scope until you **revoke** the token in [Google Account security](https://myaccount.google.com/permissions) or rotate credentials.
- If the refresh token does not appear, you may need to revoke previous access for the Playground in your Google account and repeat, or ensure the redirect URI matches Step 4 exactly.

This value maps to the action input **`refresh-token`**.

---

### Step 6 — Extension ID and publisher ID

**Extension ID (`extension-id`)**

- In the [Developer Dashboard](https://chrome.google.com/webstore/devconsole/), open your item. The **extension ID** is the long string in the public store URL, e.g. `https://chrome.google.com/webstore/detail/.../THIS_PART_IS_THE_ID`.
- Use that string as **`extension-id`** in the workflow (and in GitHub secrets if you prefer).

**Publisher ID (`publisher-id`, for API v2)**

1. In the [Developer Dashboard](https://chrome.google.com/webstore/devconsole/), open **Account** (or the account section where your publisher is shown).
2. Copy the **Publisher ID** displayed there.  
   If you use a **group publisher**, switch to that publisher context first, then copy the ID for that context.
3. Pass it as **`publisher-id`** so the action uses API v2. If you omit it, the action falls back to legacy v1.1 and logs a reminder to migrate.

---

### Step 7 — Add secrets to GitHub

In your repository: **Settings → Secrets and variables → Actions → New repository secret**.

Suggested names (match the workflow examples in this README):

| Secret | What it is |
| --- | --- |
| `CHROME_CLIENT_ID` | OAuth Client ID from Step 4 |
| `CHROME_CLIENT_SECRET` | OAuth Client Secret from Step 4 |
| `CHROME_REFRESH_TOKEN` | Refresh token from Step 5 |
| `CHROME_EXTENSION_ID` | Extension ID from Step 6 |
| `CHROME_PUBLISHER_ID` | Publisher ID from Step 6 (recommended for v2) |

Never commit these values to git or log them in workflow output.

---

### Rotating or revoking credentials

- **Leak or suspect compromise:** In Google Cloud Console, delete or reset the OAuth client secret; revoke the app’s access under your Google Account **Third-party access**; create a new OAuth client or new refresh token via the Playground.
- **Refresh token stopped working:** Re-run Step 5; ensure the same client id/secret and scope are used and the account still owns the item.

---

### Service accounts (optional, advanced)

Google also documents [using a service account with the Chrome Web Store API](https://developer.chrome.com/docs/webstore/service-accounts) for some setups. This action is built around **OAuth refresh tokens** in GitHub Secrets; service-account JSON keys in CI are a different pattern. Use the official doc if your organization requires it.

---

### Still stuck?

- Re-read Google’s tutorial: [Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api).
- Confirm **Chrome Web Store API** is enabled, the **redirect URI** matches the Playground, the **scope** is exactly `https://www.googleapis.com/auth/chromewebstore`, and the signed-in user **owns** the extension in the dashboard.

## Inputs

| Input | Required | Description |
| --- | --- | --- |
| `file-path` | Yes | Path to the `.zip` file (e.g. `dist/extension.zip`). |
| `extension-id` | Yes | Chrome Web Store item / extension ID. |
| `publisher-id` | No | Publisher ID from the dashboard. **Recommended** — enables API v2. If omitted, uses legacy v1.1. |
| `client-id` | Yes | OAuth client ID. |
| `client-secret` | Yes | OAuth client secret. |
| `refresh-token` | Yes | OAuth refresh token with the Chrome Web Store scope. |
| `glob` | No | If `true`, `file-path` is a glob; the **first** match is uploaded. Default `false`. |
| `publish` | No | If `true` (default), publishes after upload. If `false`, upload only. |
| `publish-target` | No | `default` or `trustedTesters` (**legacy v1**). With v2, use the dashboard for visibility. Default `default`. |

## Minimal workflow

The action itself runs on **Node 24** on GitHub’s runners. Your own build step can use any supported Node version you like.

```yaml
name: Release extension

on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - run: npm ci && npm run build

      - name: Upload and publish to Chrome Web Store
        uses: ShahafShavit/chrome-extension-upload@v1
        with:
          file-path: dist/extension.zip
          extension-id: ${{ secrets.CHROME_EXTENSION_ID }}
          publisher-id: ${{ secrets.CHROME_PUBLISHER_ID }}
          client-id: ${{ secrets.CHROME_CLIENT_ID }}
          client-secret: ${{ secrets.CHROME_CLIENT_SECRET }}
          refresh-token: ${{ secrets.CHROME_REFRESH_TOKEN }}
```

That example assumes your pipeline already produces `dist/extension.zip`. If you only have a folder (for example `dist/` with `manifest.json` inside), add a **Create extension zip** step as in [Creating the extension zip in the workflow](#creating-the-extension-zip-in-the-workflow) and point `file-path` at the zip you create.

Replace the `uses:` line with your fork or a pinned SHA if you prefer.

### Creating the extension zip in the workflow

The Chrome Web Store expects a **zip whose root contains `manifest.json`** (and your scripts, icons, etc.)—not a zip that wraps an extra top-level folder unless that folder *is* the extension root.

On **`ubuntu-latest`**, the `zip` CLI is already available. Add a step **before** the upload action that builds your extension, then archives the correct directory.

**Example — build output is a flat folder `dist/`** (contains `manifest.json` after `npm run build`):

```yaml
      - name: Build extension
        run: npm ci && npm run build

      - name: Create extension zip for the store
        run: |
          (cd dist && zip -r ../extension.zip .)

      - name: Upload and publish to Chrome Web Store
        uses: ShahafShavit/chrome-extension-upload@v1
        with:
          file-path: extension.zip
          extension-id: ${{ secrets.CHROME_EXTENSION_ID }}
          publisher-id: ${{ secrets.CHROME_PUBLISHER_ID }}
          client-id: ${{ secrets.CHROME_CLIENT_ID }}
          client-secret: ${{ secrets.CHROME_CLIENT_SECRET }}
          refresh-token: ${{ secrets.CHROME_REFRESH_TOKEN }}
```

**Example — extension sources live under `extension/`** in the repo (no separate build step):

```yaml
      - name: Create extension zip for the store
        run: |
          (cd extension && zip -r ../extension.zip .)

      - name: Upload and publish to Chrome Web Store
        uses: ShahafShavit/chrome-extension-upload@v1
        with:
          file-path: extension.zip
          # ... other inputs as above
```

Using `(cd dir && zip …)` keeps the shell in the job’s original directory afterward and avoids nesting an unwanted parent folder inside the zip.

**Checks**

- Unzip locally once and confirm **`manifest.json` is at the top level** of the archive.
- Bump **`version`** in `manifest.json` (or your build pipeline) before each store upload; the store rejects uploads if the version is unchanged.

On **Windows** runners, install a zip tool or use PowerShell [`Compress-Archive`](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.archive/compress-archive); the examples above assume Linux.

### Upload only (no publish)

```yaml
      - uses: ShahafShavit/chrome-extension-upload@v1
        with:
          file-path: dist/extension.zip
          extension-id: ${{ secrets.CHROME_EXTENSION_ID }}
          publisher-id: ${{ secrets.CHROME_PUBLISHER_ID }}
          client-id: ${{ secrets.CHROME_CLIENT_ID }}
          client-secret: ${{ secrets.CHROME_CLIENT_SECRET }}
          refresh-token: ${{ secrets.CHROME_REFRESH_TOKEN }}
          publish: 'false'
```

### Glob pattern

```yaml
        with:
          file-path: dist/*.zip
          glob: 'true'
          # ... other inputs
```

## Try the API with curl

Same credentials the action uses work from the terminal. Replace placeholders and run after you have an access token.

**Refresh access token**

```bash
curl -s "https://oauth2.googleapis.com/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "client_secret=$CLIENT_SECRET" \
  --data-urlencode "refresh_token=$REFRESH_TOKEN" \
  --data-urlencode "grant_type=refresh_token"
```

**API v2 — item status**

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://chromewebstore.googleapis.com/v2/publishers/$PUBLISHER_ID/items/$EXTENSION_ID:fetchStatus"
```

**API v2 — upload package**

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  -X POST \
  -H "Content-Type: application/zip" \
  --data-binary "@extension.zip" \
  "https://chromewebstore.googleapis.com/upload/v2/publishers/$PUBLISHER_ID/items/$EXTENSION_ID:upload"
```

**API v2 — publish (submit for review)**

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  "https://chromewebstore.googleapis.com/v2/publishers/$PUBLISHER_ID/items/$EXTENSION_ID:publish"
```

More detail: [Chrome Web Store API reference](https://developer.chrome.com/docs/webstore/api/reference/rest).

## Status meanings in the logs

After upload, this action prints **short explanations** next to raw values. The authoritative definitions are Google’s API reference; below is a concise map of what you usually see.

### Two different “status” lines (API v2)

`fetchStatus` returns both a **published** revision and a **submitted** revision. They are independent:

| Log label | API field (v2) | Typical meaning |
| --- | --- | --- |
| **Live listing** | `publishedItemRevisionStatus.state` | What end users get **today** (public or testers, per your dashboard). |
| **Submitted / in-flight** | `submittedItemRevisionStatus.state`, or sometimes `lastAsyncUploadState` | The **draft / review pipeline** — pending review, staged, cancelled, etc. **`CANCELLED` here does not remove the live listing** if the live row is still `PUBLISHED`. |

**Order of operations:** This action calls `fetchStatus` once **right after upload** and again **after a successful publish**. If you use publish, you may first see `CANCELLED` on the submitted line (nothing in flight yet), then the publish response shows something like `PENDING_REVIEW`, then the second `fetchStatus` should align with the new submission. That is normal, not a conflict.

### ItemState (item / review lifecycle)

From [ItemState](https://developers.chrome.com/docs/webstore/api/reference/rest/v2/ItemState):

| Value | Meaning |
| --- | --- |
| `PENDING_REVIEW` | In Google’s review queue. |
| `STAGED` | Approved and staged (e.g. staged publishing or waiting for you to publish). |
| `PUBLISHED` | Live to users for your chosen visibility. |
| `PUBLISHED_TO_TESTERS` | Live to trusted testers only. |
| `REJECTED` | Review failed; fix issues in the dashboard and resubmit. |
| `CANCELLED` | Submission cancelled or no active submission; **not** the same as “unpublished” unless the published row changes too. |
| `ITEM_STATE_UNSPECIFIED` | Unused placeholder from the API. |

### UploadState (package zip processing)

From [UploadState](https://developers.chrome.com/docs/webstore/api/reference/rest/v2/UploadState):

| Value | Meaning |
| --- | --- |
| `SUCCEEDED` | Zip accepted and processed (v2). This action may show it normalized as **`SUCCESS`**. |
| `IN_PROGRESS` | Still processing; wait or poll `fetchStatus`. |
| `FAILED` | Validation/processing failed (normalized as **`FAILURE`** in logs). |
| `NOT_FOUND` | Often on `lastAsyncUploadState` when there was no recent upload (24h window in API docs). |
| `UPLOAD_STATE_UNSPECIFIED` | Default / unspecified. |

### Legacy v1.1 publish `status[]` codes

If you omit `publisher-id`, the legacy publish API can return codes such as `OK`, `ITEM_PENDING_REVIEW`, `ITEM_TAKEN_DOWN`, etc. The action logs the same **explain-** lines when those appear.

Longer copy for maintainers lives in [`src/chrome-webstore-status-docs.ts`](src/chrome-webstore-status-docs.ts).

## Runner compatibility

The action metadata uses **`node24`** (see [GitHub’s JavaScript action syntax](https://docs.github.com/en/actions/sharing-automations/creating-actions/metadata-syntax-for-github-actions#runs-for-javascript-actions)). That matches current GitHub-hosted runners. If you use **self-hosted** runners, upgrade the runner application when you see errors about an unsupported Node runtime.

## Run the action locally

Yes — a **`.env` file is a good approach**, as long as it stays out of git. This repo already **ignores `.env`** (see `.gitignore`).

On the runner, each input is exposed as an environment variable: `INPUT_` plus the input name in **uppercase**. **Hyphens stay as hyphens.** For example, the input `file-path` becomes the env key **`INPUT_FILE-PATH`** (not `INPUT_FILE_PATH`). [`@actions/core`](https://github.com/actions/toolkit/tree/main/packages/core) `getInput('file-path')` reads `process.env['INPUT_FILE-PATH']`, which is valid in Node but awkward in Bash (you cannot `export INPUT_FILE-PATH=...`).

This repo’s **`npm run run:local`** loads `.env` with **`override: true`** (so empty vars injected by other tools are replaced), then **copies underscore-style keys** like `INPUT_FILE_PATH` into the hyphenated keys the toolkit expects. You can use **either** style in `.env`; see [`.env.example`](.env.example).

### Setup

1. Copy the template and add your values:

   ```bash
   cp .env.example .env
   ```

2. Edit **`.env`**. Use a real `.zip` path (relative to the repo root is fine). For a first run, keep **`INPUT_PUBLISH=false`** so you only **upload** a draft and do not trigger the publish/submit step. Prefer **`INPUT_FILE-PATH=...`** (hyphen) or **`INPUT_FILE_PATH=...`** (underscore — the local runner bridges it).

3. Run:

   ```bash
   npm run run:local
   ```

   That runs `tsc` and then `node scripts/run-local.cjs`, which loads **`.env` from the repository root** (next to `package.json`, not `process.cwd()`), bridges underscore input keys to hyphenated ones, and avoids the misleading error **`Input required and not supplied: file-path`** when `.env` used `INPUT_FILE_PATH` instead of `INPUT_FILE-PATH`.

### Debug logs (`ACTIONS_STEP_DEBUG`)

This action uses `@actions/core` **`core.debug()`** for raw JSON snapshots (upload response, `fetchStatus`, publish response). Those show up as **`::debug::`** lines when **step debug logging** is enabled.

- **On GitHub Actions:** turn on [debug logging for a workflow run](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/enabling-debug-logging) (UI: re-run with “Enable debug logging”, or set the repository variable / secret `ACTIONS_STEP_DEBUG` to `true` as documented there). That is how you see `core.debug` output in the Actions log viewer.
- **Locally:** add `ACTIONS_STEP_DEBUG=true` (or `1`) to **`.env`** only when you want JSON snapshots in the log. If it is unset, this action skips those `core.debug()` payloads (similar to not expanding debug lines in the Actions UI until you enable debug for a run).

`RUNNER_DEBUG=1` is separate (runner-wide); it toggles `core.isDebug()` in some toolkit versions but **this action’s structured dumps use `core.debug()`**, which is tied to **step** debug on GitHub.

### Is that “good enough”?

- **For integration testing** (OAuth refresh, upload, optional publish): **yes**, this matches how the action resolves inputs on GitHub.
- **Caveat:** There is **no sandbox**. With real credentials you are calling the **production** Chrome Web Store API. A failed upload is usually harmless; a **successful** upload still replaces the draft package for that item. **`INPUT_PUBLISH=false`** avoids the separate publish call but **does not** prevent an upload from applying a new package version if the API accepts it.
- **Automated unit tests** without network calls would require mocking `fetch` / the client module — that is a different kind of test than “does my zip + secrets work end-to-end?”

### Without `dotenv`

Use **`env`** so keys can contain hyphens (Bash cannot `export INPUT_FILE-PATH=...`):

```bash
npm run build
env \
  INPUT_FILE-PATH=./extension.zip \
  INPUT_EXTENSION-ID=your_id \
  INPUT_CLIENT-ID=... \
  INPUT_CLIENT-SECRET=... \
  INPUT_REFRESH-TOKEN=... \
  INPUT_PUBLISH=false \
  node lib/main.js
```

Optional v2: add `INPUT_PUBLISHER-ID=...`. Or keep using **`npm run run:local`** with a `.env` file (underscore keys are fine there).

### Optional: run the job with `act`

To approximate a full workflow (checkout, steps, etc.), you can try [nektos/act](https://github.com/nektos/act). You still supply secrets carefully; behavior can differ slightly from `github.com` hosted runners.

## Developing this action

```bash
npm ci
npm run all
```

`npm run pack` bundles `lib/main.js` into `dist/index.js` with `@vercel/ncc`. Commit `dist/` when you publish a release of the action.

Local development targets **Node 20+** (`engines` in `package.json`).

## License

MIT
