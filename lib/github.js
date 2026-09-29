/**
 * GitHub REST access for the publisher: token storage, one request helper, and
 * the handful of endpoints the UI and the model-facing tools need.
 *
 * Everything here runs on the Host half. The browser half never sees the token:
 * it reaches these functions through the `/api/github-publisher` route.
 *
 * @module @local/dsh-github-publisher/lib/github
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Environment variable consulted when no token has been stored. */
export const TOKEN_ENV = 'GITHUB_TOKEN'

/** Second environment variable consulted, matching the `gh` CLI convention. */
export const TOKEN_ENV_ALT = 'GH_TOKEN'

/** Credential reference name: `$DSH_HOME/.credentials.yaml` entry. */
const CREDENTIAL_REF = 'GITHUB_TOKEN'

/** Workspace-relative durable store, used when the home store is not writable. */
export const WORKSPACE_STORE_PATH = '.dsh-github/credentials.json'

/** Default REST endpoint; overridable for a GitHub Enterprise host. */
const DEFAULT_API_BASE = 'https://api.github.com'

const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Resolve `$DSH_HOME` the way the rest of the Harness does. */
function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

const homeStorePath = () => join(resolveDshHome(), '.credentials.yaml')

/** Display form of the home store, matching `dshHomeDisplay`. */
const HOME_LABEL = () =>
  typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim().length > 0 ? '$DSH_HOME' : '~/.dsh'

/** A plugin-owned error carrying a stable code the UI can branch on. */
export class GhError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'GhError'
    this.code = code
    if (status !== undefined) this.status = status
  }
}

/** One-line description of a caught value, for a failure report. */
function describe(error) {
  if (error === null || error === undefined) return '未知错误'
  if (error instanceof Error) return error.message
  return String(error)
}

/* ------------------------------------------------------------------ token -- */

/**
 * Token storage with three readable sources and two writable ones.
 *
 * Read precedence: process environment, `$DSH_HOME/.credentials.yaml`,
 * workspace-local store. Write precedence: home store, then workspace store —
 * whichever succeeds first wins, and the caller is told which one persisted.
 */
export class TokenStore {
  /**
   * @param ctx - plugin context, used for optional `fs` access.
   * @param fallbackDir - absolute directory holding the fallback store file.
   */
  constructor(ctx, fallbackDir) {
    this.ctx = ctx
    this.fallbackDir = fallbackDir
    this.cache = { value: undefined, source: undefined, loaded: false }
  }

  /** The filesystem seam; `undefined` when this profile composes no `fs`. */
  fs() {
    const service = this.ctx.get('fs')
    return service === undefined ? undefined : service
  }

  /**
   * Normalize a path for the filesystem seam: the seam speaks POSIX separators
   * on every platform.
   * @param path - absolute path in host form.
   */
  static seamPath(path) {
    return path.replace(/\\/g, '/')
  }

  /**
   * Read the credential document's text.
   *
   * The `fs` seam first (it is the composed filesystem this Harness sees), then
   * Node's own `fs`, so a read works in exactly the compositions a write does.
   *
   * @param path - absolute path in host form.
   * @returns the file text, or `undefined` when it cannot be read.
   */
  async readText(path) {
    const fs = this.fs()
    if (fs !== undefined) {
      try {
        return await fs.readText(await fs.resolve(TokenStore.seamPath(path)))
      } catch {
        // Fall through to Node fs: the seam may not reach outside the workspace.
      }
    }
    try {
      return await readFile(path, 'utf8')
    } catch {
      return undefined
    }
  }

  /** Read `$DSH_HOME/.credentials.yaml` without pulling a YAML dependency. */
  async readHomeStore() {
    const text = await this.readText(homeStorePath())
    if (text === undefined) return undefined
    const match = new RegExp(`^[ \\t]*${CREDENTIAL_REF}[ \\t]*:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(text)
    if (match === null) return undefined
    return match[1].replace(/^["']|["']$/g, '').trim() || undefined
  }

  /** Read the workspace-local JSON store. */
  async readWorkspaceStore() {
    const text = await this.readText(join(this.fallbackDir, WORKSPACE_STORE_PATH))
    if (text === undefined) return undefined
    try {
      const parsed = JSON.parse(text)
      const token = typeof parsed?.token === 'string' ? parsed.token.trim() : ''
      return token.length > 0 ? token : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Resolve the active token.
   * @returns the token and where it came from, or `undefined` while unconfigured.
   */
  async resolve() {
    if (this.cache.loaded && this.cache.value !== undefined) {
      return { token: this.cache.value, source: this.cache.source }
    }
    for (const name of [TOKEN_ENV, TOKEN_ENV_ALT]) {
      const raw = process.env[name]
      if (typeof raw === 'string' && raw.trim().length > 0) {
        this.cache = { value: raw.trim(), source: `环境变量 ${name}`, loaded: true }
        return { token: this.cache.value, source: this.cache.source }
      }
    }
    const home = await this.readHomeStore()
    if (home !== undefined) {
      this.cache = { value: home, source: `${HOME_LABEL()}/.credentials.yaml（DSH 凭据存储）`, loaded: true }
      return { token: home, source: this.cache.source }
    }
    const workspace = await this.readWorkspaceStore()
    if (workspace !== undefined) {
      this.cache = { value: workspace, source: `工作区文件 ${WORKSPACE_STORE_PATH}`, loaded: true }
      return { token: workspace, source: this.cache.source }
    }
    this.cache = { value: undefined, source: undefined, loaded: true }
    return undefined
  }

  /** Describe the active token without exposing it. */
  async describe() {
    const found = await this.resolve()
    if (found === undefined) return { configured: false }
    const { token, source } = found
    return {
      configured: true,
      source,
      hint: `${token.slice(0, 4)}…${token.slice(-4)}`,
    }
  }

  /** Serialize one scalar as a YAML mapping entry. */
  static yamlLine(value) {
    return `${CREDENTIAL_REF}: ${JSON.stringify(value)}`
  }

  /** The YAML line pattern this store owns inside the shared credential file. */
  static linePattern() {
    return new RegExp(`^[ \\t]*${CREDENTIAL_REF}[ \\t]*:.*$`, 'm')
  }

  /**
   * Persist a token, best store first.
   *
   * 1. The Harness credential service — it takes the document lock, writes
   *    atomically at `0600`, and preserves every other entry, which is exactly
   *    what a hand-rolled rewrite of a file that also holds the account key and
   *    the browser session cannot promise.
   * 2. Node's `fs/promises` on the same document, for a composition without the
   *    service. Only the one owned line changes; the rest of the text is kept
   *    byte for byte.
   * 3. The workspace-local JSON store, when even the home document is read-only.
   *
   * The token stays in memory only when all three fail, and the caller is told
   * which store actually accepted it — a silent "connected" that dies with the
   * process is worse than a failure.
   *
   * @param token - non-empty PAT.
   * @returns the store that accepted it, as text for the UI.
   */
  async save(token) {
    const value = String(token ?? '').trim()
    if (value.length === 0) throw new GhError('token-empty', 'Token 不能为空。')
    if (!REF_PATTERN.test(CREDENTIAL_REF)) throw new GhError('internal', '内部凭据引用名非法。')
    this.cache = { value, source: undefined, loaded: false }
    const homeLabel = `${HOME_LABEL()}/.credentials.yaml（DSH 凭据存储）`
    const reasons = []

    // 1. The credential service.
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined && typeof credentials.set === 'function') {
      try {
        await credentials.set(CREDENTIAL_REF, value)
        this.cache = { value, source: homeLabel, loaded: true }
        return homeLabel
      } catch (error) {
        reasons.push(`凭据服务：${describe(error)}`)
      }
    }

    // 2. Node fs on the same document: replace or add exactly one line.
    try {
      const path = homeStorePath()
      let existing = ''
      try {
        existing = await readFile(path, 'utf8')
      } catch {
        existing = ''
      }
      const line = TokenStore.yamlLine(value)
      const pattern = TokenStore.linePattern()
      let body
      if (existing.trim().length === 0) body = `${line}\n`
      else if (pattern.test(existing)) body = existing.replace(pattern, line)
      else if (/^refs:[ \t]*$/m.test(existing)) body = existing.replace(/^refs:[ \t]*$/m, `refs:\n  ${line}`)
      else body = `${existing.replace(/\s*$/, '')}\nrefs:\n  ${line}\n`
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body, { encoding: 'utf8', mode: 0o600 })
      this.cache = { value, source: homeLabel, loaded: true }
      return homeLabel
    } catch (error) {
      reasons.push(`凭据文件：${describe(error)}`)
    }

    // 3. The workspace-local store.
    const fs = this.fs()
    if (fs !== undefined) {
      try {
        const target = await fs.resolve(TokenStore.seamPath(join(this.fallbackDir, WORKSPACE_STORE_PATH)))
        await fs.writeText(target, `${JSON.stringify({ token: value, savedAt: new Date().toISOString() }, null, 2)}\n`)
        this.cache = { value, source: `工作区文件 ${WORKSPACE_STORE_PATH}`, loaded: true }
        return `${this.cache.source}（注意：该文件在你当前的工作区里，不要把它推送到远程仓库）`
      } catch (error) {
        reasons.push(`工作区文件：${describe(error)}`)
      }
    }

    this.cache = { value, source: '仅本次运行的内存', loaded: true }
    return `仅本次运行的内存（重启 Harness 后需要重新填写。原因：${reasons.join('；') || '没有可写的存储'}）`
  }

  /** Forget the in-memory token; stored copies are reported, not deleted. */
  clearCache() {
    this.cache = { value: undefined, source: undefined, loaded: false }
  }
}

/* --------------------------------------------------------------- requests -- */

/** Best-effort extraction of a useful message from a GitHub error body. */
function gitHubMessage(status, body, fallback) {
  try {
    const parsed = JSON.parse(body)
    const message = typeof parsed?.message === 'string' ? parsed.message : undefined
    const errors = Array.isArray(parsed?.errors)
      ? parsed.errors
          .map((entry) => (typeof entry?.message === 'string' ? entry.message : undefined))
          .filter((entry) => entry !== undefined)
          .join('; ')
      : ''
    if (message !== undefined) return errors.length > 0 ? `${message} (${errors})` : message
  } catch {
    // Non-JSON body (proxy error page, empty 5xx).
  }
  return fallback ?? `GitHub 返回 HTTP ${status}`
}

/** Human-readable hint for the failures users actually hit. */
function gitHubHint(status) {
  if (status === 401) return 'Token 无效或已过期，请重新连接。'
  if (status === 403) return '权限不足或被限流：确认 Token 勾选了 repo（或 public_repo）范围，并稍后重试。'
  if (status === 404) return '仓库或分支不存在，或当前 Token 无权访问私有仓库。'
  if (status === 409) return '仓库当前为空或存在并发写入，请重试。'
  if (status === 422) return '参数被 GitHub 拒绝：分支名可能非法，或文件内容不符合该仓库规则。'
  return undefined
}

/**
 * A thin, retrying GitHub REST client bound to one token.
 */
export class GitHub {
  /**
   * @param token - PAT used for every call.
   * @param options - optional API base and user agent.
   */
  constructor(token, options = {}) {
    this.token = token
    this.apiBase = (options.apiBase ?? process.env.DSH_GITHUB_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, '')
    this.userAgent = options.userAgent ?? 'dsh-github-publisher'
  }

  /**
   * One REST call.
   * @param method - HTTP method.
   * @param path - path below the API base, e.g. `/user`.
   * @param body - JSON body, omitted for GET.
   * @param options - `{ allow404, signal, retries }`.
   * @returns the parsed JSON body (or `undefined` for 204/404-with-allow404).
   */
  async request(method, path, body, options = {}) {
    const url = `${this.apiBase}${path}`
    const headers = {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${this.token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': this.userAgent,
    }
    const init = { method, headers }
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    if (options.signal !== undefined) init.signal = options.signal

    const retries = options.retries ?? 2
    let lastError
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let response
      try {
        response = await fetch(url, init)
      } catch (error) {
        lastError = new GhError('network', `无法连接 GitHub：${error instanceof Error ? error.message : String(error)}`)
        if (attempt < retries) {
          await delay(400 * (attempt + 1))
          continue
        }
        throw lastError
      }
      if (response.status === 404 && options.allow404 === true) return undefined
      if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt < retries) {
        await delay(500 * (attempt + 1))
        continue
      }
      const text = await response.text()
      if (!response.ok) {
        const message = gitHubMessage(response.status, text, undefined)
        const hint = gitHubHint(response.status)
        throw new GhError(
          `github-${response.status}`,
          hint === undefined ? `${method} ${path} 失败：${message}` : `${hint}（${message}）`,
          response.status,
        )
      }
      if (text.length === 0) return undefined
      try {
        return JSON.parse(text)
      } catch {
        return undefined
      }
    }
    throw lastError ?? new GhError('network', 'GitHub 请求失败。')
  }

  /** The authenticated account. */
  async viewer() {
    const user = await this.request('GET', '/user')
    return {
      login: String(user?.login ?? ''),
      name: typeof user?.name === 'string' ? user.name : undefined,
      avatarUrl: typeof user?.avatar_url === 'string' ? user.avatar_url : undefined,
      htmlUrl: typeof user?.html_url === 'string' ? user.html_url : undefined,
      scopes: undefined,
    }
  }

  /** Repositories the token can push to, most recently updated first. */
  async listRepos(limit = 100) {
    const repos = await this.request(
      'GET',
      `/user/repos?per_page=${Math.min(Math.max(limit, 1), 100)}&sort=updated&affiliation=owner,collaborator,organization_member`,
    )
    if (!Array.isArray(repos)) return []
    return repos
      .filter((repo) => repo !== null && typeof repo === 'object')
      .map((repo) => ({
        fullName: String(repo.full_name ?? ''),
        name: String(repo.name ?? ''),
        owner: String(repo.owner?.login ?? ''),
        private: repo.private === true,
        defaultBranch: String(repo.default_branch ?? 'main'),
        htmlUrl: String(repo.html_url ?? ''),
        permissions: { push: repo.permissions?.push === true },
      }))
      .filter((repo) => repo.fullName.length > 0 && repo.permissions.push)
  }

  /** One repository's metadata, or `undefined` when it is not reachable. */
  async getRepo(owner, repo) {
    const data = await this.request('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, undefined, {
      allow404: true,
    })
    if (data === undefined) return undefined
    return {
      fullName: String(data.full_name ?? `${owner}/${repo}`),
      defaultBranch: String(data.default_branch ?? 'main'),
      htmlUrl: String(data.html_url ?? ''),
      private: data.private === true,
      size: typeof data.size === 'number' ? data.size : undefined,
    }
  }

  /** Whether a ref exists. */
  async refExists(owner, repo, branch) {
    const data = await this.request(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
      undefined,
      { allow404: true },
    )
    return data !== undefined
  }

  /** The commit SHA a branch currently points at, or `undefined` for an absent ref. */
  async branchHead(owner, repo, branch) {
    const data = await this.request(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
      undefined,
      { allow404: true },
    )
    const sha = data?.object?.sha
    return typeof sha === 'string' ? sha : undefined
  }

  /**
   * The blob SHA of one path on a branch, needed to update an existing file.
   * @returns the SHA, `undefined` when the path does not exist on that branch.
   */
  async fileSha(owner, repo, path, branch, signal) {
    const data = await this.request(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
      undefined,
      { allow404: true, signal },
    )
    const sha = data?.sha
    return typeof sha === 'string' ? sha : undefined
  }

  /**
   * Create or update one file on a branch.
   *
   * A `contents` write carries the parent commit's file SHA, so two concurrent
   * writes to one branch conflict: the first commits, and the second's SHA is
   * already stale. That is exactly what parallel uploads produce, so a conflict
   * is retried here — re-reading the path's current SHA against the branch's new
   * head — instead of surfacing as a failed file.
   *
   * @param options - `{ signal, attempts }`.
   * @returns the commit URL and the blob SHA GitHub reported.
   */
  async putFile(owner, repo, path, branch, contentBase64, message, sha, options = {}) {
    const attempts = Math.max(Number(options.attempts) || 5, 1)
    const signal = options.signal
    let parentSha = sha
    let lastError
    let validationRetries = 0
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const body = { message, content: contentBase64, branch }
      if (parentSha !== undefined) body.sha = parentSha
      try {
        const data = await this.request(
          'PUT',
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`,
          body,
          { signal },
        )
        return {
          sha: typeof data?.content?.sha === 'string' ? data.content.sha : undefined,
          commitUrl: typeof data?.commit?.html_url === 'string' ? data.commit.html_url : undefined,
        }
      } catch (error) {
        lastError = error
        const status = error instanceof GhError ? error.status : undefined
        // 409 is the lost race. 422 is usually a permanent rejection, but GitHub
        // also answers it for a write racing an empty repository, so it earns
        // exactly one retry and then keeps its own message.
        const retryable = status === 409 || (status === 422 && validationRetries < 1)
        if (!retryable || attempt === attempts - 1) throw error
        if (status === 422) validationRetries += 1
        await delay(220 * (attempt + 1))
        // Re-read the path against the branch's new head before trying again.
        parentSha = await this.fileSha(owner, repo, path, branch, signal)
      }
    }
    throw lastError ?? new GhError('github-409', `${path} 上传失败：并发冲突。`)
  }

  /** Encode a path for the contents endpoint, keeping separators. */
  /**
   * Create a repository owned by the authenticated user.
   * @returns the created repository summary.
   */
  async createRepo(name, options = {}) {
    const body = {
      name,
      private: options.private === true,
      auto_init: options.autoInit === true,
      description: options.description,
    }
    const data = await this.request('POST', '/user/repos', body)
    return {
      fullName: String(data?.full_name ?? name),
      defaultBranch: String(data?.default_branch ?? (options.autoInit === true ? 'main' : 'main')),
      htmlUrl: String(data?.html_url ?? ''),
    }
  }
}

/** Percent-encode each path segment but keep the separators. */
function encodePath(path) {
  return String(path)
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/** Sleep helper for the retry loop. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
