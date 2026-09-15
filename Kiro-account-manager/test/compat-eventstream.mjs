import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { build } from 'esbuild'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const virtualFile = resolve(project, 'test/compat-eventstream-bundle.cjs')
const compiled = await build({
    stdin: {
        contents: "export { crc32, readEventStreamFrame } from '../src/main/proxy/eventStreamFrame'",
        resolveDir: resolve(project, 'test'),
        loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false
})
const bundledModule = new Module(virtualFile)
bundledModule.filename = virtualFile
bundledModule.paths = Module._nodeModulePaths(project)
bundledModule.require = createRequire(virtualFile)
bundledModule._compile(compiled.outputFiles[0].text, virtualFile)
const { crc32, readEventStreamFrame } = bundledModule.exports

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function fixtureCrc32(bytes) {
    let value = 0xffffffff
    for (const byte of bytes) {
        value ^= byte
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
        }
    }
    return (value ^ 0xffffffff) >>> 0
}

function concatBytes(...parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0)
    const result = new Uint8Array(length)
    let offset = 0
    for (const part of parts) {
        result.set(part, offset)
        offset += part.length
    }
    return result
}

function uint16(value) {
    return Uint8Array.of((value >>> 8) & 0xff, value & 0xff)
}

function encodeHeaderBytes(nameBytes, type, valueBytes) {
    return concatBytes(Uint8Array.of(nameBytes.length), nameBytes, Uint8Array.of(type), valueBytes)
}

function encodeHeader(name, type, valueBytes) {
    return encodeHeaderBytes(textEncoder.encode(name), type, valueBytes)
}

function encodeStringHeader(name, value) {
    const valueBytes = textEncoder.encode(value)
    return encodeHeader(name, 7, concatBytes(uint16(valueBytes.length), valueBytes))
}

function makeFrame(headers, payload = new Uint8Array()) {
    const totalLength = 12 + headers.length + payload.length + 4
    const frame = new Uint8Array(totalLength)
    const view = new DataView(frame.buffer)
    view.setUint32(0, totalLength, false)
    view.setUint32(4, headers.length, false)
    view.setUint32(8, fixtureCrc32(frame.subarray(0, 8)), false)
    frame.set(headers, 12)
    frame.set(payload, 12 + headers.length)
    view.setUint32(totalLength - 4, fixtureCrc32(frame.subarray(0, totalLength - 4)), false)
    return frame
}

function makePrelude(totalLength, headersLength) {
    const prelude = new Uint8Array(12)
    const view = new DataView(prelude.buffer)
    view.setUint32(0, totalLength, false)
    view.setUint32(4, headersLength, false)
    view.setUint32(8, fixtureCrc32(prelude.subarray(0, 8)), false)
    return prelude
}

const fixedFrame = Uint8Array.from(Buffer.from(
    '0000002b0000001627e7742d0b3a6576656e742d747970650700076669787475726568656c6c6fe148bc20',
    'hex'
))

assert.equal(crc32(textEncoder.encode('123456789')), 0xcbf43926, 'CRC32 must match the standard IEEE check vector')

const parsedFixed = readEventStreamFrame(fixedFrame)
assert.equal(parsedFixed.length, 43)
assert.deepEqual(parsedFixed.headers, { ':event-type': 'fixture' })
assert.equal(textDecoder.decode(parsedFixed.payload), 'hello')

assert.equal(readEventStreamFrame(fixedFrame.subarray(0, 11)), undefined, 'short prelude is incomplete')
assert.equal(readEventStreamFrame(fixedFrame.subarray(0, 12)), undefined, 'valid prelude without the body is incomplete')
assert.equal(readEventStreamFrame(fixedFrame.subarray(0, fixedFrame.length - 1)), undefined, 'partial frame is incomplete')

const secondFrame = makeFrame(encodeStringHeader('phase', 'second'), textEncoder.encode('next'))
const concatenated = concatBytes(fixedFrame, secondFrame)
const firstRead = readEventStreamFrame(concatenated)
assert.equal(firstRead.length, fixedFrame.length, 'a read must consume only the first frame')
assert.equal(textDecoder.decode(firstRead.payload), 'hello')
const secondRead = readEventStreamFrame(concatenated.subarray(firstRead.length))
assert.equal(secondRead.headers.phase, 'second')
assert.equal(textDecoder.decode(secondRead.payload), 'next')

const badPreludeCrc = fixedFrame.slice()
badPreludeCrc[8] ^= 1
assert.throws(() => readEventStreamFrame(badPreludeCrc), /prelude CRC32 mismatch/)

const badMessageCrc = fixedFrame.slice()
badMessageCrc[badMessageCrc.length - 1] ^= 1
assert.throws(() => readEventStreamFrame(badMessageCrc), /message CRC32 mismatch/)

const zeroLength = fixedFrame.slice()
new DataView(zeroLength.buffer).setUint32(0, 0, false)
assert.throws(() => readEventStreamFrame(zeroLength), /total length must be at least 16/)

const headerLengthOverflow = fixedFrame.slice()
new DataView(headerLengthOverflow.buffer).setUint32(4, fixedFrame.length - 15, false)
assert.throws(() => readEventStreamFrame(headerLengthOverflow), /header length exceeds total length/)

const allTypes = concatBytes(
    encodeHeader('true', 0, new Uint8Array()),
    encodeHeader('false', 1, new Uint8Array()),
    encodeHeader('byte', 2, Uint8Array.of(1)),
    encodeHeader('short', 3, Uint8Array.of(0, 1)),
    encodeHeader('integer', 4, Uint8Array.of(0, 0, 0, 1)),
    encodeHeader('long', 5, Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 1)),
    encodeHeader('blob', 6, concatBytes(uint16(2), Uint8Array.of(0xaa, 0xbb))),
    encodeHeader('visible', 7, concatBytes(uint16(5), textEncoder.encode('value'))),
    encodeHeader('timestamp', 8, Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 1)),
    encodeHeader('uuid', 9, new Uint8Array(16))
)
assert.deepEqual(readEventStreamFrame(makeFrame(allTypes)).headers, { visible: 'value' }, 'non-string headers are validated and skipped')

assert.throws(
    () => readEventStreamFrame(makeFrame(encodeHeader('future', 10, new Uint8Array()))),
    /unknown header type 10/
)
assert.throws(
    () => readEventStreamFrame(makeFrame(encodeHeaderBytes(Uint8Array.of(0xff), 7, concatBytes(uint16(1), Uint8Array.of(0x61))))),
    /header name is not valid UTF-8/
)
assert.throws(
    () => readEventStreamFrame(makeFrame(encodeHeaderBytes(textEncoder.encode('text'), 7, concatBytes(uint16(1), Uint8Array.of(0xff))))),
    /string value .* is not valid UTF-8/
)
assert.throws(
    () => readEventStreamFrame(makeFrame(concatBytes(encodeStringHeader('duplicate', 'one'), encodeStringHeader('duplicate', 'two')))),
    /duplicate header name/
)
assert.throws(
    () => readEventStreamFrame(makeFrame(encodeHeader('short-integer', 4, Uint8Array.of(1, 2)))),
    /truncated integer value/
)
assert.throws(
    () => readEventStreamFrame(makeFrame(encodeHeader('short-blob', 6, concatBytes(uint16(3), Uint8Array.of(1, 2))))),
    /truncated byte array value/
)
assert.throws(
    () => readEventStreamFrame(makeFrame(encodeHeader('empty-string', 7, uint16(0)))),
    /string value length .* must be between 1 and 32767 bytes/
)

const payloadOverServiceLimit = makePrelude(16 + 24 * 1024 * 1024 + 1, 0)
assert.equal(readEventStreamFrame(payloadOverServiceLimit), undefined, 'clients must not enforce the service payload-size limit')
const headersOverServiceLimit = makePrelude(16 + 128 * 1024 + 1, 128 * 1024 + 1)
assert.equal(readEventStreamFrame(headersOverServiceLimit), undefined, 'clients must not enforce the service encoded-header-size limit')

console.log('compat-eventstream: passed')
