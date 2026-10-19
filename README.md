# update-set-cicd

Move ServiceNow update sets between instances from a laptop or from a continuous integration and continuous delivery (CI/CD) pipeline. The CLI uses the credentials and conventions of the [ServiceNow SDK](https://www.npmjs.com/package/@servicenow/sdk). It can also build an update set from a Now SDK (Fluent) app, so a Fluent app can be promoted from TEST to PROD with update sets instead of the Application Repository.

This repository holds two things:

1. The CLI (`bin/`, `src/`). It is tested and never deployed to an instance.
2. A sample app (`update-set-cicd-sample/`), a small Fluent app, with GitHub Actions workflows that build it, deploy it to TEST on every merge, and move it to PROD after a reviewer approves.

> **Caution:** the CLI and the pipeline write to your instances. Start with sub-production instances and keep secrets out of version control.

## Two ways to try it

1. **CLI only.** Install nothing but Node.js, store credentials for one or two instances, and run commands from your terminal. No fork and no GitHub setup. Start with [Try the CLI](#try-the-cli).
2. **Full pipeline.** Fork the repository, give the workflows credentials for a TEST and a PROD instance, and watch a change flow from a pull request (PR) to TEST to PROD. Start with [Try the pipeline](#try-the-pipeline).

## How the pipeline flows

The update set is built from the Fluent source in git when a PR merges. TEST receives it by import. PROD receives it by moving the update set that TEST committed, which gives PROD the same record a manual pull from TEST creates.

1. A developer changes the sample app on a branch and bumps `version` in `update-set-cicd-sample/package.json`.
2. A PR runs `Sample app: PR build and generate`. It builds the app and generates the update set. No instance is touched.
3. A merge to `main` runs `Sample app: deploy TEST then PROD`. It builds once, then imports, previews, and commits the update set on TEST.
4. A reviewer approves the production deployment in GitHub, then the update set moves from TEST to PROD.

See the [flow diagram](https://htmlpreview.github.io/?https://github.com/jon-lind-sn/update-set-cicd/blob/main/docs/developer-workflow.html), [how the pipeline works](docs/how-it-works.md), and the [workflow files](.github/workflows/README.md).

## Try the CLI

Requires Node.js 22 (`nvm use` reads `.nvmrc`) and a user with the `admin` role on each instance.

1. Get the CLI. Either run it straight from GitHub with no install:

   ```bash
   npx github:jon-lind-sn/update-set-cicd --help
   ```

   or clone it:

   ```bash
   git clone https://github.com/jon-lind-sn/update-set-cicd.git
   cd update-set-cicd
   npm install
   node bin/update-set-cicd.js --help
   ```

   The examples below use `update-set-cicd` for either form.

2. Store a credential alias for each instance. The command prompts for the credentials:

   ```bash
   npx @servicenow/sdk auth --add https://dev1.service-now.com --type basic --alias dev1
   npx @servicenow/sdk auth --add https://dev2.service-now.com --type basic --alias dev2
   npx @servicenow/sdk auth --list
   ```

3. List completed update sets on an instance (a read-only check that the credential works):

   ```bash
   update-set-cicd list --auth dev1
   ```

4. Copy an update set from one instance to another. Preview first, then commit:

   ```bash
   update-set-cicd move --from dev1 --to dev2 --update-set-name "My Update Set" --preview-only
   update-set-cicd move --from dev1 --to dev2 --update-set-name "My Update Set"
   ```

   `--update-set-name` accepts a pattern such as `"My-Project-*"`. If the preview finds a problem, nothing is committed (`--on-conflict fail`, the default) and the output lists each problem.

5. Build an update set from the sample app and load it. This needs the clone from step 1:

   ```bash
   cd update-set-cicd-sample && npm ci && npx now-sdk build && cd ..
   node bin/update-set-cicd.js generate update-set-cicd-sample/dist/app --out-dir out
   node bin/update-set-cicd.js import out/*.xml --auth dev1 --commit
   ```

   Running `import` again for the same version reports `already committed` and skips it. Each new `version` in `package.json` produces a new update set.

| Command | What it does |
|---|---|
| `list` | List update sets on an instance |
| `move` | Copy update sets from one instance to another, preview, and commit |
| `import <files>` | Load Extensible Markup Language (XML) files, preview, and optionally commit (`--commit`) |
| `export` | Write update sets to local XML files |
| `commit` / `rollback` | Commit retrieved update sets already on the instance, or back one out |
| `generate <app-dir>` | Build an update set XML from a Now SDK build folder (`dist/app`) |

Pick instances with a stored alias (`--auth`, `--from`, `--to`) or with environment variables (`--from-env TEST --to-env PROD` reads `SN_SDK_TEST_*` and `SN_SDK_PROD_*`). Add `-o json` for machine-readable output. Run any command with `--help` for all options.

## Try the pipeline

The pipeline uses two instances: TEST (update sets are committed here first) and PROD (promoted here after approval). It authenticates with Open Authorization (OAuth) client credentials, which needs no interactive sign-in. Basic authentication also works. Reviewers on a private repository need a paid GitHub plan.

1. Fork this repository and clone it. GitHub disables workflows on a new fork, so open the Actions tab of the fork and enable them.
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

5. Create the approval gate. In the repository go to Settings > Environments > New environment, name it `production`, and add Required reviewers.
6. Run a change through it:
   1. Create a branch, change the sample app (for example the message in `update-set-cicd-sample/src/server/fix-scripts/hello-update-set-cicd.js`), and bump `version` in `update-set-cicd-sample/package.json`.
   2. Open a PR. The `Sample app: PR build and generate` check builds the app and attaches the generated update set to the run.
   3. Merge to `main`. `Sample app: deploy TEST then PROD` commits the update set on TEST, then waits for approval of the production deployment.
   4. Approve the production deployment in the Actions tab. The update set moves from TEST to PROD.
   5. If a preview finds a problem, the run stops and nothing is committed. Fix it and merge a new version.

The `CLI: unit tests` workflow runs `npm test` on every PR and every push to `main`. To promote existing update sets from TEST to PROD from another repository, call the reusable workflow [`_move-update-sets.yml`](.github/workflows/_move-update-sets.yml).

## Learn more

1. [How the pipeline works](docs/how-it-works.md), and the [workflow files](.github/workflows/README.md).
2. [Community tutorial and video](https://sn.works/sdk/cicd) for configuring OAuth and running a PR through a pipeline.
3. [ServiceNow SDK documentation](https://servicenow.github.io/sdk/), including [CI integration](https://servicenow.github.io/sdk/config/ci-integration) and [authentication for `now-sdk install`](https://servicenow.github.io/sdk/config/ci-integration#authentication-for-now-sdk-install).
4. GitHub: [Actions](https://docs.github.com/en/actions), [workflow syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions), [variables](https://docs.github.com/en/actions/learn-github-actions/variables), [secrets](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions), and [environments and approvals](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment).

## License

MIT
