import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const source = resolve('src/renderer-vue/src/lib/configSyncCrypto.ts')
const bundle = await build({
    entryPoints: [source],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node'
})
const url = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
const { encryptText, decryptText } = await import(url)
const password = 'synthetic-password'
const plaintext = JSON.stringify({ app: 'kiro-account-manager', version: 1, proxyPool: [] })

// Recreate the existing React envelope independently with Node crypto.
const salt = randomBytes(16)
const iv = randomBytes(12)
const key = pbkdf2Sync(password, salt, 100_000, 32, 'sha256')
const cipher = createCipheriv('aes-256-gcm', key, iv)
const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
    cipher.getAuthTag()
])
const oldEnvelope = `KCFG1:${salt.toString('base64')}.${iv.toString('base64')}.${encrypted.toString('base64')}`
assert.equal(await decryptText(oldEnvelope, password), plaintext)
await assert.rejects(decryptText(oldEnvelope, 'wrong-password'))

const newEnvelope = await encryptText(plaintext, password)
const [newSalt, newIv, ciphertext] = newEnvelope
    .slice('KCFG1:'.length)
    .split('.')
    .map((part) => Buffer.from(part, 'base64'))
assert.equal(newSalt.length, 16)
assert.equal(newIv.length, 12)
const newKey = pbkdf2Sync(password, newSalt, 100_000, 32, 'sha256')
const decipher = createDecipheriv('aes-256-gcm', newKey, newIv)
decipher.setAuthTag(ciphertext.subarray(-16))
const recovered = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()])
assert.equal(recovered.toString('utf8'), plaintext)
await assert.rejects(decryptText('KCFG1:invalid', password), /Invalid encrypted payload format/)
console.log('Config sync AES-GCM envelope compatibility passed')
