import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pickUpdateSource } from '../src/source.js'

const sources = [
    { sys_id: 'a1', name: 'Dev', instance_id: 'i1', url: 'https://xare.service-now.com/', active: 'true' },
    { sys_id: 'b2', name: 'Test', instance_id: 'i2', url: 'https://yoyo.service-now.com', active: 'true' },
    { sys_id: 'c3', name: 'Old', instance_id: 'i3', url: 'https://yoyo.service-now.com', active: 'false' },
]

test('finds the Update Source whose URL host is the source, ignoring slashes, case, and inactive records', () => {
    assert.equal(pickUpdateSource(sources, { sourceUrl: 'https://YOYO.service-now.com/' }).sys_id, 'b2')
})

test('--update-source matches by sys_id, name, or instance ID', () => {
    for (const named of ['a1', 'Dev', 'i1']) assert.equal(pickUpdateSource(sources, { sourceUrl: 'https://other', named }).sys_id, 'a1')
})

test('no match lists the active sources; a duplicate asks for --update-source', () => {
    assert.throws(() => pickUpdateSource(sources, { sourceUrl: 'https://nope.service-now.com', targetLabel: 'zorb' }), /No active Update Source for .* on zorb.*Dev \(.*Test \(/)
    const dup = [...sources, { ...sources[1], sys_id: 'd4' }]
    assert.throws(() => pickUpdateSource(dup, { sourceUrl: 'https://yoyo.service-now.com' }), /More than one/)
})
