/**
 * Publish orchestration: one request from the UI or a tool becomes a bounded,
 * cancellable upload of a workspace subtree into a GitHub repository.
 *
 * @module @local/dsh-github-publisher/lib/publisher
 */

import { collectFiles, formatBytes, readForPublish, targetPath } from './collector.js'
import { GhError, GitHub, TokenStore } from './github.js'
import { loadSettings, saveSettings } from './settings.js'

/** Files never published, whatever the source directory contains. */
export const SECRET_IGNORES = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '.npmrc',
  '.netrc',
  'id_rsa',
  'id_ed25519',
  '.dsh-github/',
  '.credentials.yaml',
  'credentials.json',
]

/**
 * Absolute-path shapes: a POSIX root, a Windows drive, or a UNC share.
 * Anything else is a path inside the bound workspace.
 */
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/

/**
 * The publisher binds the pieces the route and the tools share: token
 * resolution, settings, file collection, and the upload loop.
 */
export class Publisher {
  /**
   * @param options - `{ ctx, fallbackDir, defaultSourceDir, apiBase }`.
   */
  constructor(options) {
    this.ctx = options.ctx
    this.fallbackDir = options.fallbackDir
    this.defaultSourceDir = options.defaultSourceDir
    this.tokens = new TokenStore(this.ctx, options.fallbackDir)
    this.apiBase = options.apiBase
  }

  /** The composed filesystem seam, or a typed failure. */
  fs() {
    const service = this.ctx.get('fs')
    if (service === undefined) {
      throw new GhError('fs-unavailable', '当前 profile 没有组合文件系统服务（fs），无法读取工作区文件。')
    }
    return service
  }

  /** Resolve a usable client, or a failure the UI can act on. */
  async client() {
    const found = await this.tokens.resolve()
    if (found === undefined) {
      throw new GhError('not-connected', '还没有连接 GitHub：请先填入 Personal Access Token。')
    }
    return new GitHub(found.token, this.apiBase === undefined ? {} : { apiBase: this.apiBase })
  }

  /** Connection + configured target, without exposing the token. */
  async status() {
    const describe = await this.tokens.describe()
    const settings = await loadSettings(this.fallbackDir)
    const result = {
      configured: describe.configured,
      tokenSource: describe.source,
      tokenHint: describe.hint,
      settings,
      defaultSourceDir: this.defaultSourceDir,
      account: undefined,
      error: undefined,
    }
    if (!describe.configured) return result
    try {
      const client = await this.client()
      result.account = await client.viewer()
    } catch (error) {
      result.error = describeError(error)
    }
    return result
  }

  /**
   * Store and verify a token.
   * @param token - the PAT the user pasted.
   */
  async connect(token) {
    const value = String(token ?? '').trim()
    if (value.length === 0) throw new GhError('token-empty', '请先填入 Personal Access Token。')
    const client = new GitHub(value, this.apiBase === undefined ? {} : { apiBase: this.apiBase })
    const account = await client.viewer()
    const stored = await this.tokens.save(value)
    return { account, stored }
  }

  /** Forget the in-memory token. Stored copies are reported, not deleted. */
  async disconnect() {
    const describe = await this.tokens.describe()
    this.tokens.clearCache()
    return { previousSource: describe.source }
  }

  /** Repositories the token can push to. */
  async listRepos() {
    const client = await this.client()
    return { repos: await client.listRepos(), account: await client.viewer() }
  }

  /** Persist the last-used target. */
  async remember(patch) {
    const saved = await saveSettings(this.fallbackDir, patch)
    return { saved, settings: await loadSettings(this.fallbackDir) }
  }

  /**
   * Resolve the source directory for one request.
   *
   * An absolute path stands alone; a relative one is a subdirectory of the
   * workspace this publisher is bound to, so a page that says "packages/app"
   * means `<workspace>/packages/app`.
   */
  resolveSource(sourcePath) {
    const raw = typeof sourcePath === 'string' && sourcePath.trim().length > 0 ? sourcePath.trim() : '.'
    if (raw === '.' || raw === './') return this.defaultSourceDir
    const normalized = raw.replace(/\\/g, '/').replace(/\/+$/, '')
    if (ABSOLUTE_PATH.test(normalized)) return raw
    return `${String(this.defaultSourceDir).replace(/\\/g, '/').replace(/\/+$/, '')}/${normalized.replace(/^\/+/, '')}`
  }

  /**
   * Collect the files one publish run would send.
   * @param request - `{ sourcePath, maxFiles }`.
   */
  async preview(request = {}) {
    const fs = this.fs()
    const source = this.resolveSource(request.sourcePath)
    const collected = await collectFiles(fs, source, {
      extraIgnores: SECRET_IGNORES,
      maxFiles: typeof request.maxFiles === 'number' ? request.maxFiles : 800,
    })
    return {
      root: collected.root,
      total: collected.total,
      bytes: collected.bytes,
      sizeText: formatBytes(collected.bytes),
      files: collected.files.slice(0, 300).map((entry) => ({ path: entry.path, size: entry.size })),
      filesTruncated: collected.total > 300,
      skipped: collected.skipped.slice(0, 60),
      skippedTotal: collected.skippedTotal,
    }
  }

  /**
   * Upload the collected files to a branch.
   *
   * @param request - the full publish request.
   * @param options - `{ signal, onProgress }`.
   * @returns the run report: what went up, what did not, and where to look.
   */
  async push(request, options = {}) {
    const owner = requireSegment(request.owner, 'owner')
    const repo = requireSegment(request.repo, 'repo')
    const client = await this.client()
    const source = this.resolveSource(request.sourcePath)
    const fs = this.fs()
    const signal = options.signal
    const notify = typeof options.onProgress === 'function' ? options.onProgress : () => {}
    const prefix = typeof request.targetPrefix === 'string' ? request.targetPrefix : ''

    notify({ phase: 'collect', message: '正在扫描工作区文件…' })
    const collected = await collectFiles(fs, source, {
      extraIgnores: SECRET_IGNORES,
      maxFiles: typeof request.maxFiles === 'number' ? request.maxFiles : 800,
    })
    if (collected.total === 0) {
      throw new GhError('nothing-to-push', `目录 ${collected.root} 下没有可发布的文件。`)
    }

    let branch = typeof request.branch === 'string' && request.branch.trim().length > 0 ? request.branch.trim() : ''
    const repository = await client.getRepo(owner, repo)
    if (repository === undefined) {
      if (request.createRepo === true) {
        notify({ phase: 'repo', message: `仓库 ${owner}/${repo} 不存在，正在创建…` })
        const created = await client.createRepo(repo, { private: request.private === true, autoInit: true })
        notify({ phase: 'repo', message: `已创建仓库 ${created.fullName}` })
      } else {
        throw new GhError('repo-missing', `仓库 ${owner}/${repo} 不存在，或当前 Token 无权访问。勾选“仓库不存在时自动创建”可以直接新建。`)
      }
    } else if (request.createRepo === true && repository.size === 0) {
      // An auto-init repository that was created without an initial commit.
      notify({ phase: 'repo', message: '仓库为空，正在初始化首个提交…' })
      await client.request('PUT', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/README.md`, {
        message: 'chore: initialize repository',
        content: Buffer.from(`# ${repo}\n`, 'utf8').toString('base64'),
      })
    }

    if (branch.length === 0) {
      const fresh = repository ?? (await client.getRepo(owner, repo))
      branch = fresh?.defaultBranch ?? 'main'
    }

    let branchExists = await client.refExists(owner, repo, branch)
    if (!branchExists) {
      // GitHub can hold a repository with no commits at all: create the branch
      // from an initialized commit so the contents API has a parent ref.
      notify({ phase: 'branch', message: `分支 ${branch} 不存在，正在创建…` })
      const defaultBranch = (await client.getRepo(owner, repo))?.defaultBranch
      if (defaultBranch !== undefined && defaultBranch !== branch) {
        const head = await client.branchHead(owner, repo, defaultBranch)
        if (head !== undefined) {
          await client.request('POST', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`, {
            ref: `refs/heads/${branch}`,
            sha: head,
          })
          branchExists = true
        }
      }
      if (!branchExists) {
        try {
          await client.request('PUT', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/README.md`, {
            message: typeof request.message === 'string' && request.message.length > 0 ? request.message : 'chore: initial commit',
            content: Buffer.from(`# ${repo}\n`, 'utf8').toString('base64'),
            branch,
          })
          branchExists = true
        } catch (error) {
          throw new GhError(
            'branch-missing',
            `无法在 ${owner}/${repo} 上创建分支 ${branch}：${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }

    const message =
      typeof request.message === 'string' && request.message.trim().length > 0
        ? request.message.trim()
        : `chore: publish ${collected.total} file(s) from DeepSeek Harness`

    const uploaded = []
    const failed = []
    let bytes = 0
    let index = 0
    // Every write to one branch commits a new parent, so parallel writers race
    // by construction; `putFile` resolves the race, and a low default keeps the
    // number of retries small.
    const concurrency = Math.min(Math.max(Number(request.concurrency) || 2, 1), 8)

    const worker = async () => {
      for (;;) {
        if (signal?.aborted === true) return
        const current = index
        index += 1
        if (current >= collected.files.length) return
        const entry = collected.files[current]
        const repoPath = targetPath(prefix, entry.path)
        try {
          const content = await readForPublish(fs, entry)
          const sha = await client.fileSha(owner, repo, repoPath, branch, signal)
          const result = await client.putFile(owner, repo, repoPath, branch, content.base64, message, sha, { signal })
          bytes += content.bytes
          uploaded.push({ path: repoPath, bytes: content.bytes, kind: content.kind, commitUrl: result.commitUrl })
          notify({
            phase: 'upload',
            done: uploaded.length,
            total: collected.total,
            path: repoPath,
            message: `已上传 ${uploaded.length}/${collected.total}：${repoPath}`,
          })
        } catch (error) {
          const detail = describeError(error)
          failed.push({ path: repoPath, reason: detail.message })
          notify({ phase: 'upload', done: uploaded.length, total: collected.total, path: repoPath, message: `失败：${repoPath}（${detail.message}）` })
        }
      }
    }

    notify({ phase: 'upload', done: 0, total: collected.total, message: `开始上传 ${collected.total} 个文件到 ${owner}/${repo}@${branch}…` })
    await Promise.all(Array.from({ length: concurrency }, worker))

    const commitUrl =
      uploaded.find((entry) => typeof entry.commitUrl === 'string' && entry.commitUrl.length > 0)?.commitUrl ??
      `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(branch)}`

    const report = {
      ok: failed.length === 0,
      owner,
      repo,
      branch,
      source: collected.root,
      targetPrefix: prefix,
      message,
      uploaded: uploaded.length,
      failed: failed.length,
      bytes,
      sizeText: formatBytes(bytes),
      files: uploaded.slice(0, 300).map((entry) => ({ path: entry.path, bytes: entry.bytes, kind: entry.kind })),
      failures: failed.slice(0, 60),
      skipped: collected.skipped.slice(0, 60),
      skippedTotal: collected.skippedTotal,
      commitUrl,
      repositoryUrl: `https://github.com/${owner}/${repo}`,
      aborted: signal?.aborted === true,
    }
    await saveSettings(this.fallbackDir, { owner, repo, branch, sourcePath: request.sourcePath ?? '.', targetPrefix: prefix })
    return report
  }
}

/** Reject an empty or malformed owner/repository segment. */
function requireSegment(value, label) {
  const text = String(value ?? '').trim()
  if (text.length === 0) throw new GhError('bad-request', `缺少 ${label}。`)
  if (!/^[A-Za-z0-9._-]+$/.test(text)) throw new GhError('bad-request', `${label} 含有非法字符：${text}`)
  return text
}

/**
 * Normalize any thrown value into `{ code, message }` for JSON transport.
 * @param error - the thrown value.
 */
export function describeError(error) {
  if (error instanceof GhError) return { code: error.code, message: error.message, status: error.status }
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof Error && error.name !== 'Error' ? error.name : 'error'
  return { code, message }
}
