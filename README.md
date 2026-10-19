# update-set-cicd

Move ServiceNow update sets between instances from a laptop or from a continuous integration and continuous delivery (CI/CD) pipeline, using the credentials and conventions of the [ServiceNow SDK](https://www.npmjs.com/package/@servicenow/sdk). It can also build an update set from a Now SDK (Fluent) app, so an SDK app can be promoted TEST to PROD with update sets instead of the Application Repository.

This repository holds the CLI and a sample app (a Now SDK Fluent app) (`update-set-cicd-sample/`) with a working GitHub Actions pipeline.

> **Caution:** the pipeline writes to your instances without a human in the loop, except for the approval gate before PROD. Start with sub-production instances and keep secrets out of version control.

## Use the CLI

Requires Node.js 22 (`nvm use` picks it up from `.nvmrc`).

```bash
npm install
node bin/update-set-cicd.js --help
```

| Command | What it does |
|---|---|
| `list` | List update sets on an instance |
| `move` | Copy update sets from one instance to another, preview, and commit |
| `import <files>` | Load XML files, preview, and optionally commit (`--commit`) |
| `export` | Write update sets to local XML files |
| `commit` / `rollback` | Commit retrieved update sets already on the instance, or back one out |
| `generate <app-dir>` | Build an update set XML from a Now SDK build folder (`dist/app`) |

Pick instances with a stored Now SDK alias (`--auth`, `--from`, `--to`) or with environment variables (`--from-env TEST --to-env PROD` reads `SN_SDK_TEST_*` and `SN_SDK_PROD_*`). Add `-o json` for machine-readable output. Re-running a command for an update set that is already committed reports it and skips it.

## Set up the pipeline

The pipeline has two instances: TEST (update sets are committed here first) and PROD (promoted here after approval). It authenticates with Open Authorization (OAuth) client credentials, which needs no interactive login. Basic authentication also works.

1. Fork this repository and clone it.
2. On each instance, create the OAuth client (skip for basic authentication):
   1. Create or choose a service user with the `admin` role and Identity Type `Human`.
   2. Set the system property `glide.oauth.inbound.client.credential.grant_type.enabled` to `true` ([KB1645212](https://support.servicenow.com/kb?id=kb_article_view&sysparm_article=KB1645212)).
   3. Go to System OAuth > Inbound Integrations > New Integration > OAuth Client Credentials Grant. Set Name to `SDK CI`, Provider Name to `SDK CI Provider` (type it in), and OAuth application user to the service user. Leave "Allow access only to APIs in selected scope" unchecked and leave the OpenID Connect (OIDC) provider empty. Save, and copy the Client ID and Client Secret.
3. Check each credential in your own terminal before storing it. Success prints `{"ok":true`:

   ```bash
   SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL SN_SDK_AUTH_TYPE=oauth \
   SN_SDK_INSTANCE_URL=https://your-instance.service-now.com \
   SN_SDK_OAUTH_CLIENT_ID=<client-id> SN_SDK_OAUTH_CLIENT_SECRET='<client-secret>' \
   npx @servicenow/sdk query sys_user -q "active=true" --limit 1 -o json
   ```

4. Store the values in GitHub. Install the [GitHub CLI](https://github.com/cli/cli#installation), run `gh auth login`, then:

   ```bash
   scripts/setup-cicd.sh --repo <owner>/<repo>
   ```

   The script prompts for an instance name or URL, the auth type, and the credentials for TEST and PROD, then sets these (leave a prompt blank to keep an existing secret):

   | Name | Kind | Used when |
   |---|---|---|
   | `SN_SDK_{TEST,PROD}_INSTANCE_URL` | variable | always |
   | `SN_SDK_{TEST,PROD}_AUTH_TYPE` | variable (`oauth` or `basic`) | always |
   | `SN_SDK_{TEST,PROD}_OAUTH_CLIENT_ID` and `_OAUTH_CLIENT_SECRET` | secrets | oauth |
   | `SN_SDK_{TEST,PROD}_USER` | variable | basic |
   | `SN_SDK_{TEST,PROD}_USER_PWD` | secret | basic |

5. Create the approval gate. In the repository go to Settings > Environments > New environment, name it `production`, and add Required reviewers. Reviewers on a private repository need a paid GitHub plan.

## Run it

1. Create a branch, change the sample app, and bump `version` in `update-set-cicd-sample/package.json`. Each version is a new update set.
2. Open a pull request (PR). The `Sample app: PR build and generate` check builds the app and generates the update set, and attaches it to the run. It touches no instance.
3. Merge to `main`. `Sample app: deploy TEST then PROD` builds once and commits the update set on TEST, waits for a reviewer to approve the `production` environment, then moves the committed update set from TEST to PROD. You can also start it by hand from the Actions tab.
4. If a preview finds a problem, the run stops and nothing is committed. Fix it and merge a new version.

The `CLI: unit tests` workflow runs the unit tests (`npm test`) when the CLI changes. To promote existing update sets from TEST to PROD from another repository, call the reusable workflow [`_move-update-sets.yml`](.github/workflows/_move-update-sets.yml).

## Learn more

1. [How the pipeline works](docs/how-it-works.md), and the [workflow files](.github/workflows/README.md).
2. [Community tutorial and video](https://sn.works/sdk/cicd) for configuring OAuth and running a PR through a pipeline.
3. [ServiceNow SDK documentation](https://servicenow.github.io/sdk/), including [CI integration](https://servicenow.github.io/sdk/config/ci-integration) and [authentication for `now-sdk install`](https://servicenow.github.io/sdk/config/ci-integration#authentication-for-now-sdk-install).
4. GitHub: [Actions](https://docs.github.com/en/actions), [workflow syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions), [variables](https://docs.github.com/en/actions/learn-github-actions/variables), [secrets](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions), and [environments and approvals](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment).

## License

MIT
