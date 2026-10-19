# Workflows

This repository holds two things, and each has its own workflows.

1. **The module** (`bin/`, `src/`, `test/`): the `update-set-cicd` command line tool.
   1. [`ci.yml`](ci.yml) runs the unit tests on every pull request (PR) and push to `main` that touches module files. It needs no secrets and never touches an instance.
2. **The sample app** (`update-set-cicd-sample/`): a Now SDK Fluent app that demonstrates the pipeline.
   1. Sample workflows use the `sample-` prefix and trigger only on changes under `update-set-cicd-sample/`. They follow the dev-passport-brazil layout: a PR validation workflow, a deploy workflow with a `production` approval gate, and a shared library workflow. They are added next.
3. [`move-update-sets.yml`](move-update-sets.yml) is a reusable workflow (`workflow_call`) that other repositories call to promote update sets from TEST to PROD. It never triggers on its own.

Node version: `.nvmrc` is the single source. `ci.yml` reads it with `node-version-file`. `move-update-sets.yml` has no checkout of this repository and hardcodes the same version.

Credentials: variable, secret, and environment names are listed in the "Set up GitHub and ServiceNow" section of the top-level README.
