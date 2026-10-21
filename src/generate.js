// Build a "Retrieved Update Set" XML from a now-sdk build output folder
// (the dist/app layout: sys_app_<sys_id>.xml at the root or in scope/, plus
// update/ and author_elective_update/ record files).
//
// Node port of update-set-gen/gen_update_set.py. Difference from the Python:
// every generated id is a hash of the content. The same app gives the same ids
// (the upload step reuses a retrieved copy by remote_sys_id, so an update set
// already on the target is skipped) and a changed app gives new ids, so a stale
// copy is never reused.

import { createHash } from 'node:crypto'
import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

const ELEMENT = 1
const CDATA = 4

const elements = (el) => [...el.childNodes].filter((n) => n.nodeType === ELEMENT)
const childEl = (el, tag) => elements(el).find((n) => n.tagName === tag)

// Text of a direct child element, or null when it is missing or empty.
function fieldText(recordEl, field) {
    const el = recordEl && childEl(recordEl, field)
    return el?.textContent || null
}

// sys_update_xml.type: Title Case of the table name; two-letter words are
// fully uppercased (sys_ui_page -> "Sys UI Page").
export function typeLabelForTable(table) {
    return table
        .split('_')
        .map((w) => (w.length === 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join(' ')
}

// Best available human-readable label for a record: an ordered list of generic
// field names, then a synthesized <table>_<sys_id>.
export function deriveTargetName(recordEl, table, sysId) {
    return (
        ['name', 'display_name', 'path', 'title', 'sys_update_name'].map((f) => fieldText(recordEl, f)).find(Boolean) ||
        `${table}_${sysId}`
    )
}

// Parse one record file. Removes sys_claim (source-control bookkeeping that is
// never part of a record update payload).
export function parseRecordUpdate(xml, label = 'record') {
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    const root = doc.documentElement
    if (!root || root.tagName !== 'record_update') throw new Error(`${label}: unexpected root ${root?.tagName}`)
    for (const el of elements(root)) if (el.tagName === 'sys_claim') root.removeChild(el)
    const tableAttr = root.getAttribute('table') || null
    // The table attribute can be missing (an SBOM sys_module record) or point at
    // a delete_multiple entry; the record_update's first child element is then
    // the record and its tag is the real table.
    const recordEl = (tableAttr && childEl(root, tableAttr)) || elements(root)[0] || null
    const table = tableAttr || recordEl?.tagName || null
    return { doc, root, table, recordEl }
}

// Re-serialize the record with CDATA turned into escaped text, so the payload
// can sit inside one CDATA section without nesting.
function payloadXml(root) {
    const flatten = (node) => {
        for (const n of [...node.childNodes]) {
            if (n.nodeType === CDATA) node.replaceChild(node.ownerDocument.createTextNode(n.data), n)
            else if (n.nodeType === ELEMENT) flatten(n)
        }
    }
    flatten(root)
    return `<?xml version="1.0" encoding="UTF-8"?>${new XMLSerializer().serializeToString(root)}`
}

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s) => escText(s).replace(/"/g, '&quot;')

// <tag attr="...">text</tag>, or <tag /> when there is nothing inside.
function el(tag, text, attrs = {}) {
    const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')
    return text ? `<${tag}${a}>${escText(text)}</${tag}>` : `<${tag}${a} />`
}

const cdata = (s) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`

// 32 hex characters derived from the parts, in the style of a sys_id.
export function hashId(...parts) {
    const h = createHash('sha256')
    for (const p of parts) h.update(`${p}\0`)
    return h.digest('hex').slice(0, 32)
}

async function listXml(dir) {
    try {
        return (await readdir(dir)).filter((f) => f.endsWith('.xml')).sort().map((f) => path.join(dir, f))
    } catch (e) {
        if (e.code === 'ENOENT') return []
        throw e
    }
}

// sys_app_<sys_id>.xml sits at the folder root for a scoped app and under
// scope/ for the now-sdk build output or a globally scoped app.
async function findAppXml(appDir) {
    for (const dir of [appDir, path.join(appDir, 'scope')]) {
        let names
        try {
            names = await readdir(dir)
        } catch (e) {
            if (e.code === 'ENOENT') continue
            throw e
        }
        const found = []
        for (const f of names) {
            if (f.startsWith('sys_app_') && f.endsWith('.xml') && (await stat(path.join(dir, f))).isFile()) found.push(f)
        }
        if (found.length > 1) throw new Error(`Multiple sys_app_*.xml found in ${dir}: ${found.join(', ')}`)
        if (found.length) return path.join(dir, found[0])
    }
    throw new Error(`No sys_app_<sys_id>.xml found at the root of ${appDir} or in its scope/ folder`)
}

// now-sdk writes an SBOM record (.../bom.json) with a random serialNumber and a
// build timestamp, so two builds of the same source differ only there.
const isSbom = (r) => r.targetName.endsWith('/bom.json')
const BUILD_VALUES = /"(serialNumber|timestamp)"\s*:\s*"[^"]*"/g

// Platform timestamps are UTC as "YYYY-MM-DD HH:MM:SS". Accepts that form (read as
// UTC) or any ISO 8601 instant.
export function toPlatformTime(value) {
    const s = String(value).trim()
    const d = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? new Date(`${s.replace(' ', 'T')}Z`) : new Date(s)
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid time '${value}'; use YYYY-MM-DD HH:MM:SS (UTC) or an ISO 8601 time`)
    return d.toISOString().slice(0, 19).replace('T', ' ')
}

// The now-sdk build records its own time in the SBOM. Returns undefined when the
// folder has no SBOM or no usable time.
function sbomTime(records) {
    const sbom = records.find(isSbom)
    const m = sbom?.unstamped.match(/"timestamp"\s*:\s*"([^"]*)"/)
    try {
        return m && toPlatformTime(m[1])
    } catch {
        return undefined
    }
}

// Returns { fileName, xml, name, version, records }.
// Generated ids are a hash of the content, so unchanged content keeps its ids
// and the upload step finds the copy already on the target. The SBOM's build
// values are left out of the hash unless `replace` is set, which makes every
// new build a new update set.
export async function buildUpdateSet(appDir, { replace = false, updatedOn } = {}) {
    const appPath = await findAppXml(appDir)
    const app = parseRecordUpdate(await readFile(appPath, 'utf8'), appPath)
    if (app.table !== 'sys_app') throw new Error(`${appPath}: expected a sys_app record, found ${app.table}`)
    const appSysId = fieldText(app.recordEl, 'sys_id')
    const appName = fieldText(app.recordEl, 'name')
    const version = fieldText(app.recordEl, 'version')
    const description = fieldText(app.recordEl, 'short_description') || ''
    const scope = fieldText(app.recordEl, 'scope')
    if (!version) throw new Error(`${path.basename(appPath)} has no <version> field`)

    const files = [...(await listXml(path.join(appDir, 'update'))), ...(await listXml(path.join(appDir, 'author_elective_update'))), appPath]
    const records = []
    for (const file of files) {
        const r = file === appPath ? app : parseRecordUpdate(await readFile(file, 'utf8'), file)
        const name = path.basename(file, '.xml')
        const sysId = fieldText(r.recordEl, 'sys_id') || name.split('_').pop()
        records.push({
            name,
            table: r.table,
            action: elements(r.root)[0]?.getAttribute('action') || 'INSERT_OR_UPDATE',
            createdBy: fieldText(r.recordEl, 'sys_updated_by') || 'admin',
            createdOn: fieldText(r.recordEl, 'sys_updated_on') || '',
            targetName: deriveTargetName(r.recordEl, r.table, sysId),
            // Hashed and stamped later; the stamp stays out of the content hash.
            unstamped: payloadXml(r.root),
            parsed: r,
        })
    }

    // The now-sdk build leaves sys_updated_on out of every record, so the target
    // would have no edit time to compare with a local change. Records that carry
    // their own time (a source-controlled app folder) keep it.
    let stamp
    let stampSource
    if (updatedOn) [stamp, stampSource] = [toPlatformTime(updatedOn), 'option']
    else if ((stamp = sbomTime(records))) stampSource = 'build'
    else [stamp, stampSource] = [toPlatformTime(new Date()), 'generation time']
    for (const r of records) {
        r.payload = r.unstamped
        if (r.createdOn) continue
        r.createdOn = stamp
        if (r.action !== 'INSERT_OR_UPDATE' || !r.parsed.recordEl) continue
        const t = r.parsed.doc.createElement('sys_updated_on')
        t.appendChild(r.parsed.doc.createTextNode(stamp))
        r.parsed.recordEl.appendChild(t)
        r.payload = payloadXml(r.parsed.root)
    }

    const hashed = (r) => (replace || !isSbom(r) ? r.unstamped : r.unstamped.replace(BUILD_VALUES, '"$1":""'))
    const contentKey = hashId(appSysId, version, ...records.flatMap((r) => [r.name, hashed(r)]))
    const setId = hashId('update-set', contentKey)
    const remoteSysId = hashId('remote', contentKey)

    // A scoped app needs the scope sys_id in the root <application> (the platform
    // compares it with each record's <application>); a global app keeps "global".
    const isGlobal = scope === 'global'
    const root = [
        el('application', isGlobal ? 'global' : appSysId, { display_value: isGlobal ? 'Global' : appName }),
        el('application_name', isGlobal ? 'Global' : appName),
        el('application_scope', scope),
        el('collisions'), el('commit_date'), el('deleted'),
        el('description', description),
        el('inserted'),
        el('name', `${appName} v${version}`),
        el('origin_sys_id'),
        el('parent', '', { display_value: '' }),
        el('release_date'),
        el('remote_base_update_set', '', { display_value: '' }),
        el('remote_parent_id'),
        el('remote_sys_id', remoteSysId),
        el('state', 'loaded'),
        el('summary'),
        el('sys_class_name', 'sys_remote_update_set'),
        el('sys_created_by', 'admin'),
        el('sys_created_on'),
        el('sys_id', setId),
        el('sys_mod_count', '0'),
        el('sys_updated_by', 'admin'),
        el('sys_updated_on'),
        el('update_set', '', { display_value: '' }),
        el('update_source', '', { display_value: '' }),
        el('updated'),
    ].join('')

    const entries = records.map((r, i) =>
        [
            el('action', r.action),
            el('application', appSysId, { display_value: appName }),
            el('category', 'customer'),
            el('comments'),
            el('name', r.name),
            `<payload>${cdata(r.payload)}</payload>`,
            el('payload_hash'),
            el('remote_update_set', setId, { display_value: appName }),
            el('replace_on_upgrade', 'false'),
            el('sys_created_by', r.createdBy),
            el('sys_created_on', r.createdOn),
            el('sys_id', hashId('entry', setId, r.name)),
            el('sys_mod_count', '0'),
            // The true capture order is unknown; this only needs to increase.
            el('sys_recorded_at', `19fdd2b${i.toString(16).padStart(3, '0')}0000001`),
            el('sys_updated_by', r.createdBy),
            el('sys_updated_on', r.createdOn),
            el('table'),
            el('target_name', r.targetName),
            el('type', typeLabelForTable(r.table)),
            el('update_domain', 'global'),
            el('update_guid'),
            el('update_guid_history'),
            el('update_set', '', { display_value: '' }),
            el('view'),
        ].join('')
    )

    const xml =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        `<unload unload_date="${escAttr(records[0].createdOn)}">` +
        `<sys_remote_update_set action="INSERT_OR_UPDATE">${root}</sys_remote_update_set>` +
        entries.map((e) => `<sys_update_xml action="INSERT_OR_UPDATE">${e}</sys_update_xml>`).join('') +
        '</unload>'

    return { fileName: `${appName.replaceAll(' ', '-')}-${version}.xml`, xml, name: `${appName} v${version}`, version, records: records.length, updatedOn: stamp, updatedOnSource: stampSource }
}

// Build and write the update set; returns the summary the command prints.
export async function generate(appDir, outDir = '.', options = {}) {
    const built = await buildUpdateSet(appDir, options)
    await mkdir(outDir, { recursive: true })
    const file = path.join(outDir, built.fileName)
    await writeFile(file, built.xml)
    return { file, name: built.name, version: built.version, records: built.records, updated_on: built.updatedOn, updated_on_source: built.updatedOnSource }
}
