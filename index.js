/**
 * Host half of the GitHub Publisher.
 *
 * It owns three things:
 *
 * 1. **The credential** — a GitHub Personal Access Token, stored through the
 *    Harness credential file (`$DSH_HOME/.credentials.yaml`) with a
 *    workspace-local fallback and an environment-variable override. The browser
 *    never receives it.
 * 2. **The HTTP surface** — `/api/github-publisher.*` routes the settings page
 *    calls. The publish route streams newline-delimited JSON so the page shows
 *    live progress.
 * 3. **The model-facing tools** — `github_connection`, `github_publish_status`,
 *    and `github_publish`, so "把这部分代码推到我的仓库" works from the chat
 *    without opening settings.
 *
 * @module @local/dsh-github-publisher
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import { Publisher, describeError } from './lib/publisher.js'

/** Route namespaces owned by this plugin; every path is distinct. */
const BASE = '/api/github-publisher'
const ROUTES = {
  status: BASE,
  connect: `${BASE}.connect`,
  disconnect: `${BASE}.disconnect`,
  repos: `${BASE}.repos`,
  preview: `${BASE}.preview`,
  remember: `${BASE}.remember`,
  push: `${BASE}.push`,
}

/** Services this plugin wants, but can live without. */
export const inject = ['tools', 'webServer', 'fs']

/** Default source-directory cap per run. */
const MAX_FILES = 800

/** Resolve `$DSH_HOME` the way the rest of the Harness does. */
function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/**
 * Build a publisher for one request.
 * @param ctx - plugin context (reads the optional `fs` service).
 * @param sourceDir - absolute directory the run reads from.
 */
function makePublisher(ctx, sourceDir) {
  return new Publisher({
    ctx,
    fallbackDir: sourceDir,
    defaultSourceDir: sourceDir,
    apiBase: process.env.DSH_GITHUB_API_BASE,
  })
}

/**
 * The directory a request publishes from.
 *
 * A directory named by the caller wins. Otherwise the Harness Workspace
 * registry answers: the Host process's own working directory is the app's
 * launch root, which is not where the user's code lives, so it is only the
 * last resort.
 *
 * @param ctx - plugin context, for the optional `workspaceRegistry` service.
 * @param requested - caller-supplied directory, if any.
 * @returns the absolute source directory.
 */
async function resolveSourceDir(ctx, requested) {
  if (typeof requested === 'string' && requested.trim().length > 0) return requested.trim()
  try {
    const registry = ctx.get('workspaceRegistry')
    if (registry !== undefined && typeof registry.list === 'function') {
      const workspaces = await registry.list()
      const first = Array.isArray(workspaces) ? workspaces[0] : undefined
      if (first !== undefined && typeof first.path === 'string' && first.path.length > 0) return first.path
    }
  } catch {
    // A registry that cannot answer leaves the process default in place.
  }
  return process.cwd()
}

/**
 * Build a publisher bound to the directory one request should read.
 * @param ctx - plugin context.
 * @param requested - caller-supplied directory, if any.
 */
async function publisherFor(ctx, requested) {
  return makePublisher(ctx, await resolveSourceDir(ctx, requested))
}

/** Read a request body with a hard size cap. */
async function readBody(req, maxBytes = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Parse a JSON body, answering an empty object for an empty body. */
async function readJson(req) {
  const text = await readBody(req)
  if (text.trim().length === 0) return {}
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be a JSON object')
  return parsed
}

/** Write one JSON response. */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

/** The uniform failure envelope. */
function sendError(res, error) {
  const detail = describeError(error)
  sendJson(res, 200, { ok: false, error: detail })
}

/** Guard a route against a foreign or untrusted browser request. */
function rejected(ctx, req, res) {
  const connection = ctx.get('connection')
  if (connection === undefined || typeof connection.requestRejection !== 'function') return false
  const status = connection.requestRejection(req)
  if (status === undefined) return false
  res.statusCode = status
  res.end()
  return true
}

/** Answer a method mismatch the way the shipped routes do. */
function methodNotAllowed(res, allowed) {
  res.statusCode = 405
  res.setHeader('allow', allowed)
  res.end()
}

/** Whether the request carries a JSON body. */
function isJson(req) {
  const header = req.headers['content-type']
  return typeof header === 'string' && header.split(';', 1)[0].trim().toLowerCase() === 'application/json'
}

/**
 * Register the plugin.
 * @param ctx - plugin context.
 * @param config - the patch row's config.
 */
export function apply(ctx, config) {
  const configuredSource = typeof config.sourceDir === 'string' && config.sourceDir.trim().length > 0 ? config.sourceDir.trim() : undefined
  /** The caller's directory for one request: explicit argument, then config. */
  const pickSource = (requested) => {
    if (typeof requested === 'string' && requested.trim().length > 0) return requested
    return configuredSource
  }
  /** Workspaces this Host knows about, for the settings page's directory picker. */
  let workspaces = []
  const refreshWorkspaces = async () => {
    try {
      const registry = ctx.get('workspaceRegistry')
      if (registry === undefined || typeof registry.list !== 'function') return
      const listed = await registry.list()
      if (Array.isArray(listed)) {
        workspaces = listed
          .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.path === 'string')
          .map((entry) => ({ id: String(entry.id ?? entry.path), path: entry.path, title: String(entry.title ?? entry.path) }))
      }
    } catch {
      // Without the registry the page still works with an explicit path.
    }
  }
  void refreshWorkspaces()

  /* ------------------------------------------------------------- routes -- */

  ctx.inject(['webServer'], (webCtx) => {
    /** Register one JSON route on the web carrier. */
    const route = (path, methods, handle) => {
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: 'exact',
            path,
            handler: async (req, res) => {
              if (rejected(ctx, req, res)) return
              const method = String(req.method ?? 'GET').toUpperCase()
              if (!methods.includes(method)) {
                methodNotAllowed(res, methods.join(', '))
                return
              }
              if (method === 'POST' && !isJson(req)) {
                sendJson(res, 415, { ok: false, error: { code: 'unsupported-media-type', message: 'content-type 必须是 application/json' } })
                return
              }
              try {
                await handle(req, res)
              } catch (error) {
                if (!res.writableEnded) sendError(res, error)
              }
            },
          }),
        `github-publisher: ${methods.join('/')} ${path}`,
      )
    }

    /** Read the request body as a JSON object, tolerating an empty body. */
    const body = async (req) => (String(req.method ?? 'GET').toUpperCase() === 'POST' ? readJson(req) : {})

    route(ROUTES.status, ['GET'], async (req, res) => {
      const query = new URL(String(req.url), 'http://localhost').searchParams
      const publisher = await publisherFor(ctx, pickSource(query.get('cwd')))
      await refreshWorkspaces()
      sendJson(res, 200, {
        ok: true,
        value: { ...(await publisher.status()), workspaces, configuredSource: configuredSource ?? null },
      })
    })

    route(ROUTES.connect, ['POST'], async (req, res) => {
      const payload = await body(req)
      const publisher = await publisherFor(ctx, pickSource(payload.cwd))
      sendJson(res, 200, { ok: true, value: await publisher.connect(payload.token) })
    })

    route(ROUTES.disconnect, ['POST'], async (req, res) => {
      const payload = await body(req)
      const publisher = await publisherFor(ctx, pickSource(payload.cwd))
      sendJson(res, 200, { ok: true, value: await publisher.disconnect() })
    })

    route(ROUTES.repos, ['GET'], async (req, res) => {
      const query = new URL(String(req.url), 'http://localhost').searchParams
      const publisher = await publisherFor(ctx, pickSource(query.get('cwd')))
      sendJson(res, 200, { ok: true, value: await publisher.listRepos() })
    })

    route(ROUTES.preview, ['POST'], async (req, res) => {
      const payload = await body(req)
      const publisher = await publisherFor(ctx, pickSource(payload.cwd))
      sendJson(res, 200, { ok: true, value: await publisher.preview(payload) })
    })

    route(ROUTES.remember, ['POST'], async (req, res) => {
      const payload = await body(req)
      const publisher = await publisherFor(ctx, pickSource(payload.cwd))
      sendJson(res, 200, { ok: true, value: await publisher.remember(payload.settings ?? {}) })
    })

    route(ROUTES.push, ['POST'], async (req, res) => {
      const payload = await body(req)
      const publisher = await publisherFor(ctx, pickSource(payload.cwd))
      const controller = new AbortController()
      req.on('aborted', () => controller.abort())
      res.on('close', () => {
        if (!res.writableEnded) controller.abort()
      })
      res.statusCode = 200
      res.setHeader('content-type', 'application/x-ndjson; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.setHeader('x-accel-buffering', 'no')
      const write = (record) => {
        if (res.writableEnded) return
        res.write(`${JSON.stringify(record)}\n`)
      }
      try {
        const report = await publisher.push(payload, {
          signal: controller.signal,
          onProgress: (progress) => write({ type: 'progress', ...progress }),
        })
        write({ type: 'done', report })
      } catch (error) {
        write({ type: 'error', error: describeError(error) })
      } finally {
        res.end()
      }
    })
  })

  /* -------------------------------------------------------------- tools -- */

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(() =>
      toolCtx.tools.register({
        name: 'github_connection',
        description:
          'GitHub 连接状态与可用仓库。未连接时返回配置指引；已连接时返回账号信息和当前 Token 可推送的仓库列表。',
        parameters: {
          type: 'object',
          properties: {
            cwd: { type: 'string', description: '工作目录的绝对路径；省略时使用本次会话的工作区。' },
          },
          additionalProperties: true,
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              connected: { type: 'boolean' },
              login: { type: 'string' },
              tokenSource: { type: 'string' },
              repos: { type: 'array', items: { type: 'object' } },
              guidance: { type: 'string' },
              error: { type: 'string' },
            },
            additionalProperties: true,
          },
          render: (args, value) => [{ type: 'text', text: renderConnection(value) }],
        },
        async execute(args) {
          const publisher = await publisherFor(ctx, pickSource(args?.cwd))
          const status = await publisher.status()
          if (!status.configured || status.account === undefined) {
            return json({
              connected: false,
              tokenSource: status.tokenSource,
              error: status.error?.message,
              guidance: [
                '尚未连接 GitHub。',
                '配置方式（任选其一）：',
                '1. 打开 Harness 设置 → “GitHub 发布器”，粘贴一个勾选了 repo 范围的 Personal Access Token；',
                '2. 设置环境变量 GITHUB_TOKEN（或 GH_TOKEN）后重启 Harness；',
                `3. 手工写入 ${resolveDshHome()}/.credentials.yaml 中的 GITHUB_TOKEN。`,
              ].join('\n'),
            })
          }
          const repos = await publisher.listRepos()
          return json({
            connected: true,
            login: status.account.login,
            tokenSource: status.tokenSource,
            repos: repos.repos.map((repo) => ({ fullName: repo.fullName, defaultBranch: repo.defaultBranch, private: repo.private })),
          })
        },
      }),
    )

    toolCtx.effect(() =>
      toolCtx.tools.register({
        name: 'github_publish_status',
        description:
          '查看将要用 github_publish 上传的内容：源目录、文件数量、总大小，以及被忽略的文件及原因。上传前先用它确认范围。',
        parameters: {
          type: 'object',
          properties: {
            sourcePath: { type: 'string', description: '源目录，默认为当前工作区根目录。' },
            cwd: { type: 'string', description: '工作目录的绝对路径；省略时使用本次会话的工作区。' },
          },
          additionalProperties: true,
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              root: { type: 'string' },
              total: { type: 'number' },
              sizeText: { type: 'string' },
              files: { type: 'array', items: { type: 'object' } },
              skipped: { type: 'array', items: { type: 'object' } },
            },
            additionalProperties: true,
          },
          render: (args, value) => [{ type: 'text', text: renderPreview(value) }],
        },
        async execute(args) {
          const publisher = await publisherFor(ctx, pickSource(args?.cwd))
          return json(await publisher.preview({ sourcePath: args?.sourcePath }))
        },
      }),
    )

    toolCtx.effect(() =>
      toolCtx.tools.register({
        name: 'github_publish',
        description:
          '把当前工作区的代码通过 GitHub REST API 直接上传到指定仓库的分支（新建或更新文件，每个文件一次提交）。需要已连接 GitHub；未连接时先让用户在设置里完成连接。',
        parameters: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: '仓库所有者（用户名或组织名）。' },
            repo: { type: 'string', description: '仓库名。' },
            branch: { type: 'string', description: '目标分支；省略时使用仓库默认分支。' },
            message: { type: 'string', description: '提交信息。' },
            sourcePath: { type: 'string', description: '要上传的本地目录，默认为当前工作区根目录。' },
            targetPrefix: { type: 'string', description: '写入仓库时的子目录前缀，例如 src/demo。' },
            createRepo: { type: 'boolean', description: '仓库不存在时是否自动创建（默认 false）。' },
            private: { type: 'boolean', description: '自动创建仓库时是否设为私有。' },
            cwd: { type: 'string', description: '工作目录的绝对路径；省略时使用本次会话的工作区。' },
          },
          required: ['owner', 'repo'],
          additionalProperties: true,
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              uploaded: { type: 'number' },
              failed: { type: 'number' },
              branch: { type: 'string' },
              repositoryUrl: { type: 'string' },
              commitUrl: { type: 'string' },
              sizeText: { type: 'string' },
              failures: { type: 'array', items: { type: 'object' } },
              skippedTotal: { type: 'number' },
            },
            additionalProperties: true,
          },
          render: (args, value) => [{ type: 'text', text: renderReport(value) }],
        },
        async execute(args, exec) {
          const publisher = await publisherFor(ctx, pickSource(args?.cwd))
          return json(await publisher.push({ ...args, maxFiles: MAX_FILES }, { signal: exec?.signal }))
        },
      }),
    )
  })
}

/**
 * Make a tool result lossless JSON.
 *
 * The tool pipeline validates every returned value as lossless JSON, so one
 * `undefined` field makes the whole call fail with "value is not lossless JSON".
 * Every optional field in these results is therefore dropped rather than left
 * as `undefined`; this also drops `function` and `symbol` values, which JSON
 * cannot carry either.
 *
 * @param value - the raw result.
 * @returns the same shape with non-JSON members removed.
 */
function json(value) {
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') return Number.isFinite(value) ? value : null
  if (type === 'bigint') return Number(value)
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined && typeof entry !== 'function' && typeof entry !== 'symbol').map(json)
  }
  if (type === 'object') {
    const output = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') continue
      output[key] = json(entry)
    }
    return output
  }
  return null
}

/** Plain-text rendering of the connection tool result. */
function renderConnection(value) {
  if (value?.connected !== true) {
    return [value?.guidance ?? '尚未连接 GitHub。', value?.error === undefined ? '' : `\n最近一次错误：${value.error}`]
      .filter((line) => line.length > 0)
      .join('\n')
  }
  const repos = Array.isArray(value.repos) ? value.repos : []
  const listing = repos
    .slice(0, 40)
    .map((repo) => `- ${repo.fullName}（默认分支 ${repo.defaultBranch}${repo.private === true ? '，私有' : ''}）`)
    .join('\n')
  return [
    `已连接 GitHub：${value.login}（凭据来源：${value.tokenSource ?? '未知'}）`,
    `可推送仓库 ${repos.length} 个${repos.length > 40 ? '，下面只列出前 40 个' : ''}：`,
    listing,
  ].join('\n')
}

/** Plain-text rendering of the preview tool result. */
function renderPreview(value) {
  const files = Array.isArray(value?.files) ? value.files : []
  const skipped = Array.isArray(value?.skipped) ? value.skipped : []
  return [
    `源目录：${value?.root ?? '未知'}`,
    `将上传 ${value?.total ?? 0} 个文件，共 ${value?.sizeText ?? '0 B'}。`,
    files
      .slice(0, 60)
      .map((file) => `- ${file.path}（${file.size} B）`)
      .join('\n'),
    value?.filesTruncated === true ? '…（列表已截断，完整清单可在设置页面查看）' : '',
    skipped.length === 0 ? '' : `已跳过 ${value?.skippedTotal ?? skipped.length} 项，例如：`,
    skipped
      .slice(0, 15)
      .map((entry) => `- ${entry.path}：${entry.reason}`)
      .join('\n'),
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

/** Plain-text rendering of a publish report. */
function renderReport(value) {
  if (value?.ok !== true && (value?.uploaded ?? 0) === 0) {
    return `上传失败：\n${(value?.failures ?? []).map((entry) => `- ${entry.path}：${entry.reason}`).join('\n')}`
  }
  return [
    value?.aborted === true ? '上传被中断。' : '上传完成。',
    `仓库：${value?.owner}/${value?.repo}，分支：${value?.branch}`,
    `成功 ${value?.uploaded ?? 0} 个文件（${value?.sizeText ?? '0 B'}），失败 ${value?.failed ?? 0} 个。`,
    Array.isArray(value?.failures) && value.failures.length > 0
      ? `失败明细：\n${value.failures.slice(0, 10).map((entry) => `- ${entry.path}：${entry.reason}`).join('\n')}`
      : '',
    `查看：${value?.repositoryUrl ?? ''}`,
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}
