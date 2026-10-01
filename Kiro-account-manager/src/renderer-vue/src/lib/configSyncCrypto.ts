const ENC_PREFIX = 'KCFG1:'
const PBKDF2_ITER = 100_000

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder()
    const baseKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password).slice().buffer,
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    )
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt.slice().buffer, iterations: PBKDF2_ITER, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    )
}

function b64encode(bytes: ArrayBuffer | Uint8Array): string {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    let text = ''
    for (let i = 0; i < arr.length; i++) text += String.fromCharCode(arr[i])
    return btoa(text)
}

function b64decode(value: string): Uint8Array {
    const text = atob(value)
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
    return bytes
}

export async function encryptText(plaintext: string, password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveKey(password, salt)
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv.slice().buffer },
        key,
        new TextEncoder().encode(plaintext).slice().buffer
    )
    return `${ENC_PREFIX}${b64encode(salt)}.${b64encode(iv)}.${b64encode(ciphertext)}`
}

export async function decryptText(envelope: string, password: string): Promise<string> {
    if (!envelope.startsWith(ENC_PREFIX)) throw new Error('Not an encrypted KCFG payload')
    const parts = envelope.slice(ENC_PREFIX.length).split('.')
    if (parts.length !== 3) throw new Error('Invalid encrypted payload format')
    const [saltB64, ivB64, ciphertextB64] = parts
    const salt = b64decode(saltB64)
    const iv = b64decode(ivB64)
    const ciphertext = b64decode(ciphertextB64)
    const key = await deriveKey(password, salt)
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv.slice().buffer },
        key,
        ciphertext.slice().buffer
    )
    return new TextDecoder().decode(plaintext)
}
