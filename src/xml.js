// Update set XML (<unload>) parsing and rewriting.

import { randomUUID } from 'node:crypto'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

const nowUtc = () => new Date().toISOString().slice(0, 19).replace('T', ' ')
const newSysId = () => randomUUID().replace(/-/g, '')

const children = (el, tag) => [...el.childNodes].filter((n) => n.nodeType === 1 && (!tag || n.tagName === tag))
const child = (el, tag) => children(el, tag)[0]
const text = (el, tag) => child(el, tag)?.textContent ?? ''
function setText(el, value) {
    while (el.firstChild) el.removeChild(el.firstChild)
    el.appendChild(el.ownerDocument.createTextNode(value))
}

export class UpdateSetXml {
    constructor(xml) {
        this.doc = new DOMParser().parseFromString(xml, 'text/xml')
        this.root = this.doc.documentElement
        this.rus = this.root && child(this.root, 'sys_remote_update_set')
        if (!this.rus) throw new Error('No <sys_remote_update_set> in XML')
    }

    get name() {
        return text(this.rus, 'name')
    }

    // sys_id of the update set on the instance it was exported from.
    get sourceSysId() {
        return text(this.rus, 'remote_sys_id')
    }

    get updateCount() {
        return children(this.root, 'sys_update_xml').length
    }

    // Regenerate root sys_ids, rename, reset timestamps, so the file imports as
    // a new retrieved update set (formerly --tweak).
    asNewVersion(newName) {
        const now = nowUtc()
        this.root.setAttribute('unload_date', now)
        const idMap = new Map()
        for (const el of children(this.root)) {
            const idEl = child(el, 'sys_id')
            if (idEl?.textContent) {
                const id = newSysId()
                idMap.set(idEl.textContent, id)
                setText(idEl, id)
            }
        }
        setText(child(this.rus, 'name'), newName)
        for (const el of [this.rus, ...children(this.root, 'sys_update_xml')]) {
            for (const tag of ['sys_updated_on', 'sys_created_on']) {
                const t = child(el, tag)
                if (t) setText(t, now)
            }
            const ref = el !== this.rus && child(el, 'remote_update_set')
            if (ref && idMap.has(ref.textContent)) {
                setText(ref, idMap.get(ref.textContent))
                if (ref.getAttribute('display_value')) ref.setAttribute('display_value', newName)
            }
        }
        return idMap.size
    }

    // Set sys_updated_on to now on every record so incoming updates are newer
    // than local ones on the target (--on-conflict touch).
    // Preview compares sys_recorded_at: 11 hex digits of epoch ms + a 7-digit counter.
    touchTimestamps() {
        const now = nowUtc()
        const recordedAt = Date.now().toString(16).padStart(11, '0')
        this.root.setAttribute('unload_date', now)
        for (const el of children(this.root)) {
            const t = child(el, 'sys_updated_on')
            if (t) setText(t, now)
            const r = child(el, 'sys_recorded_at')
            if (r?.textContent) setText(r, recordedAt + r.textContent.slice(11))
        }
    }

    toString() {
        const out = new XMLSerializer().serializeToString(this.doc)
        return out.startsWith('<?xml') ? out : `<?xml version="1.0" encoding="UTF-8"?>${out}`
    }
}

// "Name v 3" → "Name v 4" (or "Name" → "Name v 2"), skipping versions already on the target.
export function nextVersionName(name, existingNames) {
    const m = name.match(/^(.*)\s+v\s*(\d+)$/)
    const base = m ? m[1] : name
    const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+v\\s*(\\d+)$`)
    let max = 1
    for (const n of existingNames) {
        const vm = n.match(re)
        if (vm) max = Math.max(max, Number(vm[1]))
    }
    return { base, name: `${base} v ${max + 1}` }
}
