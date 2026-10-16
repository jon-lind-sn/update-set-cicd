// Update set XML (<unload>) parsing and rewriting.

import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

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

    toString() {
        const out = new XMLSerializer().serializeToString(this.doc)
        return out.startsWith('<?xml') ? out : `<?xml version="1.0" encoding="UTF-8"?>${out}`
    }
}
