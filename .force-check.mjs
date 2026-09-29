// Deterministic reproduction of the parallel-upload race: two writes whose
// reads both settle before either PUT, so the second one's parent is stale.
import { mkdtempSync, writeFileSync, rmSync, statSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const lines = []
const say = (t) => lines.push(t)

const ws = mkdtempSync(join(tmpdir(), 'ghp-force-'))
writeFileSync(join(ws, 'a.js'), 'export const a = 1\n')
writeFileSync(join(ws, 'b.js'), 'export const b = 2\n')

/* ------------------------------------------------- staged GitHub double -- */

let head = 'head-1'
const blobs = new Map()
const commits = []
let conflicts = 0
/** Per-file first read, held until both workers have read the same head. */
const readsSeen = new Map()
let sawBothReads = false

globalThis.fetch = async (url, init = {}) => {
  const decoded = decodeURIComponent(String(url).replace('https://api.github.com', ''))
  const method = init.method ?? 'GET'
  const json = (status, body) => ({
    ok: status < 300,
    status,
    async text() {
      return body === undefined ? '' : JSON.stringify(body)
    },
  })

  if (decoded === '/repos/octocat/demo') return json(200, { full_name: 'octocat/demo', default_branch: 'main', size: 0, private: false })
  if (decoded.startsWith('/repos/octocat/demo/git/ref/heads/')) return json(200, { object: { sha: head } })

  if (decoded.includes('/contents/') && method === 'GET') {
    const file = decoded.split('/contents/')[1].split('?')[0]
    // Hold each path's FIRST read until both workers have read, so both start
    // from the same head. Later reads (the retry's) answer with the live head.
    const gated = readsSeen.get(file)
    if (gated === undefined) {
      if (!sawBothReads) {
        const held = { released: false, snapshot: head }
        readsSeen.set(file, held)
        await new Promise((resolve) => {
          held.resolve = resolve
          if (readsSeen.size === 2) {
            sawBothReads = true
            for (const [, pending] of readsSeen) pending.resolve()
          }
        })
        held.released = true
        return json(200, { name: file, path: file, sha: blobs.get(file) ?? `stale-${held.snapshot}` })
      }
      readsSeen.set(file, { released: true, snapshot: head })
    }
    return json(200, { name: file, path: file, sha: blobs.get(file) ?? `stale-${head}` })
  }

  if (decoded.includes('/contents/') && method === 'PUT') {
    const body = JSON.parse(init.body)
    const file = decoded.split('/contents/')[1]
    const current = blobs.get(file)
    // A brand-new path has no blob to name; GitHub then only requires that the
    // write sits on the branch's current head, which the stale read violates.
    const staleCreation = current === undefined && body.sha !== undefined && body.sha.startsWith('stale-')
    if (current !== undefined && body.sha !== current) {
      conflicts += 1
      return json(409, { message: `is at ${current} but expected ${body.sha}` })
    }
    if (staleCreation && head !== 'head-1') {
      conflicts += 1
      return json(409, { message: `branch is at ${head}, not the commit the read saw` })
    }
    const blob = `blob-${file}-${commits.length}`
    blobs.set(file, blob)
    commits.push({ file, parent: head })
    head = `head-${commits.length + 1}`
    return json(201, { content: { sha: blob }, commit: { html_url: `https://github.com/octocat/demo/commit/${commits.length}` } })
  }
  return json(404, { message: `unmocked ${method} ${decoded}` })
}

/* ------------------------------------------------------------- seam ----- */

const seam = (p) => ({ targetKey: String(p).replace(/\\/g, '/'), displayPath: String(p).replace(/\\/g, '/') })
const fs = {
  async resolve(p) { return seam(p) },
  async stat(t) {
    try { const s = statSync(t.displayPath); return { version: 'v', type: s.isDirectory() ? 'directory' : 'file', size: s.size } } catch { return undefined }
  },
  async listDir(t) {
    return readdirSync(t.displayPath).map((name) => {
      const child = join(t.displayPath, name)
      const s = statSync(child)
      return { name, type: s.isDirectory() ? 'directory' : 'file', target: seam(child), size: s.isFile() ? s.size : undefined }
    })
  },
  async readText(t) { return readFileSync(t.displayPath, 'utf8') },
  async readByteRange(t, r) { return new Uint8Array(readFileSync(t.displayPath).subarray(r.offset, r.offset + r.length)) },
  async readBytes(t) { return new Uint8Array(readFileSync(t.displayPath)) },
}

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'ghp-force-home-'))
process.env.GITHUB_TOKEN = 'ghp_force_token'
const ctx = { get: (name) => (name === 'fs' ? fs : undefined) }

const { Publisher } = await import(pathToFileURL('C:/deepsseek/github-publisher/lib/publisher.js').href)
const publisher = new Publisher({ ctx, fallbackDir: ws, defaultSourceDir: ws })
const report = await publisher.push(
  { owner: 'octocat', repo: 'demo', branch: 'main', sourcePath: '.', message: 'feat: forced race', concurrency: 2 },
  { onProgress: () => {} },
)

say(`RESULT      ok=${report.ok} uploaded=${report.uploaded} failed=${report.failed}`)
say(`FAILURES    ${report.failures.length === 0 ? 'none' : report.failures.map((f) => `${f.path}: ${f.reason}`).join(' | ')}`)
say(`RACE        ${conflicts} conflict(s) hit, then resolved by the retry`)
say(`COMMITS     ${commits.map((c) => `${c.file}@${c.parent}`).join(', ')}`)
say(`VERDICT     ${report.uploaded === 2 && report.failed === 0 && conflicts > 0 ? 'retry recovered the lost race' : report.uploaded === 2 ? 'no conflict was staged (inconclusive)' : 'STILL FAILING'}`)

writeFileSync('C:/deepsseek/github-publisher/.force-report.txt', `${lines.join('\n')}\n`, 'utf8')
rmSync(ws, { recursive: true, force: true })
rmSync(process.env.DSH_HOME, { recursive: true, force: true })
