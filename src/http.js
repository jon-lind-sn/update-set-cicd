// Direct HTTP for what now-sdk has no command for: sn_cicd update set calls,
// update set XML export (export_update_set2.do) and upload (sys_upload.do).
// Uses the session that now-sdk negotiated (see sdk.js).

export class HttpError extends Error {
    constructor(status, message) {
        super(`HTTP ${status}: ${message}`)
        this.status = status
    }
}

export class Http {
    constructor(instance) {
        this.instance = instance
        this.base = instance.url + '/'
        const s = instance.session
        this.headers = s.SN_SDK_SESSION_BEARER_TOKEN
            ? { Authorization: `Bearer ${s.SN_SDK_SESSION_BEARER_TOKEN}` }
            : { 'X-UserToken': s.SN_SDK_SESSION_TOKEN }
        this.cookies = new Map()
        for (const pair of (s.SN_SDK_SESSION_COOKIE ?? '').split(';')) {
            const i = pair.indexOf('=')
            if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
        }
        this.csrf = s.SN_SDK_SESSION_TOKEN || ''
    }

    _cookieHeader() {
        return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    }

    _storeCookies(res) {
        for (const c of res.headers.getSetCookie?.() ?? []) {
            const [pair] = c.split(';')
            const i = pair.indexOf('=')
            if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
        }
    }

    async fetch(path, { method = 'GET', query, json, body, headers = {} } = {}) {
        const url = new URL(path.replace(/^\/+/, ''), this.base)
        for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v))
        const h = { Accept: 'application/json', ...this.headers, ...headers }
        const cookie = this._cookieHeader()
        if (cookie) h.Cookie = cookie
        if (json !== undefined) {
            h['Content-Type'] = 'application/json'
            body = JSON.stringify(json)
        }
        const res = await fetch(url, { method, headers: h, body })
        this._storeCookies(res)
        return res
    }

    async json(path, opts) {
        const res = await this.fetch(path, opts)
        const text = await res.text()
        let data
        try {
            data = JSON.parse(text)
        } catch {
            throw new HttpError(res.status, text.slice(0, 300))
        }
        if (!res.ok && !data?.result) throw new HttpError(res.status, data?.error?.message ?? text.slice(0, 300))
        return data
    }

    // CSRF token for legacy .do endpoints. Basic auth sessions already carry it
    // (X-UserToken). OAuth does not, so open a UI session and read its
    // csrf_token from sys_user_session, the same way the Now SDK connector does.
    async csrfToken() {
        if (this.csrf) return this.csrf
        const res = await this.fetch('api/now/ui/user/current_user')
        if (!res.ok) throw new HttpError(res.status, 'current_user failed')
        await res.text()
        const sid = this.cookies.get('glide_session_store')
        if (!sid) throw new Error(`${this.instance.label}: no glide_session_store cookie; can't look up a CSRF token for .do endpoints`)
        const data = await this.json('api/now/table/sys_user_session', {
            query: { sysparm_fields: 'csrf_token', sysparm_query: `id=${sid}`, sysparm_limit: 1 },
        })
        this.csrf = data.result?.[0]?.csrf_token ?? ''
        if (!this.csrf) throw new Error(`${this.instance.label}: couldn't read csrf_token from sys_user_session (needs a user who can read it, normally admin)`)
        this.headers['X-UserToken'] = this.csrf
        return this.csrf
    }

    async exportUpdateSetXml(sysId) {
        const ck = await this.csrfToken()
        const res = await this.fetch('export_update_set2.do', {
            query: {
                sysparm_update_set_sys_id: sysId,
                sysparm_delete_when_done: 'false',
                sysparm_is_remote: 'false',
                sysparm_ck: ck,
            },
            headers: { Accept: 'text/xml,application/xml,*/*' },
        })
        const text = await res.text()
        if (!res.ok || !text.includes('<unload')) throw new HttpError(res.status, `XML export failed: ${text.slice(0, 300)}`)
        return text
    }

    // Upload XML as a retrieved update set. Returns the new sys_remote_update_set
    // sys_id when the redirect carries it, else ''.
    async uploadUpdateSetXml(xml, fileName) {
        const ck = await this.csrfToken()
        const form = new FormData()
        form.set('sysparm_ck', ck)
        form.set('sysparm_upload_prefix', '')
        form.set('sysparm_referring_url', '')
        form.set('sysparm_target', 'sys_remote_update_set')
        form.set('attachFile', new Blob([xml], { type: 'text/xml' }), fileName)
        const res = await this.fetch('sys_upload.do', { method: 'POST', body: form, headers: { Accept: 'text/html' } })
        const text = await res.text()
        if (/session_timeout|login\.do/.test(res.url)) throw new HttpError(401, 'session expired or login failed during upload')
        const m = res.url.match(/[?&]sys_id=([a-f0-9]{32})/)
        if (m) return m[1]
        if (!res.ok) throw new HttpError(res.status, `upload failed: ${text.slice(0, 300)}`)
        return ''
    }
}
