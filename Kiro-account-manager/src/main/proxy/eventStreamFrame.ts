const CRC32_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let index = 0; index < table.length; index++) {
        let value = index
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
        }
        table[index] = value >>> 0
    }
    return table
})()

export function crc32(bytes: Uint8Array): number {
    let checksum = 0xffffffff
    for (const byte of bytes) {
        checksum = CRC32_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8)
    }
    return (checksum ^ 0xffffffff) >>> 0
}

function decodeUtf8(bytes: Uint8Array, field: string): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        throw new Error(`Invalid EventStream header: ${field} is not valid UTF-8`)
    }
}

function requireHeaderBytes(offset: number, length: number, end: number, field: string): void {
    if (length > end - offset) {
        throw new Error(`Invalid EventStream header: truncated ${field}`)
    }
}

function readHeaders(buffer: Uint8Array, start: number, end: number): Record<string, string> {
    const headers: Record<string, string> = {}
    const seenNames = new Set<string>()
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    let offset = start

    while (offset < end) {
        const nameLength = buffer[offset++]
        if (nameLength === 0) {
            throw new Error('Invalid EventStream header: header name must not be empty')
        }
        requireHeaderBytes(offset, nameLength, end, 'header name')
        const name = decodeUtf8(buffer.subarray(offset, offset + nameLength), 'header name')
        offset += nameLength
        if (name.length === 0) {
            throw new Error('Invalid EventStream header: header name must not be empty')
        }
        if (seenNames.has(name)) {
            throw new Error(`Invalid EventStream header: duplicate header name ${JSON.stringify(name)}`)
        }
        seenNames.add(name)

        requireHeaderBytes(offset, 1, end, `type for ${JSON.stringify(name)}`)
        const type = buffer[offset++]
        let stringValue: string | undefined

        switch (type) {
            case 0:
            case 1:
                break
            case 2:
                requireHeaderBytes(offset, 1, end, `byte value for ${JSON.stringify(name)}`)
                offset += 1
                break
            case 3:
                requireHeaderBytes(offset, 2, end, `short value for ${JSON.stringify(name)}`)
                offset += 2
                break
            case 4:
                requireHeaderBytes(offset, 4, end, `integer value for ${JSON.stringify(name)}`)
                offset += 4
                break
            case 5:
            case 8:
                requireHeaderBytes(offset, 8, end, `${type === 5 ? 'long' : 'timestamp'} value for ${JSON.stringify(name)}`)
                offset += 8
                break
            case 6:
            case 7: {
                requireHeaderBytes(offset, 2, end, `length for ${type === 6 ? 'byte array' : 'string'} value ${JSON.stringify(name)}`)
                const valueLength = view.getUint16(offset, false)
                offset += 2
                if (valueLength < 1 || valueLength > 0x7fff) {
                    throw new Error(`Invalid EventStream header: ${type === 6 ? 'byte array' : 'string'} value length for ${JSON.stringify(name)} must be between 1 and 32767 bytes`)
                }
                requireHeaderBytes(offset, valueLength, end, `${type === 6 ? 'byte array' : 'string'} value for ${JSON.stringify(name)}`)
                if (type === 7) {
                    stringValue = decodeUtf8(buffer.subarray(offset, offset + valueLength), `string value for ${JSON.stringify(name)}`)
                }
                offset += valueLength
                break
            }
            case 9:
                requireHeaderBytes(offset, 16, end, `UUID value for ${JSON.stringify(name)}`)
                offset += 16
                break
            default:
                throw new Error(`Invalid EventStream header: unknown header type ${type} for ${JSON.stringify(name)}`)
        }

        if (stringValue !== undefined) {
            // Define properties explicitly so a valid header named "__proto__" stays data.
            Object.defineProperty(headers, name, {
                value: stringValue,
                enumerable: true,
                configurable: true,
                writable: true
            })
        }
    }

    return headers
}

export function readEventStreamFrame(buffer: Uint8Array): { length: number; headers: Record<string, string>; payload: Uint8Array } | undefined {
    if (buffer.byteLength < 12) return undefined

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const totalLength = view.getUint32(0, false)
    const headersLength = view.getUint32(4, false)
    if (totalLength < 16) {
        throw new Error('Invalid EventStream frame: total length must be at least 16 bytes')
    }
    if (headersLength > totalLength - 16) {
        throw new Error('Invalid EventStream frame: header length exceeds total length')
    }

    const expectedPreludeCrc = view.getUint32(8, false)
    if (crc32(buffer.subarray(0, 8)) !== expectedPreludeCrc) {
        throw new Error('Invalid EventStream frame: prelude CRC32 mismatch')
    }

    if (buffer.byteLength < totalLength) return undefined

    const expectedMessageCrc = view.getUint32(totalLength - 4, false)
    if (crc32(buffer.subarray(0, totalLength - 4)) !== expectedMessageCrc) {
        throw new Error('Invalid EventStream frame: message CRC32 mismatch')
    }

    const headersStart = 12
    const headersEnd = headersStart + headersLength
    const headers = readHeaders(buffer, headersStart, headersEnd)
    return {
        length: totalLength,
        headers,
        payload: buffer.subarray(headersEnd, totalLength - 4)
    }
}
