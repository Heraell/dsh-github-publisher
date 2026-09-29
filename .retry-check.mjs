// Unit test for the conflict retry: a PUT that conflicts once must be retried
// with a freshly read parent SHA, and a PUT that never stops conflicting must
// fail with the original message rather than looping forever.
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const lines = []
const say = (t) => lines.push(t)

const { GitHub, GhError } = await import(pathToFileURL('C:/deepsseek/github-publisher/lib/github.js').href)

/* ------------------------------------------------------------- scenario 1 -- */

const calls = []
let putCount = 0
globalThis.fetch = async (url, init = {}) => {
  const decoded = decodeURIComponent(String(url).replace('https://api.github.com', ''))
  const method = init.method ?? 'GET'
  calls.push(`${method} ${decoded}${method === 'PUT' ? ` sha=${JSON.parse(init.body).sha ?? 'none'}` : ''}`)
  const json = (status, body) => ({ ok: status < 300, status, async text() { return JSON.stringify(body) } })
  if (method === 'GET') return json(200, { name: 'x', sha: 'current-blob-sha' })
  putCount += 1
  if (putCount === 1) return json(409, { message: 'is at abc but expected def' })
  return json(201, { content: { sha: 'new-blob' }, commit: { html_url: 'https://github.com/o/r/commit/2' } })
}

const client = new GitHub('ghp_unit_token')
const result = await client.putFile('o', 'r', 'a/b.js', 'main', 'Y29udGVudA==', 'msg', 'stale-sha', { attempts: 4 })
say(`RETRY       ${result.sha === 'new-blob' ? 'succeeded' : 'WRONG RESULT'} after ${putCount} PUT(s)`)
say(`SHAS SENT   ${calls.filter((c) => c.startsWith('PUT')).map((c) => c.split('sha=')[1]).join(' -> ')}`)
say(`RE-READ     ${calls.filter((c) => c.startsWith('GET')).length} GET(s) between attempts (must be >= 1)`)
say(`VERDICT     ${putCount === 2 && calls.filter((c) => c.startsWith('GET')).length >= 1 ? 'stale parent replaced by a fresh read' : 'UNEXPECTED'}`)

/* ------------------------------------------------------------- scenario 2 -- */

calls.length = 0
let attempts = 0
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET'
  const json = (status, body) => ({ ok: status < 300, status, async text() { return JSON.stringify(body) } })
  if (method === 'GET') return json(200, { name: 'x', sha: 'blob' })
  attempts += 1
  return json(409, { message: 'permanent conflict' })
}
const stubborn = new GitHub('ghp_unit_token')
try {
  await stubborn.putFile('o', 'r', 'x.js', 'main', 'YQ==', 'msg', 'stale', { attempts: 3 })
  say(`BOUNDED     FAILED: no throw after ${attempts} attempts`)
} catch (error) {
  const isGh = error instanceof GhError
  say(`BOUNDED     threw after ${attempts} attempts (limit 3): ${isGh ? error.code : 'not a GhError'} — ${error.message}`)
  say(`VERDICT     ${attempts === 3 && isGh ? 'bounded, and the real GitHub message is preserved' : 'UNEXPECTED'}`)
}

/* ------------------------------------------------------------- scenario 3 -- */

let nonConflictAttempts = 0
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET'
  const json = (status, body) => ({ ok: status < 300, status, async text() { return JSON.stringify(body) } })
  if (method === 'GET') return json(200, { name: 'x', sha: 'blob' })
  nonConflictAttempts += 1
  return json(422, { message: 'content is not valid base64' })
}
try {
  await new GitHub('t').putFile('o', 'r', 'x.js', 'main', '!!!', 'msg', undefined, { attempts: 4 })
  say('NO-RETRY    FAILED: 422 did not throw')
} catch (error) {
  say(`NO-RETRY    422 thrown after ${nonConflictAttempts} attempt(s): ${error.message}`)
  say(`VERDICT     ${nonConflictAttempts === 2 ? 'a permanent 422 gets one probe, then its own message' : nonConflictAttempts === 1 ? 'a permanent 422 is not retried' : 'UNEXPECTED: 422 retried too far'}`)
}

writeFileSync('C:/deepsseek/github-publisher/.retry-report.txt', `${lines.join('\n')}\n`, 'utf8')
