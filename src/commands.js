import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { connect } from './sdk.js'
import { Http } from './http.js'
import { Cicd } from './cicd.js'
import { deliver } from './deliver.js'
import { UpdateSetXml } from './xml.js'
import { generate } from './generate.js'
import { selectionQuery, describeSelection } from './select.js'
import { c } from './output.js'

async function open(log, args, which) {
    const inst = await connect(which)
    log.info(c.dim(`Auth: ${inst.label} (${inst.url})`))
    const http = new Http(inst)
    return { inst, http, cicd: new Cicd(http, log, { pollTimeout: args.pollTimeout }) }
}

// --from/--to take a stored alias; --from-env/--to-env NAME read SN_SDK_NAME_*
// (same variable names as SN_SDK_*, e.g. SN_SDK_TEST_INSTANCE_URL).
// The target alone may fall back to plain SN_SDK_* or the default alias.
function instanceRef(alias, envName, flag, optional = false) {
    if (alias && envName) throw new Error(`Use either ${flag} or ${flag}-env, not both`)
    if (alias) return { alias }
    if (envName) return { prefix: `SN_SDK_${envName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_` }
    if (!optional) throw new Error(`Provide ${flag} <alias> or ${flag}-env <NAME>`)
    return {}
}

// Local update sets on the source matching the selection, oldest first (commit order).
async function sourceUpdateSets(inst, args) {
    const rows = await inst.query('sys_update_set', {
        query: `${selectionQuery(args)}^state=${args.state}^ORDERBYsys_created_on`,
        fields: 'sys_id,name,state,sys_created_on,sys_updated_on',
        limit: 500,
    })
    if (!rows.length) throw new Error(`No update set matching ${describeSelection(args)} with state '${args.state}' on ${inst.label}`)
    return rows
}

export async function list(log, args) {
    const { inst } = await open(log, args, { alias: args.auth })
    const q = [`state=${args.state}`]
    if (args.filter) q.push(`nameLIKE${args.filter}`)
    if (args.query) q.push(args.query)
    q.push('ORDERBYDESCsys_updated_on')
    const rows = await inst.query('sys_update_set', {
        query: q.join('^'),
        fields: 'sys_id,name,state,sys_updated_on,application',
        displayValue: 'true',
        limit: args.limit,
    })
    const w = Math.min(50, Math.max(4, ...rows.map((r) => r.name.length)))
    const lines = rows.map((r, i) => `  ${c.cyan(String(i + 1).padStart(3))}  ${r.name.slice(0, 50).padEnd(w)}  ${c.dim(r.sys_updated_on)}  ${r.sys_id}`)
    const text = rows.length
        ? `\n  ${c.bold('Update sets')} on ${inst.label}  ·  state=${args.state}  ·  ${rows.length} result(s)\n\n${lines.join('\n')}\n`
        : c.yellow(`No update sets with state '${args.state}' on ${inst.label}`)
    log.done({ update_sets: rows }, text)
}

export async function exportCmd(log, args) {
    const { inst, http } = await open(log, args, { alias: args.auth })
    const rows = await sourceUpdateSets(inst, args)
    await mkdir(args.outDir, { recursive: true })
    const files = []
    for (const r of rows) {
        const xml = await http.exportUpdateSetXml(r.sys_id)
        const file = path.join(args.outDir, `${r.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_')}.xml`)
        await writeFile(file, xml)
        log.info(`  ${c.green('✓')} ${r.name} → ${c.cyan(file)} (${(xml.length / 1024).toFixed(1)} KB)`)
        files.push({ name: r.name, sys_id: r.sys_id, file })
    }
    log.done({ files })
}

export async function generateCmd(log, args) {
    const result = await generate(args.appDir, args.outDir, { replace: args.replace })
    log.done(result, `${c.green('✓')} ${result.name}: ${result.records} record(s) → ${c.cyan(result.file)}`)
}

function deliverOpts(args, commit) {
    return { onConflict: args.onConflict, commit, wait: args.wait }
}

function summarize(result, label) {
    const n = (s) => result.update_sets.filter((r) => r.status === s).length
    const parts = [
        n('committed') && `${n('committed')} committed`,
        n('commit_started') && `${n('commit_started')} commit started`,
        n('previewed') && `${n('previewed')} previewed (not committed)`,
        n('already_committed') && `${n('already_committed')} already committed`,
    ].filter(Boolean)
    return `\n${c.green('✓')} ${label}: ${parts.join(', ') || 'nothing to do'}`
}

export async function move(log, args) {
    const src = await open(log, args, instanceRef(args.from, args.fromEnv, '--from'))
    const tgt = await open(log, args, instanceRef(args.to, args.toEnv, '--to', true))
    const rows = await sourceUpdateSets(src.inst, args)
    log.info(`Found ${rows.length} update set(s) matching ${describeSelection(args)} (state ${args.state}) on ${src.inst.label}`)
    const items = rows.map((r) => ({
        name: r.name,
        sourceSysId: r.sys_id,
        sourceUpdatedOn: r.sys_updated_on,
        loadXml: () => src.http.exportUpdateSetXml(r.sys_id),
    }))
    const result = await deliver({ target: tgt.inst, http: tgt.http, cicd: tgt.cicd, log, opts: deliverOpts(args, !args.previewOnly) }, items)
    log.done(result, summarize(result, `${src.inst.label} → ${tgt.inst.label}`))
}

export async function importCmd(log, args) {
    if (args.auth && args.toEnv) throw new Error('Use either --auth or --to-env, not both')
    const tgt = await open(log, args, args.toEnv ? instanceRef(undefined, args.toEnv, '--to') : { alias: args.auth })
    const items = []
    for (const file of args.files) {
        const raw = await readFile(file, 'utf8')
        const xml = new UpdateSetXml(raw)
        items.push({ name: xml.name, sourceSysId: xml.sourceSysId, loadXml: async () => raw })
    }
    const result = await deliver({ target: tgt.inst, http: tgt.http, cicd: tgt.cicd, log, opts: deliverOpts(args, args.commit) }, items)
    log.done(result, summarize(result, `import → ${tgt.inst.label}`))
}

export async function commit(log, args) {
    const tgt = await open(log, args, { alias: args.auth })
    const rows = await tgt.inst.query('sys_remote_update_set', {
        query: `${selectionQuery(args)}^stateINloaded,previewed^ORDERBYsys_created_on`,
        fields: 'sys_id,name,state,remote_sys_id',
        limit: 500,
    })
    if (!rows.length) throw new Error(`No uncommitted retrieved update set matching ${describeSelection(args)} on ${tgt.inst.label}`)
    // Several retrieved copies of one source update set → keep the latest (rows are oldest first).
    const latest = new Map()
    for (const r of rows) {
        const key = r.remote_sys_id || r.sys_id
        latest.delete(key)
        latest.set(key, r)
    }
    // deliver() reuses retrieved copies, so it handles preview and problem checks.
    const items = [...latest.values()].map((r) => ({
        name: r.name,
        sourceSysId: r.remote_sys_id,
        loadXml: () => { throw new Error(`commit cannot re-upload ${r.name}; use move or import`) },
    }))
    const opts = { ...deliverOpts(args, true), onConflict: args.force ? 'force' : 'fail' }
    const result = await deliver({ target: tgt.inst, http: tgt.http, cicd: tgt.cicd, log, opts }, items)
    log.done(result, summarize(result, `commit on ${tgt.inst.label}`))
}

export async function rollback(log, args) {
    const tgt = await open(log, args, { alias: args.auth })
    const rows = await tgt.inst.query('sys_update_set', {
        query: `${selectionQuery(args)}^ORDERBYDESCsys_created_on`,
        fields: 'sys_id,name,state',
        limit: 10,
    })
    if (!rows.length) throw new Error(`No update set matching ${describeSelection(args)} on ${tgt.inst.label}`)
    if (rows.length > 1) {
        throw new Error(`${rows.length} update sets match ${describeSelection(args)}; rollback takes exactly one. Use --update-set-sys-id:\n` +
            rows.map((r) => `  ${r.sys_id}  ${r.name}`).join('\n'))
    }
    const [us] = rows
    log.info(`Backing out "${us.name}" (${us.sys_id}) on ${tgt.inst.label}`)
    const res = await tgt.cicd.backOut(us.sys_id, { rollbackInstalls: args.rollbackInstalls, wait: args.wait })
    log.done({ update_set: us, progress_id: res?.links?.progress?.id, status: args.wait ? 'rolled_back' : 'rollback_started' },
        `\n${c.green('✓')} Rolled back "${us.name}" on ${tgt.inst.label}`)
}
