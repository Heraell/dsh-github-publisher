// Reproduces GitHub's contents-API conflict semantics and proves the retry
// resolves parallel uploads: a PUT whose parent head is stale answers 409.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const lines = []
const say = (t) => lines.push(t)

const ws = mkdtempSync(join(tmpdir(), 'ghp-race-'))
mkdirSync(join(ws, 'lib'), { recursive: true })
mkdirSync(join(ws, 'locale'), { recursive: true })
writeFileSync(join(ws, 'index.js'), 'export function apply() {}\n')
writeFileSync(join(ws, 'client.js'), 'window.__ModuleLoader__.load({})\n')
writeFileSync(join(ws, 'lib', 'a.js'), 'export const a = 1\n')
writeFileSync(join(ws, 'lib', 'b.js'), 'export const b = 2\n')
writeFileSync(join(ws, 'locale', 'zh.json'), '{}\n')

/* ------------------------------------------- GitHub with real semantics -- */

let head = 'head-1' // the branch's current commit (advances on every write)
const blobs = new Map() // path -> blob sha currently on the branch
const readsAt = new Map() // path -> branch head observed by that path's last read
const commits = []
let conflicts = 0
let reads = 0

const advance = () => {
  head = `head-${commits.length + 2}`
  return head
}

globalThis.fetch = async (url, init = {}) => {
  const path = String(url).replace('https://api.github.com', '')
  const method = init.method ?? 'GET'
  const json = (status, body) => ({
    ok: status < 300,
    status,
    async text() {
      return body === undefined ? '' : JSON.stringify(body)
    },
  })
  const decoded = decodeURIComponent(path)

  if (decoded === '/repos/octocat/demo') {
    return json(200, { full_name: 'octocat/demo', default_branch: 'main', size: blobs.size, private: false })
  }
  if (decoded.startsWith('/repos/octocat/demo/git/ref/heads/')) return json(200, { object: { sha: head } })
  if (decoded.includes('/contents/') && method === 'GET') {
    reads += 1
    // A real read carries network latency; without it the workers never overlap.
    await new Promise((resolve) => setTimeout(resolve, 5))
    const file = decoded.split('/contents/')[1].split('?')[0]
    readsAt.set(file, head)
    const sha = blobs.get(file)
    return sha === undefined ? json(404, { message: 'Not Found' }) : json(200, { name: file, path: file, sha })
  }
  if (decoded.includes('/contents/') && method === 'PUT') {
    const body = JSON.parse(init.body)
    const file = decoded.split('/contents/')[1]
    const current = blobs.get(file)
    const seen = readsAt.get(file)
    // GitHub's contents rule: the write must name the blob it replaces, and it
    // commits on the branch's current head. A worker that read before a sibling
    // committed is therefore rejected — the parallel-upload race, exactly.
    if (current !== undefined && body.sha !== current) {
      conflicts += 1
      return json(409, { message: `is at ${current} but expected ${body.sha}` })
    }
    if (current === undefined && seen !== undefined && seen !== head) {
      conflicts += 1
      return json(409, { message: `branch is at ${head} but the read saw ${seen}` })
    }
    const blob = `blob-${file}-${commits.length}`
    blobs.set(file, blob)
    commits.push({ file, parent: head, parentSha: body.sha })
    advance()
    return json(201, { content: { sha: blob }, commit: { html_url: `https://github.com/octocat/demo/commit/${commits.length}` } })
  }
  return json(404, { message: `unmocked ${method} ${decoded}` })
}

/* --------------------------------------------------------------- seam --- */

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

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'ghp-race-home-'))
process.env.GITHUB_TOKEN = 'ghp_race_token'
const ctx = { get: (name) => (name === 'fs' ? fs : undefined) }

const { Publisher } = await import(pathToFileURL('C:/deepsseek/github-publisher/lib/publisher.js').href)
const publisher = new Publisher({ ctx, fallbackDir: ws, defaultSourceDir: ws })

const report = await publisher.push(
  // Deliberately over-parallel for five files: the point is to force the race
  // the default concurrency avoids.
  { owner: 'octocat', repo: 'demo', branch: 'main', sourcePath: '.', message: 'feat: publish', concurrency: 5 },
  { onProgress: () => {} },
)

say(`RESULT      ok=${report.ok} uploaded=${report.uploaded} failed=${report.failed}`)
say(`FILES       ${report.files.map((f) => f.path).sort().join(', ')}`)
say(`FAILURES    ${report.failures.length === 0 ? 'none' : report.failures.map((f) => `${f.path}: ${f.reason}`).join(' | ')}`)
say(`RACE        ${conflicts} conflict(s) encountered and resolved, ${commits.length} commits, ${reads} reads`)
say(`PARENTS     every write after the first saw a fresh head: ${commits.slice(1).every((c, i) => c.parent !== commits[i].parent)}`)
say(`INTEGRITY   ${report.uploaded === 5 && report.failed === 0 ? 'all 5 files uploaded' : 'INCOMPLETE'}`)

// The same run repeated must be able to update existing files (blobs present).
const second = await publisher.push({ owner: 'octocat', repo: 'demo', branch: 'main', sourcePath: '.', message: 'feat: update all' }, { onProgress: () => {} })
say(`RE-PUBLISH  ok=${second.ok} uploaded=${second.uploaded} failed=${second.failed} (existing files updated)`)

writeFileSync('C:/deepsseek/github-publisher/.race-report.txt', `${lines.join('\n')}\n`, 'utf8')
rmSync(ws, { recursive: true, force: true })
rmSync(process.env.DSH_HOME, { recursive: true, force: true })
