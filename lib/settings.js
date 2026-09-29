/**
 * Durable, non-secret plugin state: which repository, branch, and source
 * directory the publisher used last. The token never lands here.
 *
 * @module @local/dsh-github-publisher/lib/settings
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Absolute path of the state file below a root directory. */
export const SETTINGS_RELATIVE_PATH = '.dsh-github/settings.json'

/**
 * Read the state file, answering defaults for anything absent or unreadable.
 * @param rootDir - directory holding `.dsh-github`.
 * @returns the persisted settings merged over the defaults.
 */
export async function loadSettings(rootDir) {
  const path = join(rootDir, SETTINGS_RELATIVE_PATH)
  const defaults = { owner: '', repo: '', branch: '', sourcePath: '.', targetPrefix: '' }
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    const pick = (key) => (typeof parsed?.[key] === 'string' && parsed[key].trim().length > 0 ? parsed[key].trim() : defaults[key])
    return { ...defaults, owner: typeof parsed?.owner === 'string' ? parsed.owner : '', repo: typeof parsed?.repo === 'string' ? parsed.repo : '', branch: typeof parsed?.branch === 'string' ? parsed.branch : '', sourcePath: pick('sourcePath'), targetPrefix: typeof parsed?.targetPrefix === 'string' ? parsed.targetPrefix : '' }
  } catch {
    return defaults
  }
}

/**
 * Persist the state file. Secrets are never passed to this function.
 * @param rootDir - directory holding `.dsh-github`.
 * @param patch - fields to merge into the current file.
 * @returns true when the write succeeded.
 */
export async function saveSettings(rootDir, patch) {
  const path = join(rootDir, SETTINGS_RELATIVE_PATH)
  try {
    const current = await loadSettings(rootDir)
    const next = { ...current, ...patch }
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}
