# update-set-cicd

Move ServiceNow update sets between instances from a laptop or any continuous integration and continuous delivery (CI/CD) system, configured and invoked the same way as `now-sdk cicd`.

**Status: work in progress.** The design is in [docs/node-port-plan.md](docs/node-port-plan.md) and the latest test results and open items are in [docs/node-port-report.md](docs/node-port-report.md).

## Requirements

1. Node.js 22 or later.
2. ServiceNow Now SDK credentials (`@servicenow/sdk` is a dependency; no separate install).

## Quick start

```bash
npm install
node bin/update-set-cicd.js --help
node bin/update-set-cicd.js list -a <alias>
node bin/update-set-cicd.js move --update-set-name "My-Project-*" --from <source-alias> --to <target-alias>
```

## CI/CD credentials

`move` reads each instance from the same variables `now-sdk` uses in CI, with the instance name inserted: `--from-env TEST --to-env PROD` reads `SN_SDK_TEST_*` and `SN_SDK_PROD_*` (`INSTANCE_URL`, `AUTH_TYPE`, `USER`, `USER_PWD`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`). Single-instance commands read plain `SN_SDK_*`.

## License

MIT
