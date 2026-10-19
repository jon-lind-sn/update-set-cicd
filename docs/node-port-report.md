# Node Port: Test Report (2026-10-15)

Branch `claude/worktree-setup-check-ef290f`, uncommitted. Plan: `~/.claude/plans/i-want-to-evaluate-lively-key.md`.

## Summary

The Node command line interface (CLI) `update-set-cicd` is built and passes the six use cases from the plan against xare (source) and yoyo (target), over basic and Open Authorization (OAuth) aliases and over continuous integration (CI) environment-variable mode. Two items need a decision: `--on-conflict touch` does not clear "newer local update" problems, and the Claude skills still call the Python scripts.

## What was built

1. `package.json`: dependencies `@servicenow/sdk` 4.13.6, `yargs` 17.7.2, `@xmldom/xmldom` 0.9.12. Plain JavaScript (ES modules), no build step.
2. `bin/update-set-cicd.js`: commands `list`, `move`, `commit`, `rollback`, `export`, `import`; shared flags `-a/--auth`, `-o json|raw`, `-s/--select`, `--wait`, `--poll-timeout`, `-d/--debug` (same names as `now-sdk cicd`).
3. `src/sdk.js`: auth via `now-sdk auth --print --format env`; all table reads via `now-sdk query`. `--from`/`--to`/`-a` take aliases; without them, `move` reads the source from `SN_SDK_SOURCE_*` and the target from `SN_SDK_*`.
4. `src/http.js`: `export_update_set2.do`, `sys_upload.do`, OAuth Cross-Site Request Forgery (CSRF) lookup (ported from `snlib.py`).
5. `src/cicd.js`: sn_cicd preview, commit, commitMultiple, back_out, progress polling with now-sdk style messages.
6. `src/deliver.js`: existence check, upload, preview, conflict handling, commit.
7. `src/xml.js`, `src/select.js`, `src/output.js`: Extensible Markup Language (XML) rewrite (`--as-new-version`, touch), wildcard names, text vs JSON envelope.

## Test results

Test data: update sets `UST-Test-1 alpha` through `UST-Test-5 delta` on xare, each changing one `ust.test.*` system property.

| # | Test | Instances | Result |
|---|---|---|---|
| 1 | `list` text, `-o json`, `-s ... -o raw` | xare, xareo, yoyo | Pass |
| 2 | `export --update-set-name "UST-Test-*"` | xare, xareo | Pass. XML matches the Python export except per-export timestamps and generated sys_ids |
| 3 | `move "UST-Test-*"` (2 sets, `commitMultiple`) | xare → yoyo | Pass. Both properties on yoyo |
| 4 | Same `move` again | xare → yoyo | Pass. Both skipped as already committed, exit 0 |
| 5 | Conflict, default `--on-conflict fail` | xareo → yoyoauth | Pass (after fix 1). Exit 1, problem, conflicting local update set, and link to the retrieved update set |
| 6 | Re-run after conflict | xareo → yoyoauth | Pass. Reuses the previewed copy, does not re-preview |
| 7 | `--as-new-version` | xareo → yoyoauth | Pass. Uploaded as "UST-Test-3 alpha3 v 2" |
| 8 | `--on-conflict touch` | xareo → yoyoauth | **Fail.** Still "Found a local update that is newer than this one" (see Open items 1) |
| 9 | `commit --force` on the conflicting set | yoyoauth | Pass. `force_commit` overrides the problem; value committed |
| 10 | `commit` with duplicate retrieved copies | yoyoauth | Pass (after fix 2) |
| 11 | `rollback` | yoyo | Pass. Back out restored the yoyo value |
| 12 | `import` of files already committed | yoyo | Pass. Matched on `remote_sys_id`, skipped |
| 13 | CI mode: no aliases, `SN_SDK_SOURCE_*` + `SN_SDK_*` | xare → yoyo | Pass. Used pre-authenticated session variables, not the client credentials grant (see Open items 4) |
| 14 | `move --preview-only`, then `commit --no-wait` | xare → yoyo | Pass. Commit sat in the platform queue about 1 minute, then completed |
| 15 | Errors: no match, unknown alias, bad sys_id, missing selection | xare | Pass. Clear message, exit 1 |
| 16 | `npx --package <tarball> update-set-cicd` from a clean directory | xare | Pass |

## Fixes made during testing

1. Preview with problems reports progress status 3 (Failed). The poller threw before problems were read. Preview now returns its result and the problem table decides.
2. `commit --update-set-name` matched every uncommitted retrieved copy of one source. It now keeps the latest copy per source sys_id.
3. `@servicenow/sdk` hides `package.json` behind its `exports` map, so the SDK path is found by searching `node_modules` lookup paths.

## Findings that answer plan questions

1. Existence check (open decision 4): `sys_remote_update_set.remote_sys_id` holds the source update set's sys_id, and the exported XML carries it. The tool matches on it. `update_set` on that record points to the local update set the commit created.
2. Preview problems: `sys_update_preview_problem.status` is empty when unresolved, else `ignored`, `skipped`, or `skip_collision`. Re-previewing regenerates problems and discards UI resolutions, so a previewed copy is checked, not re-previewed.
3. `force_commit=true` commits over a "newer local update" error (open decision 5, first half).
4. `now-sdk query` and `auth --print` honor `SN_SDK_SESSION_*` variables, so each instance logs in once per run.

## Open items from testing (2026-10-15)

Items 1 to 3 are superseded by "Decisions" and "Open items for resume" below (touch dropped, skills stay Python, delivery moves to github.com).

1. **Touch mode does not work.** Rewriting `sys_updated_on` (what Python option 1 did) and `sys_recorded_at` (11 hex digits of epoch milliseconds plus a counter) both left the problem in place. Untested guess: preview compares the timestamp inside each record's `payload`. Options: investigate further, or drop `touch` and keep `fail` and `force`.
2. **Skills still call Python.** The installed plugin has no `node_modules`, so a skill needs a way to run the CLI (for example `npx --package ${CLAUDE_PLUGIN_ROOT} update-set-cicd ...`). Untested. Python scripts and README are unchanged.
3. **Delivery from code.devsnc.com.** The remote is GitHub Enterprise, so `npx github:` does not apply; the equivalent is `npx --package git+https://code.devsnc.com/jon-lind/update-set-tools.git update-set-cicd ...`. Untested until pushed.
4. **Client credentials grant in CI.** Not tested (needs real OAuth client secrets). Plumbing is shared with test 13; the grant itself is now-sdk code.
5. **Commit order for wildcards** (open decision 1): implemented as source `sys_created_on` ascending.
6. **Retrieved-copy clutter.** Each touch attempt and `--as-new-version` run leaves a retrieved update set on the target. Consider cleanup or leaving it to the user.
7. **Node 20 warning.** `npm install` warns that `cookie@2.0.1` (a now-sdk dependency) wants Node 22. Everything ran on Node 20.20.2.

## Test data left on instances

1. xare: update sets `UST-Test-1 alpha` through `UST-Test-5 delta`; properties `ust.test.alpha|beta|gamma|delta`.
2. yoyo: update set `UST-Local yoyo alpha`; same properties; retrieved update sets for UST-Test-1 to 5 (some committed, three stale previewed copies of UST-Test-3); UST-Test-3 backed out.
3. Your current update set preference on both instances was restored to its original value.

## Decisions (2026-10-16)

1. **Two repos.** The Node tool moves to a new public repo, `github.com/jon-lind-sn/update-set-cicd`, MIT license, its own versioning and package. This repo keeps the Python Claude plugin as a frozen local demo kit (conflict scenarios, `--tweak`, touch); no maintenance commitment. Moving the files only touches worktree branch `claude/worktree-setup-check-ef290f`; `main` is unaffected.
2. **Drop `--on-conflict touch`** from Node. Conflicts are resolved in the instance UI (accept/skip remote update on the preview problems), then the job is re-run. Keep `fail` (default) and `force`.
3. **Drop `--as-new-version`** from Node (test-scenario tooling from `--tweak`).
4. **Commit order** for wildcard matches: source `sys_created_on` ascending (as built).
5. **GitHub Actions workflows** come later. Validate fully locally first.
6. **Test data** on xare and yoyo stays; no cleanup.

## Open items for resume

1. **Node version floor.** Test with Node 22 (not installed; Node 24.14.1 is, and dev-passport-brazil uses 24). If both the tool and now-sdk run clean, raise `engines.node` from 20.18. The Node 24 test run was not executed yet.
2. **Source-instance environment variables are new.** now-sdk reads one instance from `SN_SDK_*`. `move` needs a second instance in the same process, so any source variables (built as `SN_SDK_SOURCE_*`) are names now-sdk does not define. Goal: no extra IDs or secrets beyond the now-sdk CI configuration. Options to weigh:
   1. Reuse the dev-passport-brazil repo variable and secret names directly: `move --from-env TEST --to-env PROD` reads `SN_SDK_TEST_*` and `SN_SDK_PROD_*` (`INSTANCE_URL`, `AUTH_TYPE`, `USER`, `USER_PWD`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`) and maps each onto `SN_SDK_*` for its own now-sdk child. Same secrets as the existing workflows, no new names.
   2. Two steps, each with plain `SN_SDK_*`: `export` in a step configured for the source, `import --commit` in a step configured for the target. No new variables, but the XML must pass between steps as a file (conflicts with "ephemeral by default").
   3. Keep `SN_SDK_SOURCE_*` and document it.
3. **OAuth client credentials testing.** Tested so far: OAuth aliases and pre-authenticated session variables (`SN_SDK_SESSION_BEARER_TOKEN`). Not tested: the client credentials grant (`SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL`, `SN_SDK_AUTH_TYPE=oauth`, client ID and secret). Claude must not see or type the secrets. Options:
   1. GitHub Actions in the new repo: client IDs and secrets as repo secrets for xare and yoyo, run `move` there. Tests the real scenario; secrets never enter a Claude session. Blocked on item 5 of Decisions (workflows later) unless a minimal smoke workflow is allowed.
   2. Local via macOS Keychain: Jon creates Keychain entries (`security add-generic-password`) for each client secret; a wrapper script reads them into `SN_SDK_*` only in the child process environment and runs the tool. Claude runs the wrapper and sees only tool output. Watch for: `-d/--debug` must never print environment values; shell tracing (`set -x`) off.
   3. Prerequisites either way (from the dev-passport-brazil setup): `glide.oauth.inbound.client.credential.grant_type.enabled=true` (KB1645212), a service user with admin, an OAuth Client Credentials Grant inbound integration per instance.
4. **Repo split steps.** Create the GitHub repo, move `bin/`, `src/`, `package.json`, `package-lock.json`, `docs/node-port-*.md`, add LICENSE (MIT) and README from the plan's sample docs, then remove the Node files from this worktree. Creating the public repo and pushing need Jon's go-ahead at that point.
5. **Delivery.** `npx github:jon-lind-sn/update-set-cicd` once public; npmjs.org publishing optional later.

## Resume log (2026-10-16)

1. Removed `--on-conflict touch`, `--as-new-version`, `touchTimestamps`, `asNewVersion`, and `nextVersionName` from the Node code (Decisions 2 and 3).
2. Node 24.14.1 run: `list` and `move "UST-Test-*"` xare to yoyo pass with now-sdk 4.13.6. Four sets skipped as already committed; UST-Test-3 reported its expected "newer local update" problem (it was backed out earlier) with exit 1. Node 22 not installed; `engines.node` left at 20.18.
3. Still open: item 2 (source variable names), item 3 (OAuth client credentials), item 4 (repo split, needs go-ahead).
4. Decision (2026-10-16): `engines.node` is now `>=22`. Source variables use the dev-passport-brazil style: `move --from-env TEST --to-env PROD` reads `SN_SDK_TEST_*` and `SN_SDK_PROD_*`; `SN_SDK_SOURCE_*` is removed. `--from` or `--from-env` is now required. Smoke-tested with session variables mapped to `SN_SDK_TEST_*`/`SN_SDK_PROD_*` (xare to yoyo). Repo `jon-lind-sn/update-set-cicd` exists (private) and is the origin remote; goes public before GitHub Actions testing.

## Spike: app to update set (2026-10-16)

1. `now-sdk build` output (`dist/app`) of dev-passport-brazil 0.0.21 converted with `update-set-gen/gen_update_set.py` (35 records, 2 DELETE actions already present) imported to yoyo, previewed clean, and committed. App version on yoyo is 0.0.21.
2. Generator bug: root `<application>` holds the scope name, platform needs the scope sys_id. Worked around with `sed`; note at `snconnect/docs/gen-update-set-scope-id-issue.md`.
3. Re-importing a corrected file with unchanged ids reuses the earlier retrieved copy. A `--replace` option is a candidate.
4. Poll default timeout is now 120000 ms (now-sdk uses 900000) and progress prints every 10 s with status. A job stuck at Pending adds a hint on timeout. A stalled yoyo scheduler caused a long wait earlier; it recovered by itself.
5. Not yet verified: that DELETE records remove records on the target.

## Next steps (2026-10-16)

1. **`--replace` flag** on `move` and `import`. Skips the retrieved-copy reuse check for that run: uploads the XML as a new retrieved update set and previews it. Reason: the existence check keys on source sys_id (`remote_sys_id`), so a corrected file with unchanged ids silently reuses the earlier copy (seen in the app-to-update-set spike). Later option: detect changed content automatically (hash of the XML) so the flag is rarely needed.
2. Sample SDK app inside this repo; use it to test that DELETE records remove records on the target.
3. Tier 1 unit tests (`node:test`) as the first GitHub Actions job (Node 22 and 24, no secrets).
4. `scripts/integration.sh` with stages (unit, seed, move, assert, cleanup) that the workflow reuses. Seed with the `sn_cicd` update set `create` endpoint plus Table API fix script records named `UST-IT-<runid>`; no system properties, no instance changes. Verify whether `create` sets the new update set as current.
5. Run the OAuth client credentials grant (open item 3 above) and Node 22.
6. Push to `jon-lind-sn/update-set-cicd` (private) when Jon says so.

## Decision (2026-10-19): Node 22

1. Node 22 is the supported minimum and the version the GitHub Actions workflows run. Closed; no further version testing is planned beyond the unit test matrix (22 and 24).
