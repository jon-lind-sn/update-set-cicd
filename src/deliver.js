// Shared target-side pipeline for `move` and `import`:
// existence check → upload → preview → conflict handling → commit.

import { UpdateSetXml, nextVersionName } from './xml.js'
import { ProblemError, c } from './output.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fileNameFor = (name) => `${name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'update_set'}.xml`

// Latest retrieved copy of a source update set on the target, matched by the
// source sys_id the XML carries in remote_sys_id (falls back to name).
async function findRetrieved(target, item) {
    const key = item.sourceSysId ? `remote_sys_id=${item.sourceSysId}` : `name=${item.name}`
    const [row] = await target.query('sys_remote_update_set', {
        query: `${key}^ORDERBYDESCsys_created_on`,
        fields: 'sys_id,name,state,sys_created_on',
        limit: 1,
    })
    // A copy retrieved before the source last changed is stale.
    if (row && item.sourceUpdatedOn && row.sys_created_on < item.sourceUpdatedOn) return undefined
    return row
}

// Unresolved preview problems (status empty) for a retrieved update set.
async function previewProblems(target, remoteId, name) {
    const rows = await target.query('sys_update_preview_problem', {
        query: `remote_update_set=${remoteId}^statusISEMPTY`,
        fields: 'type,description,missing_item_update',
        displayValue: 'all',
        limit: 100,
    })
    const problems = []
    for (const r of rows) {
        const p = { update_set: name, type: r.type?.display_value ?? r.type, description: r.description?.display_value ?? r.description }
        const localUpdate = r.missing_item_update?.value
        if (localUpdate) {
            const [u] = await target.query('sys_update_xml', { query: `sys_id=${localUpdate}`, fields: 'update_set', displayValue: 'true', limit: 1 })
            if (u?.update_set) p.local_update_set = u.update_set
        }
        problems.push(p)
    }
    return problems
}

// Problems after a preview. A failed preview with no recorded problems is a real error.
async function checkedProblems(ctx, remoteId, name, previewResult) {
    const problems = await previewProblems(ctx.target, remoteId, name)
    const status = String(previewResult?.status ?? '2')
    if (status !== '2' && !problems.length) throw new Error(`Preview of ${name} failed: ${previewResult.status_message || previewResult.error || `status ${status}`}`)
    return problems
}

async function upload(ctx, xml) {
    const { target, http, log } = ctx
    const name = xml.name
    let id = await http.uploadUpdateSetXml(xml.toString(), fileNameFor(name))
    for (let i = 0; !id && i < 30; i++) {
        await sleep(1000)
        const [row] = await target.query('sys_remote_update_set', { query: `name=${name}^ORDERBYDESCsys_created_on`, fields: 'sys_id', limit: 1 })
        id = row?.sys_id
    }
    if (!id) throw new Error(`Uploaded '${name}' but could not find the retrieved update set on ${target.label}`)
    log.debug(`uploaded ${name} → ${id}`)
    return id
}

async function prepareXml(ctx, item) {
    const xml = new UpdateSetXml(await item.loadXml())
    if (ctx.opts.asNewVersion) {
        const { base } = nextVersionName(xml.name, [])
        const rows = await ctx.target.query('sys_remote_update_set', { query: `nameSTARTSWITH${base}`, fields: 'name', limit: 500 })
        const { name } = nextVersionName(xml.name, rows.map((r) => r.name))
        xml.asNewVersion(name)
        ctx.log.info(c.dim(`  ${item.name}: importing as new version "${name}"`))
    }
    return xml
}

// Returns {name, source_sys_id, remote_update_set, status, problems?, force?}.
async function stage(ctx, item) {
    const { target, cicd, log, opts } = ctx
    const out = { name: item.name, source_sys_id: item.sourceSysId || undefined }
    let xml
    let remote = opts.asNewVersion ? undefined : await findRetrieved(target, item)

    if (remote?.state === 'committed') {
        log.info(`  ${item.name}: ${c.dim(`already committed on ${target.label}, skipped`)}`)
        return { ...out, remote_update_set: remote.sys_id, status: 'already_committed' }
    }
    if (!['loaded', 'previewed'].includes(remote?.state)) {
        xml = await prepareXml(ctx, item)
        remote = { sys_id: await upload(ctx, xml), state: 'loaded' }
        out.name = xml.name
        log.info(`  ${out.name}: uploaded (${remote.sys_id})`)
    } else {
        log.info(`  ${item.name}: already retrieved on ${target.label} (${remote.state}), reusing ${remote.sys_id}`)
    }

    // Re-previewing would discard problem resolutions made in the UI.
    const previewed = remote.state === 'loaded' ? await cicd.preview(remote.sys_id) : undefined
    let problems = await checkedProblems(ctx, remote.sys_id, out.name, previewed)

    if (problems.length && opts.onConflict === 'touch') {
        log.info(`  ${out.name}: ${problems.length} preview problem(s), touching timestamps and re-uploading`)
        xml ??= await prepareXml(ctx, item)
        xml.touchTimestamps()
        remote = { sys_id: await upload(ctx, xml), state: 'loaded' }
        problems = await checkedProblems(ctx, remote.sys_id, out.name, await cicd.preview(remote.sys_id))
    }

    out.remote_update_set = remote.sys_id
    out.url = `${target.url}/sys_remote_update_set.do?sys_id=${remote.sys_id}`
    if (!problems.length) {
        log.info(`  ${out.name}: ${c.green('preview clean')}`)
        return { ...out, status: 'previewed' }
    }
    if (opts.onConflict === 'force') {
        log.info(`  ${out.name}: ${c.yellow(`${problems.length} preview problem(s), will force commit`)}`)
        return { ...out, status: 'previewed', force: true, problems }
    }
    log.info(`  ${out.name}: ${c.red(`${problems.length} preview problem(s)`)} ${out.url}`)
    return { ...out, status: 'preview_problems', problems: problems.map((p) => ({ ...p, url: out.url })) }
}

// Commit retrieved update sets in order: one → commit, several → commitMultiple.
export async function commitAll(ctx, ids, force) {
    if (!ids.length) return undefined
    const wait = ctx.opts.wait ?? true
    return ids.length === 1
        ? ctx.cicd.commit(ids[0], { force, wait })
        : ctx.cicd.commitMultiple(ids, { force, wait })
}

// ctx: {target, http, cicd, log, opts:{onConflict, asNewVersion, commit, wait}}
// items: [{name, sourceSysId, sourceUpdatedOn?, loadXml()}] in commit order.
export async function deliver(ctx, items) {
    const results = []
    for (const item of items) results.push(await stage(ctx, item))

    const blocked = results.filter((r) => r.status === 'preview_problems')
    if (blocked.length) {
        const err = new ProblemError(
            `Preview found problems in ${blocked.length} of ${results.length} update set(s); nothing committed. ` +
                `Resolve them on ${ctx.target.label} and re-run, or use --on-conflict touch|force.`,
            blocked.flatMap((r) => r.problems),
        )
        err.result = { update_sets: results.map(({ problems, ...r }) => r) }
        throw err
    }

    const ready = results.filter((r) => r.status === 'previewed')
    if (!ctx.opts.commit || !ready.length) return { update_sets: results }

    const progress = await commitAll(ctx, ready.map((r) => r.remote_update_set), ready.some((r) => r.force))
    for (const r of ready) r.status = ctx.opts.wait === false ? 'commit_started' : 'committed'
    return { update_sets: results, progress_id: progress?.links?.progress?.id }
}
