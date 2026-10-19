# update-set-cicd

Move ServiceNow update sets between instances from a laptop or any continuous integration and continuous delivery (CI/CD) system, configured and invoked the same way as `now-sdk cicd`.

**Status: work in progress.** The design is in [docs/node-port-plan.md](docs/node-port-plan.md) and the latest test results and open items are in [docs/node-port-report.md](docs/node-port-report.md).

## Requirements

1. Node.js 22 or later. `.nvmrc` pins 22: run `nvm use` in this folder.
2. ServiceNow Now SDK credentials (`@servicenow/sdk` is a dependency; no separate install).

## Quick start

```bash
npm install
node bin/update-set-cicd.js --help
node bin/update-set-cicd.js list -a <alias>
node bin/update-set-cicd.js generate <app>/dist/app --out-dir out
node bin/update-set-cicd.js import out/*.xml -a <alias> --commit
node bin/update-set-cicd.js move --update-set-name "My-Project-*" --from <source-alias> --to <target-alias>
```

## Generate an update set from a Now SDK app

`generate <app-dir>` reads a Now SDK build folder (`dist/app`) and writes a Retrieved Update Set XML named `<App-Name>-<version>.xml`. Every generated id is a hash of the app content. The same app gives the same ids, so an update set already on the target is reported as already committed and skipped. A change to the app gives new ids and uploads as a new update set. Each now-sdk build writes a random serial number and timestamp into an SBOM record; those two values are left out of the hash, so a rebuild of unchanged source keeps its ids. Pass `--replace` to include them, which makes every new build a new update set. Run `npm test` for the unit tests.

## CI/CD credentials

`move` reads each instance from the same variables `now-sdk` uses in CI, with the instance name inserted: `--from-env TEST --to-env PROD` reads `SN_SDK_TEST_*` and `SN_SDK_PROD_*` (`INSTANCE_URL`, `AUTH_TYPE`, `USER`, `USER_PWD`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`). Empty values are ignored. Single-instance commands read plain `SN_SDK_*`. Set `SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL` to make `now-sdk` use these variables instead of a stored alias.

## Set up GitHub and ServiceNow

The pipeline uses the same variable, secret, and environment names as the dev-passport-brazil pipeline, so one set of instance credentials works for both. The pipeline has two instances: TEST (update sets are committed here first) and PROD (update sets are promoted here after approval). Each instance authenticates with Open Authorization (OAuth) client credentials, which needs no interactive login, or with basic authentication.

### 1. Prepare each ServiceNow instance (OAuth only)

Repeat for the TEST and PROD instances. Skip this section for an instance that uses basic authentication.

1. Create or choose a service user with the `admin` role. Set its Identity Type to `Human`; the installer rejects other identity types.
2. Set the system property `glide.oauth.inbound.client.credential.grant_type.enabled` to `true` (type `true | false`). Create it in `sys_properties` if it is missing. Reference: [KB1645212](https://support.servicenow.com/kb?id=kb_article_view&sysparm_article=KB1645212).
3. Create the OAuth client. If you already created one named `SDK CI` on this instance for dev-passport-brazil, reuse it and skip to step 4; the same client ID and secret work for both repositories. Otherwise go to System OAuth > Inbound Integrations > New Integration > OAuth Client Credentials Grant, then enter:
   1. Name: `SDK CI`.
   2. Provider Name: `SDK CI Provider` (type it in manually).
   3. OAuth application user: the service user from step 1.
   4. Allow access only to APIs in selected scope: leave unchecked.
   5. OpenID Connect (OIDC) provider: leave empty. OIDC providers do not issue tokens for the client credentials grant.
   6. Save, and dismiss the "assign an auth scope" warning.
4. Open the saved registry entry and copy the Client ID and Client Secret.

### 2. Check each credential before storing it

This runs the same code path as the pipeline. Run it in your own terminal so the secret stays out of chat history and logs.

```bash
SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL SN_SDK_AUTH_TYPE=oauth \
SN_SDK_INSTANCE_URL=https://your-instance.service-now.com \
SN_SDK_OAUTH_CLIENT_ID=<client-id> SN_SDK_OAUTH_CLIENT_SECRET='<client-secret>' \
npx @servicenow/sdk query sys_user -q "active=true" --limit 1 -o json
```

Success prints `{"ok":true, ...}`. A failure prints `OAuth client_credentials token request failed`, which means a wrong ID or secret, a registry entry still restricted to a scope, or the system property from step 1 not set to `true`.

### 3. Store the values in GitHub

Run the setup script. It prompts for each value, stores them with the GitHub CLI (`gh`), and leaves a secret unchanged if you press Enter at its prompt.

```bash
gh auth login
scripts/setup-cicd.sh --repo jon-lind-sn/update-set-cicd
```

Manual equivalent, per instance (`TEST` or `PROD`):

| Setting | Kind | Used when |
|---|---|---|
| `SN_SDK_<NAME>_INSTANCE_URL` | variable | always |
| `SN_SDK_<NAME>_AUTH_TYPE` | variable (`basic` or `oauth`) | always |
| `SN_SDK_<NAME>_USER` | variable | basic |
| `SN_SDK_<NAME>_USER_PWD` | secret | basic |
| `SN_SDK_<NAME>_OAUTH_CLIENT_ID` | secret | oauth |
| `SN_SDK_<NAME>_OAUTH_CLIENT_SECRET` | secret | oauth |

```bash
gh variable set SN_SDK_PROD_INSTANCE_URL --repo jon-lind-sn/update-set-cicd --body "https://your-prod-instance.service-now.com"
gh secret set SN_SDK_PROD_OAUTH_CLIENT_ID --repo jon-lind-sn/update-set-cicd --body "<client-id>"
gh secret set SN_SDK_PROD_OAUTH_CLIENT_SECRET --repo jon-lind-sn/update-set-cicd --body '<client-secret>'
gh variable set SN_SDK_PROD_AUTH_TYPE --repo jon-lind-sn/update-set-cicd --body "oauth"
```

Set an instance's credentials before its `AUTH_TYPE` variable. Confirm with `gh variable list` and `gh secret list`.

### 4. Create the approval environment

1. In the repository, go to Settings > Environments > New environment and name it `production`.
2. Check Required reviewers and add the people who approve promotions.
3. Save. Jobs that use this environment pause until a reviewer approves.

### 5. Confirm

1. Run the credential check from step 2 once per instance. Both must print `{"ok":true`.
2. Run `gh variable list --repo jon-lind-sn/update-set-cicd` and confirm `INSTANCE_URL` and `AUTH_TYPE` exist for TEST and PROD.
3. Run `gh secret list --repo jon-lind-sn/update-set-cicd` and confirm the secrets for each instance's auth type exist.

## License

MIT
