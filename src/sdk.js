// Thin wrappers around the now-sdk CLI that ships as a dependency.
//
// Auth is delegated entirely to now-sdk: `auth --print [alias] --format env`
// resolves a stored alias, CI credentials (SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL),
// or a pre-authenticated session, and prints SN_SDK_SESSION_* exports. Those
// session variables are then reused for every later now-sdk call and HTTP
// request against the same instance, so each instance logs in once per run.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

// @servicenow/sdk's "exports" hides package.json and its bin, so search the
// node_modules lookup paths directly.
function sdkPackage() {
    for (const nm of createRequire(import.meta.url).resolve.paths('@servicenow/sdk') ?? []) {
        const dir = path.join(nm, '@servicenow', 'sdk')
        const file = path.join(dir, 'package.json')
        if (existsSync(file)) return { dir, pkg: JSON.parse(readFileSync(file, 'utf8')) }
    }
    throw new Error('Cannot locate @servicenow/sdk; run npm install')
}
const { dir: SDK_DIR, pkg: SDK_PKG } = sdkPackage()
const SDK_BIN = path.join(SDK_DIR, SDK_PKG.bin['now-sdk'])
export const SDK_VERSION = SDK_PKG.version

// Every SN_SDK_* variable now-sdk reads to pick credentials.
const AUTH_VARS = [
    'NODE_ENV', 'AUTH_TYPE', 'INSTANCE_URL', 'USER', 'USER_PWD',
    'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET',
    'SESSION_TOKEN', 'SESSION_COOKIE', 'SESSION_BEARER_TOKEN',
]

export class SdkError extends Error {}

function runSdk(args, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SDK_BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (d) => (stdout += d))
        child.stderr.on('data', (d) => (stderr += d))
        child.on('error', reject)
        child.on('close', (code) => resolve({ code, stdout, stderr }))
    })
}

function withoutAuthVars(env) {
    const out = { ...env }
    for (const v of AUTH_VARS) delete out[`SN_SDK_${v}`]
    return out
}

// Environment for the `auth --print` child.
//   alias:  ignore any SN_SDK_* in the environment so the stored alias wins.
//   prefix: map <prefix>X onto SN_SDK_X (e.g. SN_SDK_SOURCE_INSTANCE_URL).
//   neither: pass the environment through (CI variables or the default alias).
function authEnv({ alias, prefix }) {
    if (alias) return withoutAuthVars(process.env)
    if (!prefix) return process.env
    const env = withoutAuthVars(process.env)
    for (const v of AUTH_VARS) {
        const val = process.env[`${prefix}${v}`]
        if (val !== undefined) env[`SN_SDK_${v}`] = val
    }
    // CI mode is usually set once for the whole job.
    if (!env.SN_SDK_NODE_ENV && process.env.SN_SDK_NODE_ENV) env.SN_SDK_NODE_ENV = process.env.SN_SDK_NODE_ENV
    return env
}

// Parse `export K='v'` lines written with POSIX single-quote escaping ('\'').
export function parseEnvExports(text) {
    const out = {}
    for (const line of text.split('\n')) {
        const m = line.match(/^export ([A-Z_][A-Z0-9_]*)=(.*)$/)
        if (!m) continue
        let raw = m[2].trim()
        let val = ''
        while (raw.length) {
            if (raw[0] === "'") {
                const end = raw.indexOf("'", 1)
                val += raw.slice(1, end)
                raw = raw.slice(end + 1)
            } else if (raw.startsWith("\\'")) {
                val += "'"
                raw = raw.slice(2)
            } else {
                const m2 = raw.match(/^[^'\\]+/)
                val += m2[0]
                raw = raw.slice(m2[0].length)
            }
        }
        out[m[1]] = val
    }
    return out
}

// One authenticated instance. `label` is what the user sees (alias or env prefix).
export class Instance {
    constructor(label, session) {
        this.label = label
        this.url = session.SN_SDK_INSTANCE_URL.replace(/\/+$/, '')
        this.session = session
    }

    // Child environment that makes now-sdk reuse this session.
    sdkEnv() {
        return { ...withoutAuthVars(process.env), ...this.session }
    }

    // now-sdk query <table> → records (all pages up to `limit`).
    async query(table, { query, fields, limit = 100, displayValue } = {}) {
        const args = ['query', table, '-q', query, '--limit', String(limit), '-o', 'json']
        if (fields) args.push('-f', Array.isArray(fields) ? fields.join(',') : fields)
        if (displayValue) args.push('--display-value', displayValue)
        const { stdout, stderr } = await runSdk(args, this.sdkEnv())
        let env
        try {
            env = JSON.parse(stdout)
        } catch {
            throw new SdkError(`now-sdk query ${table} returned no JSON: ${(stderr || stdout).trim().slice(0, 300)}`)
        }
        if (!env.ok) throw new SdkError(`now-sdk query ${table} failed: ${env.error?.message ?? stdout.slice(0, 300)}`)
        return env.records
    }
}

// Authenticate through now-sdk and return an Instance.
// Exactly one of alias/prefix may be given; with neither, now-sdk decides
// (CI environment variables, else the default alias).
export async function connect({ alias, prefix } = {}) {
    const args = ['auth', '--print']
    if (alias) args.push(alias)
    args.push('--format', 'env')
    const { code, stdout, stderr } = await runSdk(args, authEnv({ alias, prefix }))
    const session = parseEnvExports(stdout)
    const label = alias ?? (prefix ? `${prefix}*` : process.env.SN_SDK_INSTANCE_URL ? 'SN_SDK_*' : 'default alias')
    if (code !== 0 || !session.SN_SDK_INSTANCE_URL) {
        const msg = stderr.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').pop()
        throw new SdkError(`now-sdk auth (${label}) failed: ${msg || `exit ${code}`}`)
    }
    return new Instance(label, session)
}
