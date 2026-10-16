# update-set-tools: Node port plan

## Context

update-set-tools is a Python Claude plugin (scripts/*.py, about 1,100 lines, `requests` dependency) that lists, exports, imports, previews and commits update sets using Now-SDK credentials. The goal is a small Node package, runnable with `npx`, that moves update sets between instances from a laptop or any continuous integration and continuous delivery (CI/CD) system (GitHub Actions, Jenkins, etc.), configured and invoked the same way as `now-sdk cicd`. Headline use case: "move update set N (or every update set matching `My-Project-*`) from instance X to instance Y."

Principles:

1. Depend on `@servicenow/sdk` and call its CLI for everything it already does (auth, table queries). Implement only what it lacks: update set export, XML upload, and the sn_cicd update set endpoints. Take conventions from its `cicd` commands; copy no code.
2. Ephemeral by default. `move` holds the XML in memory and writes no files. `export` and `import` exist for people who want files locally and manage them themselves.
3. Same auth as `now-sdk` headless: stored aliases locally, `SN_SDK_*` environment variables in CI, basic or OAuth.

## Verified facts this plan relies on

1. `now-sdk auth --print [alias] --format env|headers` resolves credentials through `credentialProvider` (dev/fluent `packages/cli/src/command/auth/index.ts:173`, `packages/cli/src/auth/index.ts`). That function honors CI mode (`SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL` + `SN_SDK_INSTANCE_URL` + `SN_SDK_AUTH_TYPE` + OAuth client ID/secret or `SN_SDK_USER`/`SN_SDK_USER_PWD`) and pre-authenticated sessions (`SN_SDK_SESSION_TOKEN`/`SN_SDK_SESSION_COOKIE` or `SN_SDK_SESSION_BEARER_TOKEN`). No `auth --add` is needed in CI.
2. `--format env` prints `SN_SDK_INSTANCE_URL` plus `SN_SDK_SESSION_*` exports. Passing those to later `now-sdk query` child processes reuses one login per instance.
3. `now-sdk query <table> -q <encoded> [-f fields] [--limit] [--display-value] [-a alias] [-o json] [-s path]` covers every read the tool does today.
4. `now-sdk cicd` conventions (4.13.6): `-a/--auth`, `-o json|raw`, `-s/--select`, `--wait` (default true), `--poll-timeout` (default 900000), mutually exclusive `--test-suite-sys-id`/`--test-suite-name`, exit code 1 on any failure.
5. sn_cicd update set endpoints (Yokohama and later): `preview/{id}`, `commit/{id}`, `commitMultiple`, `back_out`, `retrieve`, `create`, polled via `progress/{id}`. No REST endpoint exists for XML export or upload, so `export_update_set2.do` and `sys_upload.do` stay.
6. The CLI has no plugin mechanism, so this ships as its own package.

## Use cases

1. **List** update sets on an instance (default state `complete`).
2. **Move** one or more update sets from X to Y: export from X, check Y, upload, preview, commit. Once started it runs to completion with no prompts; approvals belong to the calling workflow (GitHub environments, Jenkins `input`). The only interactive prompt today (`push_update_set.py:414`, the conflict menu) becomes `--on-conflict`. The confirm-before-running step in `skills/push-update-set/SKILL.md` is Claude asking the user and stays in the skill. Preview conflicts are handled per "Conflict handling".
3. **Commit** retrieved update sets already on Y, e.g. after someone resolved preview problems in the UI.
4. **Rollback** a committed update set on Y via the platform's back out.
5. **Export** to local XML files (local convenience).
6. **Import** local XML files into Y (local convenience).

Existing `--tweak` behavior (new sys_ids, " vN" name, fresh timestamps) carries over as `--as-new-version` on `move` and `import`.

## Target existence check (move, import)

Before uploading each update set, query Y's `sys_remote_update_set`:

1. Not present: upload, preview, commit.
2. Present, not yet committed: skip upload, preview again, commit.
3. Present and committed: skip, report `already_committed`, exit 0.

Match key: start with name. Matching by sys_id is more reliable; `move` already has the XML in memory, so reading the source sys_id from it costs nothing, but which target field holds it is unconfirmed. Investigate later (see Open decisions).

`--as-new-version` bypasses the check by design, since it renames the update set.

## Conflict handling

Preview problems (e.g. "Found a local update that is newer than this one") stop the commit for that update set. `--on-conflict <mode>`:

1. `fail` (default): exit 1 and list the problems. The retrieved update set stays on Y. After someone resolves the problems in the UI, re-running the same `move` (or `commit`) picks it up through existence-check case 2.
2. `touch`: today's interactive option 1 as a flag. Rewrite `sys_updated_on` on every record to now, re-upload as a fresh retrieved update set, preview, commit. Incoming changes win.
3. `force`: commit with the platform's `force_commit=true`. The docs describe it as committing without a preview; whether it overrides recorded preview problems must be verified on xare before this mode ships.

For multiple update sets, nothing is committed if any preview fails (unless `--on-conflict` resolves it), so `commitMultiple` never runs on a partial set.

Investigate: whether preview problems can be resolved over REST (the UI's accept/skip remote update actions). If they can, add `--on-conflict accept-remote|skip-remote`.

## Command line interface (CLI)

Package and binary name are placeholders (`update-set-cicd`).

```
update-set-cicd <command> [options]

Commands:
  list         List update sets on an instance
  move         Copy update sets from --from to --to, preview, and commit
  commit       Commit retrieved update sets that are already previewed
  rollback     Back out a committed update set
  export       Write update sets to local XML files
  import       Load local XML files, preview, and optionally commit

Selecting update sets (move, commit, rollback, export):
      --update-set-name <name>     Name, or a pattern with * (e.g. "My-Project-*")
      --update-set-sys-id <id>     sys_id (mutually exclusive with --update-set-name)
      --state <state>              Source state filter (default: complete)

Instances:
  -a, --auth <alias>      Credential alias (list, commit, rollback, export, import)
      --from <alias>      Source alias (move)
      --to <alias>        Target alias (move)

Shared options (same meaning as now-sdk cicd):
  -o, --output <format>   json | raw
  -s, --select <path>     Extract one field of the JSON result
      --wait              Wait for async operations (default: true)
      --poll-timeout <ms> Max wait per async operation (default: 900000)
  -d, --debug
  -h, --help
  -v, --version
```

Per-command options:

1. `list`: `--filter <text>` (name contains), `-q, --query <encoded-query>`, `--limit <n>` (default 20). Delegates to `now-sdk query sys_update_set`.
2. `move`: `--on-conflict fail|touch|force`, `--as-new-version`, `--preview-only` (dry run, carried over from today's push: upload and preview, report problems, do not commit).
3. `commit`: selects retrieved update sets on the target. One match uses `commit/{id}`; several use `commitMultiple` in a defined order. `--force` maps to `force_commit`.
4. `rollback`: selects the local update set on the target that a commit created. `--no-rollback-installs` maps to `rollback_installs=false` (platform default true).
5. `export`: `--out-dir <dir>` (default `.`). One XML per update set.
6. `import <xml-file...>`: `--commit` (default stops after preview), `--on-conflict`, `--as-new-version`.

Exit codes: 0 success (including "already committed" skips), 1 any failure. JSON envelope: `{"ok": true, "result": {...}}` or `{"ok": false, "error": {"message": "...", "problems": [...]}}`.

Today's interactive menu (`push_update_set.py:622-660`) maps to `--on-conflict touch` (option 1). Option 2 (download the target's version) becomes "run `export -a <target>`".

## Authentication

Same as `now-sdk`. The tool spawns `now-sdk auth --print [alias] --format env` once per instance and passes the resulting session variables to its own HTTP calls and to `now-sdk query` children.

1. Local: `-a`, `--from`, `--to` take stored aliases (`now-sdk auth --add`).
2. CI, one instance (list, commit, rollback, export, import): the standard `SN_SDK_*` variables, identical to a `now-sdk cicd install` step.
3. CI, two instances (`move`): target uses the standard `SN_SDK_*` variables. Source uses the same names with a `SN_SDK_SOURCE_` prefix (`SN_SDK_SOURCE_INSTANCE_URL`, `SN_SDK_SOURCE_AUTH_TYPE`, `SN_SDK_SOURCE_OAUTH_CLIENT_ID`, `SN_SDK_SOURCE_OAUTH_CLIENT_SECRET`, `SN_SDK_SOURCE_USER`, `SN_SDK_SOURCE_USER_PWD`). The tool maps them onto `SN_SDK_*` only in the child environment it uses for the source.

## Sample docs (as if built)

### Run it

```bash
npx github:<owner>/update-set-tools --help
```

Requires Node.js 20.18 or later. `@servicenow/sdk` is a dependency, so no separate install is needed.

### Authenticate

Locally, use your Now SDK aliases. In CI, set the same variables a `now-sdk cicd` step uses. For `move`, add `SN_SDK_SOURCE_*` for the source instance.

### Examples

1. List completed update sets for a project:

   ```bash
   npx github:<owner>/update-set-tools list --filter My-Project -a dev
   ```

2. Move every completed `My-Project-*` update set from dev to test:

   ```bash
   npx github:<owner>/update-set-tools move --update-set-name "My-Project-*" --from dev --to test
   ```

   ```
   Auth: dev (https://dev123.service-now.com)
   Auth: test (https://test123.service-now.com)
   Found 3 update sets matching "My-Project-*" (state complete)
     My-Project-1 data model     already committed on test, skipped
     My-Project-2 forms          uploaded, preview clean
     My-Project-3 flows          uploaded, preview clean
   Waiting for operation to complete (progress id: 88d0...)...
   Operation completed: committed 2 update sets
   ```

3. After resolving preview problems in the UI, finish the move (or re-run the same `move`):

   ```bash
   npx github:<owner>/update-set-tools commit --update-set-name "My-Project-*" -a prod
   ```

4. Roll back:

   ```bash
   npx github:<owner>/update-set-tools rollback --update-set-name "My-Project-3 flows" -a prod
   ```

5. Preview conflict (exit 1, JSON):

   ```json
   {"ok": false, "error": {"message": "Preview found 1 problem in My-Project-2 forms", "problems": [
     {"update_set": "My-Project-2 forms", "type": "Error", "description": "Found a local update that is newer than this one"}
   ]}}
   ```

### GitHub Actions

```yaml
jobs:
  move-to-prod:
    environment: production   # any approval lives in the workflow, before the move
    runs-on: ubuntu-latest
    env:
      SN_SDK_NODE_ENV: SN_SDK_CI_INSTALL
      SN_SDK_AUTH_TYPE: oauth
      SN_SDK_INSTANCE_URL: ${{ vars.SN_SDK_PROD_INSTANCE_URL }}
      SN_SDK_OAUTH_CLIENT_ID: ${{ secrets.SN_SDK_PROD_OAUTH_CLIENT_ID }}
      SN_SDK_OAUTH_CLIENT_SECRET: ${{ secrets.SN_SDK_PROD_OAUTH_CLIENT_SECRET }}
      SN_SDK_SOURCE_AUTH_TYPE: oauth
      SN_SDK_SOURCE_INSTANCE_URL: ${{ vars.SN_SDK_TEST_INSTANCE_URL }}
      SN_SDK_SOURCE_OAUTH_CLIENT_ID: ${{ secrets.SN_SDK_TEST_OAUTH_CLIENT_ID }}
      SN_SDK_SOURCE_OAUTH_CLIENT_SECRET: ${{ secrets.SN_SDK_TEST_OAUTH_CLIENT_SECRET }}
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npx github:<owner>/update-set-tools move --update-set-name "${{ inputs.pattern }}" -o json
```

No files are written; the XML stays in memory for the duration of the step.

### Jenkins

```groovy
pipeline {
  agent any
  environment {
    SN_SDK_NODE_ENV = 'SN_SDK_CI_INSTALL'
    SN_SDK_AUTH_TYPE = 'oauth'
    SN_SDK_INSTANCE_URL = "${PROD_URL}"
    SN_SDK_OAUTH_CLIENT_ID = credentials('sn-prod-client-id')
    SN_SDK_OAUTH_CLIENT_SECRET = credentials('sn-prod-client-secret')
    SN_SDK_SOURCE_AUTH_TYPE = 'oauth'
    SN_SDK_SOURCE_INSTANCE_URL = "${TEST_URL}"
    SN_SDK_SOURCE_OAUTH_CLIENT_ID = credentials('sn-test-client-id')
    SN_SDK_SOURCE_OAUTH_CLIENT_SECRET = credentials('sn-test-client-secret')
  }
  stages {
    stage('Move to prod') { steps { sh 'npx github:<owner>/update-set-tools move --update-set-name "$PATTERN"' } }
  }
}
```

## Delivery

`npx github:<owner>/<repo>` installs straight from a GitHub repository with no registry. Requirements: `package.json` with a `bin` entry, and either no build step (plain JavaScript, ESM) or a `prepare` script. Plan: plain JavaScript, no build, so install is a clone plus `npm install`. Private repos need Git credentials on the runner. Publishing to npmjs.org later is a `package.json` change.

## Implementation outline

1. `package.json` (`bin`, `type: module`, dependencies `@servicenow/sdk` pinned to 4.13.6 or later, `yargs`, an XML library), `bin/update-set-cicd.js`.
2. `src/sdk.js`: spawn the dependency's `now-sdk` binary. `authEnv(aliasOrEnvPrefix)` runs `auth --print --format env` and parses exports (replaces `scripts/snlib.py:56-213`). `query(table, opts, env)` wraps `now-sdk query -o json`.
3. `src/http.js`: fetch with session headers, OAuth CSRF lookup (port `upload_session`, `scripts/snlib.py:144`), `exportXml` (`export_update_set2.do`), `uploadXml` (`sys_upload.do`, port `scripts/push_update_set.py:337-399`).
4. `src/cicd.js`: preview, commit, commitMultiple, back_out, progress polling with now-sdk-style messages and status codes.
5. `src/xml.js`: port `tweak_xml`, `next_version_name` (`scripts/push_update_set.py:258-334`) and touch-timestamps.
6. `src/select.js`: `--update-set-name` with `*` to an encoded query (`*` suffix to `STARTSWITH`, other positions to `LIKE`), `--update-set-sys-id`, `--state`.
7. `src/commands/{list,move,commit,rollback,export,import}.js`, `src/output.js` (TTY text vs `-o json`, `-s` path).
8. Repoint `skills/*/SKILL.md` to the Node CLI; delete `scripts/*.py` after parity is verified.

## Verification

1. Against xare and xareo only (never zorb), with a basic alias and an OAuth alias: list, move (single, wildcard, already-committed, already-retrieved), each `--on-conflict` mode against a deliberate newer-on-target conflict, commit after UI resolution, commitMultiple order, rollback, export, import.
2. CI mode on a laptop: unset aliases, set `SN_SDK_*` and `SN_SDK_SOURCE_*` for xare/xareo, run `move`. Then the GitHub Actions sample in a scratch repo.
3. Confirm `sys_remote_update_set` fields and state values used by the existence check on xare.
4. `-o json` parses for every command; exit codes are 0/1.
5. Parity: Node and Python exports of the same update set produce identical XML.

## Open decisions

1. Commit order for multiple matches (`commitMultiple` requires an order): source `sys_created_on` ascending, or name order.
2. `SN_SDK_SOURCE_` prefix for the source instance in `move`.
3. Repository owner for `npx github:` delivery.
4. Existence-check match key (name vs source sys_id). Investigate later.
5. Whether `force_commit` overrides preview problems, and whether problems can be resolved over REST.
