// --update-set-name / --update-set-sys-id → encoded query.

const SYS_ID = /^[0-9a-f]{32}$/

// "My-Project-*" → nameSTARTSWITHMy-Project-; "*flows" → nameENDSWITHflows;
// "a*b" → nameLIKEa^nameLIKEb; no * → exact match.
export function nameQuery(pattern, field = 'name') {
    if (!pattern.includes('*')) return `${field}=${pattern}`
    const parts = pattern.split('*')
    const inner = parts.slice(1, -1).filter(Boolean)
    const [first, last] = [parts[0], parts[parts.length - 1]]
    const q = []
    if (first && !last && !inner.length) return `${field}STARTSWITH${first}`
    if (!first && last && !inner.length) return `${field}ENDSWITH${last}`
    for (const p of [first, ...inner, last].filter(Boolean)) q.push(`${field}LIKE${p}`)
    return q.join('^')
}

export function selectionQuery({ updateSetName, updateSetSysId }) {
    if (updateSetSysId) {
        if (!SYS_ID.test(updateSetSysId)) throw new Error(`--update-set-sys-id must be a 32-character sys_id, got '${updateSetSysId}'`)
        return `sys_id=${updateSetSysId}`
    }
    if (updateSetName) return nameQuery(updateSetName)
    throw new Error('Provide --update-set-name or --update-set-sys-id')
}

export function describeSelection({ updateSetName, updateSetSysId }) {
    return updateSetSysId ?? `"${updateSetName}"`
}
