#!/usr/bin/env node
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import * as cmd from '../src/commands.js'
import { Output } from '../src/output.js'

const run = (fn) => async (args) => {
    const log = new Output(args)
    try {
        await fn(log, args)
    } catch (e) {
        log.fail(e)
    }
}

// Same names and meanings as now-sdk cicd.
const shared = (y) =>
    y
        .option('output', { alias: 'o', type: 'string', choices: ['json', 'raw'], describe: 'Output format: json for a machine-readable envelope, raw to unquote the --select result' })
        .option('select', { alias: 's', type: 'string', describe: 'Dot/bracket path to extract from the output (e.g. "result.update_sets[0].remote_update_set")' })
        .option('debug', { alias: 'd', type: 'boolean', default: false, describe: 'Print debug output' })

const waitOpts = (y) =>
    y
        .option('wait', { type: 'boolean', default: true, describe: 'Wait for the operation to finish by polling its progress' })
        .option('poll-timeout', { type: 'number', default: 120000, describe: 'Maximum time in milliseconds to wait for each operation (progress prints every 10s)' })

const auth = (y) => y.option('auth', { alias: 'a', type: 'string', describe: 'Credential alias to use for authentication with instance' })

const selection = (y, { state = true } = {}) => {
    y.option('update-set-name', { type: 'string', describe: 'Update set name, or a pattern with * (e.g. "My-Project-*") (mutually exclusive with --update-set-sys-id)' })
        .option('update-set-sys-id', { type: 'string', describe: 'sys_id of the update set (mutually exclusive with --update-set-name)' })
        .conflicts('update-set-name', 'update-set-sys-id')
        .check((a) => {
            if (!a.updateSetName && !a.updateSetSysId) throw new Error('Provide --update-set-name or --update-set-sys-id')
            return true
        })
    if (state) y.option('state', { type: 'string', default: 'complete', describe: 'State of the source update set' })
    return y
}

// Shared by move and import so both preview by default and commit only with --commit.
const conflict = (y) =>
    y
        .option('commit', { type: 'boolean', default: false, describe: 'Commit after a clean preview (without it, upload and preview only)' })
        .option('on-conflict', { type: 'string', choices: ['fail', 'force'], default: 'fail', describe: 'Preview problems: fail (stop, nothing committed; resolve in the instance UI and re-run) or force (force_commit)' })

yargs(hideBin(process.argv))
    .scriptName('update-set-cicd')
    .usage('$0 <command> [options]\n\nMove ServiceNow update sets between instances using Now SDK credentials.')
    .command('list', 'List update sets on an instance', (y) =>
        shared(auth(y))
            .option('filter', { type: 'string', describe: 'Name contains' })
            .option('state', { type: 'string', default: 'complete', describe: 'Update set state' })
            .option('query', { alias: 'q', type: 'string', describe: 'Additional encoded query' })
            .option('limit', { type: 'number', default: 20, describe: 'Maximum results' }),
        run(cmd.list))
    .command('move', 'Copy update sets from --from to --to and preview them; commit with --commit', (y) =>
        shared(waitOpts(conflict(selection(y))))
            .option('from', { type: 'string', describe: 'Source credential alias' })
            .option('from-env', { type: 'string', describe: 'Source from environment variables SN_SDK_<NAME>_* (e.g. TEST reads SN_SDK_TEST_INSTANCE_URL)' })
            .option('to', { type: 'string', describe: 'Target credential alias (default: SN_SDK_* environment variables or the default alias)' })
            .option('update-source', { type: 'string', describe: 'Update Source on the target to retrieve from: sys_id, name, or instance ID (default: the one whose URL is the source)' })
            .option('to-env', { type: 'string', describe: 'Target from environment variables SN_SDK_<NAME>_* (e.g. PROD reads SN_SDK_PROD_INSTANCE_URL)' })
            .example('$0 move --from dev --to test --update-set-name "My Update Set"', 'Preview only')
            .example('$0 move --from dev --to test --update-set-name "My Update Set" --commit', 'Preview, then commit'),
        run(cmd.move))
    .command('commit', 'Commit retrieved update sets that are already on the instance', (y) =>
        shared(waitOpts(auth(selection(y, { state: false }))))
            .option('force', { type: 'boolean', default: false, describe: 'Commit despite unresolved preview problems (force_commit)' }),
        run(cmd.commit))
    .command('rollback', 'Back out a committed update set', (y) =>
        shared(waitOpts(auth(selection(y, { state: false }))))
            .option('rollback-installs', { type: 'boolean', default: true, describe: 'Also roll back batch installs made by the commit (--no-rollback-installs to keep them)' }),
        run(cmd.rollback))
    .command('export', 'Write update sets to local XML files', (y) =>
        shared(auth(selection(y)))
            .option('out-dir', { type: 'string', default: '.', describe: 'Directory to write XML files to' }),
        run(cmd.exportCmd))
    .command('generate <app-dir>', 'Build an update set XML from a now-sdk build output folder (dist/app)', (y) =>
        shared(y)
            .positional('app-dir', { type: 'string', describe: 'Folder holding sys_app_<sys_id>.xml and update/ (e.g. dist/app)' })
            .option('out-dir', { type: 'string', default: '.', describe: 'Directory to write the update set XML to' })
            .option('replace', { type: 'boolean', default: false, describe: 'Include the build-specific SBOM values (serialNumber, timestamp) in the ids, so each new build is a new update set' }),
        run(cmd.generateCmd))
    .command('import <files..>', 'Load one or more XML files (a.xml b.xml or a glob) and preview them; commit with --commit', (y) =>
        shared(waitOpts(conflict(auth(y))))
            .positional('files', { type: 'string', describe: 'One or more update set XML files separated by spaces, or a shell wildcard such as *.xml. They are loaded and committed in the order given' })
            .option('to', { type: 'string', describe: 'Target credential alias (same as --auth)' })
            .option('to-env', { type: 'string', describe: 'Target from environment variables SN_SDK_<NAME>_* (e.g. PROD reads SN_SDK_PROD_INSTANCE_URL), instead of --to' })
            .example('$0 import 01-base.xml 02-feature.xml --to dev', 'Preview two files, in that order')
            .example('$0 import *.xml --to dev', 'Preview only')
            .example('$0 import *.xml --to dev --commit', 'Preview, then commit')
            .example('$0 import STRY12345-*.xml --to dev', 'Every file for one story (STRY12345-1.xml, STRY12345-2.xml, ...)')
            .example('$0 import STRY12345-?.xml --to dev', 'One character only (-1 to -9, not -10)'),
        run(cmd.importCmd))
    .epilogue('Run "update-set-cicd <command> --help" for the options and examples of one command, such as "update-set-cicd import --help".')
    .demandCommand(1)
    .strictCommands()
    .strict()
    .alias('h', 'help')
    .alias('v', 'version')
    .wrap(null)
    .parse()
