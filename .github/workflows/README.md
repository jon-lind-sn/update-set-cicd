# Workflows

This repository holds two things, and each has its own workflows. Trigger workflows have plain names, and library workflows (`workflow_call`, never triggered on their own) start with an underscore.

## The module (`bin/`, `src/`, `test/`)

1. [`ci.yml`](ci.yml) runs the unit tests on every pull request (PR) and push to `main` that touches module files. It needs no secrets and never touches an instance.

## The sample app (`update-set-cicd-sample/`)

1. [`sample-pr-validation.yml`](sample-pr-validation.yml) runs on every PR that changes the sample or the tool that processes it. It builds the app and generates the update set. It touches no instance. The generated XML is attached to the run as the `update-set` artifact.
2. [`sample-deploy-main.yml`](sample-deploy-main.yml) runs on every merge to `main` that changes the sample or the tool, and can be started by hand (`workflow_dispatch`). It runs these jobs in order:
   1. `build` builds once and generates the update set.
   2. `deploy-test` imports, previews, and commits that update set on TEST.
   3. `deploy-prod` pauses for a reviewer on the `production` environment, then moves the committed update set from TEST to PROD with `_move-update-sets.yml`.
3. [`_sample-build.yml`](_sample-build.yml) is the library workflow for the build and generate steps. It runs `now-sdk build --frozenKeys`, then `update-set-cicd generate`, then uploads the artifact and outputs the update set name.
4. [`_import-update-set.yml`](_import-update-set.yml) is the library workflow that downloads the artifact and commits it on one instance (`TEST` or `PROD`) with `update-set-cicd import --to-env`. A preview problem stops the run and nothing is committed (`on-conflict: fail`).

Both sample trigger workflows run the tool from the checkout, so a PR is tested against its own code.

## For other repositories

1. [`_move-update-sets.yml`](_move-update-sets.yml) is a reusable workflow that other repositories call to move existing update sets from TEST to PROD with `update-set-cicd move`. It has no checkout of this repository and fetches the tool with `npx github:`.

## Node version and credentials

1. `.nvmrc` is the single source for the Node version. Workflows with a checkout read it with `node-version-file`. `_move-update-sets.yml` has no checkout and hardcodes the same version.
2. Variable, secret, and environment names are listed in the "Set up the pipeline" section of the top-level README.
