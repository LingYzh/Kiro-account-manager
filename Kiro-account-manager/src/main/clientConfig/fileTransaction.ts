import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, rename, unlink, writeFile, stat, readdir } from 'fs/promises'
import { dirname, join } from 'path'
import type { DesktopConfigOperation } from '../../shared/desktopConfig'

export interface PlannedFile {
    path: string
    before: Buffer | null
    after: Buffer
    fields: string[]
}

interface JournalFile {
    path: string
    beforeHash: string | null
    afterHash: string
    backup: string | null
    mode: number
}

interface Journal extends DesktopConfigOperation {
    files: JournalFile[]
}

export async function readOptional(path: string): Promise<Buffer | null> {
    try {
        return await readFile(path)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
    }
}

export function hash(content: Buffer | null): string | null {
    return content === null ? null : createHash('sha256').update(content).digest('hex')
}

async function publish(path: string, content: Buffer, mode = 0o600): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.kam-${randomUUID()}.tmp`
    try {
        await writeFile(temporary, content, { flag: 'wx', mode })
        await rename(temporary, path)
    } finally {
        await unlink(temporary).catch(error => {
            if (error.code !== 'ENOENT') throw error
        })
    }
}

/** Byte backups and a durable journal make a multi-file change recoverable, not atomic. */
export class FileTransactionStore {
    private busy = false

    constructor(private readonly directory: string) {}

    private journalPath(id: string): string {
        if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid operation ID')
        return join(this.directory, id, 'operation.json')
    }

    private async save(journal: Journal): Promise<void> {
        await publish(this.journalPath(journal.id), Buffer.from(JSON.stringify(journal, null, 4)))
    }

    async list(): Promise<DesktopConfigOperation[]> {
        let entries: string[]
        try {
            entries = await readdir(this.directory)
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
            throw error
        }
        const operations: DesktopConfigOperation[] = []
        for (const id of entries.filter(id => /^[0-9a-f-]{36}$/.test(id))) {
            const bytes = await readOptional(this.journalPath(id))
            if (!bytes) continue // Backup preparation may have been interrupted before any target changed.
            const journal = JSON.parse(bytes.toString('utf8')) as Journal
            operations.push({ id, createdAt: journal.createdAt, status: journal.status, paths: journal.paths })
        }
        return operations.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }

    async apply(files: PlannedFile[], beforePublish?: (index: number) => Promise<void>): Promise<DesktopConfigOperation | null> {
        if (this.busy) throw new Error('A configuration operation is already running')
        this.busy = true
        let journal: Journal | undefined
        try {
            if ((await this.list()).some(item => item.status === 'pending')) {
                throw new Error('Recover the interrupted configuration operation before applying again')
            }
            // Check every input, including unchanged files, before writing any target.
            for (const file of files) {
                if (hash(await readOptional(file.path)) !== hash(file.before)) {
                    throw new Error(`Configuration changed since preview; preview again: ${file.path}`)
                }
            }
            const changed = files.filter(file => hash(file.before) !== hash(file.after))
            if (!changed.length) return null
            const id = randomUUID()
            journal = { id, createdAt: new Date().toISOString(), status: 'pending', paths: changed.map(file => file.path), files: [] }
            await mkdir(join(this.directory, id), { recursive: true, mode: 0o700 })
            for (const [index, file] of changed.entries()) {
                const backup = file.before === null ? null : join(this.directory, id, `${index}.backup`)
                if (backup && file.before) await writeFile(backup, file.before, { flag: 'wx', mode: 0o600 })
                const mode = file.before === null ? 0o600 : (await stat(file.path)).mode & 0o777
                journal.files.push({ path: file.path, beforeHash: hash(file.before), afterHash: hash(file.after)!, backup, mode })
            }
            await this.save(journal)
            for (const [index, file] of changed.entries()) {
                await beforePublish?.(index)
                if (hash(await readOptional(file.path)) !== hash(file.before)) {
                    throw new Error(`Configuration was modified externally: ${file.path}`)
                }
                await publish(file.path, file.after, journal.files[index].mode)
            }
            journal.status = 'applied'
            await this.save(journal)
            return { id, createdAt: journal.createdAt, status: journal.status, paths: journal.paths }
        } catch (error) {
            if (journal && await readOptional(this.journalPath(journal.id))) {
                try {
                    await this.restoreJournal(journal)
                } catch {
                    throw new Error(`Configuration interrupted; recovery required (${journal.id}). Existing external changes will not be overwritten.`)
                }
            }
            throw error
        } finally {
            this.busy = false
        }
    }

    private async restoreJournal(journal: Journal): Promise<void> {
        const restore: Array<{ file: JournalFile; content: Buffer | null }> = []
        // Validate the entire restore before changing any file. Never overwrite edits made after KAM.
        for (const file of journal.files) {
            const currentHash = hash(await readOptional(file.path))
            if (currentHash === file.beforeHash) continue
            if (currentHash !== file.afterHash) throw new Error(`Restore conflict; file was changed externally: ${file.path}`)
            const content = file.backup ? await readFile(file.backup) : null
            if (hash(content) !== file.beforeHash) throw new Error(`Backup validation failed: ${file.path}`)
            restore.push({ file, content })
        }
        // A restart in the middle of restore can resume using the same before/after hashes.
        journal.status = 'pending'
        await this.save(journal)
        for (const { file, content } of restore.reverse()) {
            if (hash(await readOptional(file.path)) !== file.afterHash) throw new Error(`Restore conflict: ${file.path}`)
            if (content === null) await unlink(file.path)
            else await publish(file.path, content, file.mode)
        }
        journal.status = 'restored'
        await this.save(journal)
    }

    async restore(id: string): Promise<void> {
        if (this.busy) throw new Error('A configuration operation is already running')
        this.busy = true
        try {
            const journal = JSON.parse(await readFile(this.journalPath(id), 'utf8')) as Journal
            if (journal.status !== 'restored') await this.restoreJournal(journal)
        } finally {
            this.busy = false
        }
    }
}
