// Pick the Update Source record on the target that points at the source
// instance (sys_update_set_source: sys_id, name, instance_id, url, active).
// The retrieve API takes a record sys_id, so move finds it the way a person
// would: the one whose URL host is the source's, or the one named with --update-source.

const host = (u) => {
    try {
        return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).host.toLowerCase()
    } catch {
        return ''
    }
}

export function pickUpdateSource(sources, { sourceUrl, named, targetLabel = 'the target' }) {
    const active = sources.filter((s) => String(s.active) === 'true')
    const list = () => active.map((s) => `${s.name} (${s.url})`).join(', ') || 'none active'
    const matches = named
        ? active.filter((s) => [s.sys_id, s.name, s.instance_id].includes(named))
        : active.filter((s) => host(s.url) === host(sourceUrl))
    const what = named ? `named '${named}'` : `for ${sourceUrl}`
    if (!matches.length) {
        throw new Error(
            `No active Update Source ${what} on ${targetLabel}. Create one under System Update Sets > Update Sources, ` +
                `or choose one with --update-source. Active sources: ${list()}`,
        )
    }
    if (matches.length > 1) throw new Error(`More than one Update Source ${what} on ${targetLabel}; choose one with --update-source (${list()})`)
    return matches[0]
}
