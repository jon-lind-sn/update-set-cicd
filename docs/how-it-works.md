# How the pipeline works

A graphic version of this flow is in [developer-workflow.html](https://htmlpreview.github.io/?https://github.com/jon-lind-sn/update-set-cicd/blob/main/docs/developer-workflow.html). The workflow files are described in [.github/workflows/README.md](../.github/workflows/README.md).

## The flow

1. A developer changes the Fluent app on a branch and bumps `version` in `package.json`.
2. A pull request (PR) starts `Sample PR validation`. It installs dependencies, runs `now-sdk build --frozenKeys` (which fails if `keys.ts` is out of date), and runs `update-set-cicd generate` to produce the update set XML. The XML is uploaded as the `update-set` artifact. No instance is touched.
3. A merge to `main` starts `Sample deploy to Prod`. It builds once and uploads the same artifact.
4. `deploy-test` downloads the artifact and runs `update-set-cicd import --to-env TEST --commit`: upload, preview, commit.
5. `approve-prod` waits for a reviewer on the `production` environment.
6. `deploy-prod` imports and commits the same file on PROD.

## Update set identity

`generate` derives every id in the file from the app content, so one update set maps to one set of ids.

1. Unchanged content keeps its ids. The import finds the update set already on the instance and reports it as already committed. That is a skip, not an error. Someone may already have moved it by hand.
2. Changed content or a new version gets new ids and loads as a new update set.
3. Each `now-sdk build` writes a random serial number and timestamp into an SBOM (software bill of materials) record. They are left out of the ids, so rebuilding unchanged source does not create a new update set. `generate --replace` includes them, which makes every new build a new update set. It exists to repair a stuck copy and is not part of the normal flow.
4. To reload a committed update set, bump the version.

## Preview problems

`import` and `move` stop when the preview finds a problem, such as a newer local update to one of the same records. Nothing is committed and the log lists each problem with a link to the retrieved update set on the instance. `--on-conflict force` commits anyway.

## Authentication

Every command takes credentials from `SN_SDK_<NAME>_*` variables (`--to-env PROD` reads `SN_SDK_PROD_*`) or from a stored Now SDK alias. With `SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL` the Now SDK performs the OAuth client credentials grant itself, so the tool never handles the client secret directly. Empty variables are ignored, so an OAuth-only setup does not need `USER` or `USER_PWD`.
