/**
 * Workspace file collection for one publish run: a bounded recursive walk that
 * honors the repository's `.gitignore`, skips the usual build/VCS directories,
 * separates text from binary, and reports what it left behind and why.
 *
 * The walk reads through the composed filesystem seam (`ctx.fs`), so it sees
 * exactly the files this Harness can see.
 *
 * @module @local/dsh-github-publisher/lib/collector
 */

import { posix } from 'node:path'

/** Directory names never walked, at any depth. */
const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.dsh-github',
  'node_modules',
  'bower_components',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.idea',
  '.vscode-test',
  '.gradle',
  'target',
  'bin',
  'obj',
])

/** File suffixes never published: they are noise or secrets, never source. */
const DEFAULT_IGNORED_FILES = [/\.log$/i, /\.tmp$/i, /^\.DS_Store$/i, /\.pyc$/i, /\.pyo$/i, /\.class$/i]

/** Directory depth cap, a guard against symlink cycles and runaway trees. */
const MAX_DEPTH = 24

/** Entries visited cap, so a mistake cannot turn into an unbounded walk. */
const MAX_ENTRIES = 20000

/**
 * Compile one `.gitignore` line into a matcher.
 * @param line - raw line from the file.
 * @returns a matcher, or `undefined` for blank/comment lines.
 */
export function compileRule(line) {
  const raw = line.replace(/\r$/, '')
  if (raw.trim().length === 0 || raw.trimStart().startsWith('#')) return undefined
  let pattern = raw
  let negate = false
  if (pattern.startsWith('!')) {
    negate = true
    pattern = pattern.slice(1)
  }
  let dirOnly = false
  if (pattern.endsWith('/')) {
    dirOnly = true
    pattern = pattern.slice(0, -1)
  }
  let anchored = false
  if (pattern.startsWith('/')) {
    anchored = true
    pattern = pattern.slice(1)
  } else if (pattern.slice(0, -1).includes('/')) {
    anchored = true
  }
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*')
  const source = anchored ? `^${body}(/.*)?$` : `(^|/)${body}(/.*)?$`
  return { regex: new RegExp(source), negate, dirOnly }
}

/**
 * A `.gitignore`-style rule set rooted at one directory.
 */
export class IgnoreSet {
  /** @param lines - raw pattern lines. */
  constructor(lines = []) {
    this.rules = []
    for (const line of lines) {
      const rule = compileRule(line)
      if (rule !== undefined) this.rules.push(rule)
    }
  }

  /** Load `<dir>/.gitignore` when present. */
  static async load(fs, dirTarget) {
    try {
      const target = await fs.resolve(`${dirTarget.displayPath}/.gitignore`)
      const text = await fs.readText(target)
      return new IgnoreSet(text.split('\n'))
    } catch {
      return new IgnoreSet([])
    }
  }

  /**
   * Whether a workspace-relative path is ignored.
   * @param path - POSIX-relative path.
   * @param isDir - whether the entry is a directory.
   */
  ignores(path, isDir) {
    let ignored = false
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDir) continue
      if (rule.regex.test(path)) ignored = !rule.negate
    }
    return ignored
  }
}

/**
 * Collect the publishable files below one directory.
 *
 * @param fs - the composed filesystem seam.
 * @param rootPath - absolute source directory.
 * @param options - `{ maxFileBytes, extraIgnores, maxFiles }`.
 * @returns files, aggregate statistics, and the skipped entries with reasons.
 */
export async function collectFiles(fs, rootPath, options = {}) {
  const maxFileBytes = options.maxFileBytes ?? 25 * 1024 * 1024
  const maxFiles = options.maxFiles ?? 800
  const root = await fs.resolve(String(rootPath).replace(/\\/g, '/'))
  const rootInfo = await fs.stat(root)
  if (rootInfo === undefined) throw new Error(`源目录不存在：${rootPath}`)
  if (rootInfo.type !== 'directory') throw new Error(`源路径不是目录：${rootPath}`)

  const rootIgnore = await IgnoreSet.load(fs, root)
  const extra = new IgnoreSet(options.extraIgnores ?? [])
  const files = []
  const skipped = []
  let entries = 0

  /** Record one skip, collapsing duplicates by reason. */
  const skip = (path, reason) => {
    if (skipped.length < 200) skipped.push({ path, reason })
  }

  /** Depth-first walk; `rel` is POSIX-relative to the source root. */
  const walk = async (dirTarget, rel, depth, ignoreSet) => {
    if (depth > MAX_DEPTH) {
      skip(rel, '超过最大目录深度')
      return
    }
    let children
    try {
      children = await fs.listDir(dirTarget)
    } catch (error) {
      skip(rel, `无法读取目录：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const local = await IgnoreSet.load(fs, dirTarget)
    for (const child of children) {
      entries += 1
      if (entries > MAX_ENTRIES) {
        skip(rel, '目录条目过多，已停止遍历')
        return
      }
      const childRel = rel.length === 0 ? child.name : `${rel}/${child.name}`
      if (child.type === 'directory') {
        if (DEFAULT_IGNORED_DIRS.has(child.name)) {
          skip(childRel, '默认忽略目录（依赖/构建/元数据）')
          continue
        }
        if (rootIgnore.ignores(childRel, true) || local.ignores(child.name, true) || extra.ignores(childRel, true)) {
          skip(childRel, '.gitignore 或忽略规则')
          continue
        }
        await walk(child.target, childRel, depth + 1, local)
        continue
      }
      if (child.type !== 'file') {
        skip(childRel, '非普通文件（符号链接等）')
        continue
      }
      if (DEFAULT_IGNORED_FILES.some((pattern) => pattern.test(child.name))) {
        skip(childRel, '默认忽略文件类型')
        continue
      }
      if (rootIgnore.ignores(childRel, false) || local.ignores(child.name, false) || extra.ignores(childRel, false)) {
        skip(childRel, '.gitignore 或忽略规则')
        continue
      }
      if (files.length >= maxFiles) {
        skip(childRel, `超过单次上传文件数上限（${maxFiles}）`)
        continue
      }
      const size = typeof child.size === 'number' ? child.size : undefined
      if (size !== undefined && size > maxFileBytes) {
        skip(childRel, `文件过大（${formatBytes(size)}）`)
        continue
      }
      files.push({ path: childRel, size: size ?? 0, target: child.target })
    }
  }

  await walk(root, '', 0, rootIgnore)
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return {
    root: root.displayPath,
    files,
    total: files.length,
    bytes: files.reduce((sum, entry) => sum + entry.size, 0),
    skipped,
    skippedTotal: skipped.length,
  }
}

/**
 * Read one collected file as publishable content.
 *
 * Text is returned as UTF-8 (GitHub stores it verbatim); binary is returned as
 * base64 with the mode flag the caller passes to the contents API.
 *
 * @param fs - the composed filesystem seam.
 * @param entry - one entry from {@link collectFiles}.
 * @param options - `{ maxFileBytes }`.
 * @returns `{ base64, kind, bytes }`.
 */
export async function readForPublish(fs, entry, options = {}) {
  const maxFileBytes = options.maxFileBytes ?? 25 * 1024 * 1024
  const total = entry.size > 0 ? entry.size : maxFileBytes
  const probeLength = Math.min(total, 8192)
  if (probeLength > 0) {
    const probe = await fs.readByteRange(entry.target, { offset: 0, length: probeLength })
    if (probe.includes(0)) {
      const bytes = await fs.readBytes(entry.target, undefined, maxFileBytes)
      return { base64: Buffer.from(bytes).toString('base64'), kind: 'binary', bytes: bytes.length }
    }
  }
  const text = await fs.readText(entry.target)
  const encoded = Buffer.from(text, 'utf8')
  return { base64: encoded.toString('base64'), kind: 'text', bytes: encoded.length }
}

/** Join a source-relative path onto a repository directory prefix. */
export function targetPath(prefix, path) {
  const clean = String(prefix ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
  const rel = String(path).replace(/^\/+/, '')
  return clean.length === 0 ? rel : posix.join(clean, rel)
}

/** Human-readable byte size for the UI and for tool output. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
