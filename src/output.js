// Human output vs the now-sdk style machine envelope ({ok, result} / {ok:false, error}).
// -o json or -s <path> silences progress logs and prints only the envelope.

const tty = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s))
export const c = { dim: paint(2), bold: paint(1), red: paint(31), green: paint(32), yellow: paint(33), cyan: paint(36) }

// "records[0].sys_id" style path lookup.
function select(obj, path) {
    const keys = path.match(/[^.[\]]+/g) ?? []
    return keys.reduce((o, k) => (o == null ? undefined : o[/^\d+$/.test(k) ? Number(k) : k]), obj)
}

export class Output {
    constructor({ output, select: sel, debug } = {}) {
        this.format = output
        this.select = sel
        this.machine = Boolean(output || sel)
        this.debugOn = Boolean(debug)
    }

    info(msg) {
        if (!this.machine) console.log(msg)
    }

    debug(msg) {
        if (this.debugOn) console.error(c.dim(`[debug] ${msg}`))
    }

    _emit(envelope) {
        if (this.select) {
            const v = select(envelope, this.select)
            console.log(this.format === 'raw' && typeof v === 'string' ? v : JSON.stringify(v))
        } else {
            console.log(JSON.stringify(envelope))
        }
    }

    // `text` is the human summary; `result` is the machine payload.
    done(result, text) {
        if (this.machine) this._emit({ ok: true, result })
        else if (text) console.log(text)
    }

    fail(err) {
        process.exitCode = 1
        const error = { message: err.message }
        if (err.problems?.length) error.problems = err.problems
        if (err.result) error.result = err.result
        if (this.machine) return this._emit({ ok: false, error })
        console.error(c.red(`ERROR: ${err.message}`))
        let lastUrl
        for (const p of err.problems ?? []) {
            if (p.url && p.url !== lastUrl) console.error(`\n  ${c.bold(p.update_set)}  ${c.cyan(p.url)}`)
            lastUrl = p.url
            console.error(`  ${c.yellow('•')} [${p.type}] ${p.description}${p.record ? ` (${p.record})` : ''}`)
            if (p.local_update_set) console.error(c.dim(`    local update set: ${p.local_update_set}`))
        }
        if (this.debugOn && err.stack) console.error(c.dim(err.stack))
    }
}

export class ProblemError extends Error {
    constructor(message, problems) {
        super(message)
        this.problems = problems
    }
}
