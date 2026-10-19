import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { DOMParser } from '@xmldom/xmldom'

import { buildUpdateSet, deriveTargetName, generate, hashId, parseRecordUpdate, typeLabelForTable } from '../src/generate.js'
import { UpdateSetXml } from '../src/xml.js'

const run = promisify(execFile)
const CLI = path.join(import.meta.dirname, '..', 'bin', 'update-set-cicd.js')

const APP_ID = '3ef0e0fc691f4f3aba06b6895905e1f3'
const FIX_ID = '68499c9802aa41989402e04a4e16622b'

const appXml = ({ scope = 'x_acme_app', version = '1.2.3', name = 'Acme App' } = {}) => `<?xml version="1.0"?>
<record_update table="sys_app">
  <sys_app action="INSERT_OR_UPDATE">
    <name>${name}</name>
    <scope>${scope}</scope>
    <short_description>An app &amp; its things</short_description>
    <sys_id>${APP_ID}</sys_id>
    <sys_updated_by>jon.lind</sys_updated_by>
    <sys_updated_on>2026-10-19 10:00:00</sys_updated_on>
    ${version ? `<version>${version}</version>` : ''}
  </sys_app>
</record_update>`

const fixXml = (script) => `<?xml version="1.0"?>
<record_update table="sys_script_fix">
  <sys_claim>claimed</sys_claim>
  <sys_script_fix action="INSERT_OR_UPDATE" apply_defaults="true">
    <sys_id>${FIX_ID}</sys_id>
    <name>Hello fix</name>
    <script><![CDATA[${script.replace(/]]>/g, ']]]]><![CDATA[>')}]]></script>
    <sys_updated_by>jon.lind</sys_updated_by>
    <sys_updated_on>2026-10-19 10:05:00</sys_updated_on>
  </sys_script_fix>
</record_update>`

const deleteXml = `<?xml version="1.0"?>
<record_update>
  <sys_ui_page action="DELETE">
    <sys_id>aaaabbbbccccddddeeeeffff00001111</sys_id>
  </sys_ui_page>
</record_update>`

// Writes a now-sdk style build folder (scope/ plus update/) and returns its path.
const bomXml = (serial, ts) => `<?xml version="1.0"?>
<record_update table="sys_module">
  <sys_module action="INSERT_OR_UPDATE">
    <sys_id>975093a022e641e88954f7548cf157d4</sys_id>
    <path>x_acme_app/acme/1.2.3/bom.json</path>
    <content>{ "serialNumber": "urn:uuid:${serial}", "metadata": { "timestamp": "${ts}" }, "components": [] }</content>
  </sys_module>
</record_update>`

async function makeApp({ app = appXml(), script = "gs.info('hi')", appInScope = true, bom } = {}) {
    const dir = await mkdtemp(path.join(tmpdir(), 'ust-gen-'))
    await mkdir(path.join(dir, 'update'), { recursive: true })
    const appDir = appInScope ? path.join(dir, 'scope') : dir
    await mkdir(appDir, { recursive: true })
    await writeFile(path.join(appDir, `sys_app_${APP_ID}.xml`), app)
    await writeFile(path.join(dir, 'update', `sys_script_fix_${FIX_ID}.xml`), fixXml(script))
    await writeFile(path.join(dir, 'update', 'sys_ui_page_aaaabbbbccccddddeeeeffff00001111.xml'), deleteXml)
    if (bom) await writeFile(path.join(dir, 'update', 'sys_module_975093a022e641e88954f7548cf157d4.xml'), bomXml(...bom))
    return dir
}

const parse = (xml) => new DOMParser().parseFromString(xml, 'text/xml').documentElement
const kids = (el, tag) => [...el.childNodes].filter((n) => n.nodeType === 1 && (!tag || n.tagName === tag))
const field = (el, tag) => kids(el, tag)[0]?.textContent

test('typeLabelForTable uppercases two-letter words', () => {
    assert.equal(typeLabelForTable('sys_ui_page'), 'Sys UI Page')
    assert.equal(typeLabelForTable('sys_script_fix'), 'Sys Script Fix')
})

test('deriveTargetName falls back through name, path, then table_sysid', () => {
    const rec = (xml) => parseRecordUpdate(`<record_update table="t"><t>${xml}</t></record_update>`).recordEl
    assert.equal(deriveTargetName(rec('<name>N</name><title>T</title>'), 't', '1'), 'N')
    assert.equal(deriveTargetName(rec('<path>a/b.json</path>'), 't', '1'), 'a/b.json')
    assert.equal(deriveTargetName(rec('<sys_id>1</sys_id>'), 't', '1'), 't_1')
})

test('parseRecordUpdate drops sys_claim and tolerates a missing table attribute', () => {
    const claimed = parseRecordUpdate(fixXml('x'))
    assert.equal(kids(claimed.root, 'sys_claim').length, 0)
    assert.equal(claimed.table, 'sys_script_fix')
    const bare = parseRecordUpdate(deleteXml)
    assert.equal(bare.table, 'sys_ui_page')
    assert.throws(() => parseRecordUpdate('<other/>'), /unexpected root/)
})

test('buildUpdateSet produces an importable update set for a scoped app', async () => {
    const built = await buildUpdateSet(await makeApp())
    assert.equal(built.fileName, 'Acme-App-1.2.3.xml')
    assert.equal(built.name, 'Acme App v1.2.3')
    assert.equal(built.records, 3)

    // The CLI's own reader accepts it.
    const set = new UpdateSetXml(built.xml)
    assert.equal(set.name, 'Acme App v1.2.3')
    assert.equal(set.updateCount, 3)
    assert.match(set.sourceSysId, /^[0-9a-f]{32}$/)

    const root = parse(built.xml)
    const rus = kids(root, 'sys_remote_update_set')[0]
    // Scope sys_id, not the scope name, so the platform's scope comparison passes.
    assert.equal(field(rus, 'application'), APP_ID)
    assert.equal(field(rus, 'application_scope'), 'x_acme_app')
    assert.equal(field(rus, 'description'), 'An app & its things')
    assert.equal(field(rus, 'state'), 'loaded')

    const entries = kids(root, 'sys_update_xml')
    assert.deepEqual(entries.map((e) => field(e, 'name')), [
        `sys_script_fix_${FIX_ID}`,
        'sys_ui_page_aaaabbbbccccddddeeeeffff00001111',
        `sys_app_${APP_ID}`,
    ])
    assert.deepEqual(entries.map((e) => field(e, 'action')), ['INSERT_OR_UPDATE', 'DELETE', 'INSERT_OR_UPDATE'])
    assert.deepEqual(entries.map((e) => field(e, 'type')), ['Sys Script Fix', 'Sys UI Page', 'Sys App'])
    assert.equal(field(entries[0], 'target_name'), 'Hello fix')
    assert.equal(field(entries[1], 'target_name'), `sys_ui_page_aaaabbbbccccddddeeeeffff00001111`)
    assert.equal(field(entries[0], 'remote_update_set'), field(rus, 'sys_id'))
    assert.ok(entries.every((e) => field(e, 'application') === APP_ID))
    const recorded = entries.map((e) => field(e, 'sys_recorded_at'))
    assert.deepEqual(recorded, [...recorded].sort())
})

test('payload round-trips script text, including CDATA terminators, and drops sys_claim', async () => {
    const script = 'var s = "a < b && c > d"; var x = "]]>";'
    const built = await buildUpdateSet(await makeApp({ script }))
    const entry = kids(parse(built.xml), 'sys_update_xml')[0]
    const payload = parse(field(entry, 'payload'))
    assert.equal(payload.tagName, 'record_update')
    assert.equal(kids(payload, 'sys_claim').length, 0)
    assert.equal(field(kids(payload, 'sys_script_fix')[0], 'script'), script)
})

test('output is deterministic and any content change gives new ids', async () => {
    const a = await buildUpdateSet(await makeApp())
    const b = await buildUpdateSet(await makeApp())
    assert.equal(a.xml, b.xml)

    const changed = await buildUpdateSet(await makeApp({ script: "gs.info('different')" }))
    assert.notEqual(new UpdateSetXml(changed.xml).sourceSysId, new UpdateSetXml(a.xml).sourceSysId)

    const bumped = await buildUpdateSet(await makeApp({ app: appXml({ version: '1.2.4' }) }))
    assert.notEqual(new UpdateSetXml(bumped.xml).sourceSysId, new UpdateSetXml(a.xml).sourceSysId)
    assert.equal(bumped.fileName, 'Acme-App-1.2.4.xml')
})

test('a rebuild with only new SBOM build values keeps its ids unless --replace is set', async () => {
    const first = await makeApp({ bom: ['1111', '2026-10-19T10:00:00Z'] })
    const rebuilt = await makeApp({ bom: ['2222', '2026-10-19T11:00:00Z'] })
    const idOf = async (dir, options) => new UpdateSetXml((await buildUpdateSet(dir, options)).xml).sourceSysId

    assert.equal(await idOf(first), await idOf(rebuilt))
    assert.notEqual(await idOf(first, { replace: true }), await idOf(rebuilt, { replace: true }))
    // The values are still written to the file; they only stay out of the hash.
    assert.match((await buildUpdateSet(rebuilt)).xml, /urn:uuid:2222/)

    // A real content change is still a new update set.
    const edited = await makeApp({ bom: ['1111', '2026-10-19T10:00:00Z'], script: "gs.info('edited')" })
    assert.notEqual(await idOf(first), await idOf(edited))
})

test('app file at the folder root is found, and a global app keeps "global"', async () => {
    const built = await buildUpdateSet(await makeApp({ app: appXml({ scope: 'global' }), appInScope: false }))
    const rus = kids(parse(built.xml), 'sys_remote_update_set')[0]
    assert.equal(field(rus, 'application'), 'global')
    assert.equal(field(rus, 'application_name'), 'Global')
})

test('clear errors for a missing app file, missing version, and duplicate app files', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'ust-gen-'))
    await assert.rejects(buildUpdateSet(empty), /No sys_app_<sys_id>.xml found/)

    await assert.rejects(buildUpdateSet(await makeApp({ app: appXml({ version: '' }) })), /no <version>/)

    const dup = await makeApp()
    await writeFile(path.join(dup, 'scope', 'sys_app_other.xml'), appXml())
    await assert.rejects(buildUpdateSet(dup), /Multiple sys_app_\*\.xml/)
})

test('hashId is stable, 32 hex characters, and sensitive to every part', () => {
    assert.match(hashId('a', 'b'), /^[0-9a-f]{32}$/)
    assert.equal(hashId('a', 'b'), hashId('a', 'b'))
    assert.notEqual(hashId('a', 'b'), hashId('ab'))
    assert.notEqual(hashId('a', 'b'), hashId('b', 'a'))
})

test('generate writes the file and the CLI prints a json envelope', async () => {
    const dir = await makeApp()
    const out = await mkdtemp(path.join(tmpdir(), 'ust-out-'))
    const viaApi = await generate(dir, out)
    assert.equal(path.basename(viaApi.file), 'Acme-App-1.2.3.xml')
    assert.equal(await readFile(viaApi.file, 'utf8'), (await buildUpdateSet(dir)).xml)

    const { stdout } = await run(process.execPath, [CLI, 'generate', dir, '--out-dir', out, '-o', 'json'])
    const env = JSON.parse(stdout)
    assert.equal(env.ok, true)
    assert.equal(env.result.records, 3)
    assert.equal(env.result.name, 'Acme App v1.2.3')
})
