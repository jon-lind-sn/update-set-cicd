// sn_cicd Update Set API (Yokohama and later) plus progress polling.
// Status codes and progress messages follow now-sdk cicd.

export const STATUS = { 0: 'Pending', 1: 'Running', 2: 'Successful', 3: 'Failed', 4: 'Canceled' }
const TERMINAL = new Set(['2', '3', '4'])

export class CicdError extends Error {
    constructor(message, result) {
        super(message)
        this.result = result
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class Cicd {
    constructor(http, log, { pollTimeout = 120000 } = {}) {
        this.http = http
        this.log = log
        this.pollTimeout = pollTimeout
    }

    async _start(path, { query, json = {} } = {}) {
        const data = await this.http.json(`api/sn_cicd/${path}`, { method: 'POST', query, json })
        const result = data.result ?? {}
        const id = result.links?.progress?.id
        if (!id) throw new CicdError(`${path}: ${result.error || result.status_message || 'no progress link in response'}`, result)
        return result
    }

    // allowFailure: return a Failed/Canceled result instead of throwing (preview
    // reports problems as status 3, and the caller reads them from the table).
    async poll(progressId, { allowFailure = false } = {}) {
        this.log.info(`Waiting for operation to complete (progress id: ${progressId})...`)
        const deadline = Date.now() + this.pollTimeout
        let last = {}
        for (let i = 1; Date.now() < deadline; i++) {
            await sleep(1000)
            const { result = {} } = await this.http.json(`api/sn_cicd/progress/${progressId}`)
            const status = String(result.status ?? '')
            if (TERMINAL.has(status)) {
                if (status !== '2' && !allowFailure) {
                    throw new CicdError(`Operation ${STATUS[status].toLowerCase()}: ${result.status_message || result.error || ''}`.trim(), result)
                }
                if (status === '2') this.log.info(`Operation completed: ${result.status_message || STATUS[status]}`)
                return result
            }
            if (i % 10 === 0) {
                const msg = result.status_message ? `: ${result.status_message}` : ''
                this.log.info(`  ${i}s, ${STATUS[status] ?? 'status ' + status}, ${result.percent_complete ?? 0}%${msg}`)
            }
            last = result
        }
        const hint = String(last.status ?? '0') === '0' ? ' The job never started; check that the instance is running scheduled jobs.' : ''
        throw new CicdError(`Timed out after ${Math.round(this.pollTimeout / 1000)}s waiting for progress ${progressId}.${hint}`, last)
    }

    async _run(path, opts, wait) {
        const started = await this._start(path, opts)
        const id = started.links.progress.id
        return wait ? this.poll(id) : started
    }

    async preview(remoteId) {
        const started = await this._start(`update_set/preview/${remoteId}`)
        return this.poll(started.links.progress.id, { allowFailure: true })
    }

    // The platform rejects a commit while a preview is still settling; retry briefly.
    async commit(remoteId, { force = false, wait = true } = {}) {
        let started
        for (let attempt = 1; !started; attempt++) {
            try {
                started = await this._start(`update_set/commit/${remoteId}`, { json: { force_commit: String(force) } })
            } catch (e) {
                if (attempt >= 3 || !/previewing/i.test(e.message)) throw e
                await sleep(5000)
            }
        }
        return wait ? this.poll(started.links.progress.id) : started
    }

    commitMultiple(remoteIds, { force = false, wait = true } = {}) {
        return this._run('update_set/commitMultiple', {
            query: { remote_update_set_ids: remoteIds.join(',') },
            json: { force_commit: String(force) },
        }, wait)
    }

    backOut(updateSetId, { rollbackInstalls = true, wait = true } = {}) {
        return this._run('update_set/back_out', {
            query: { update_set_id: updateSetId, rollback_installs: String(rollbackInstalls) },
        }, wait)
    }
}
