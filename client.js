/**
 * Browser half of the GitHub Publisher: one settings page ("GitHub 发布器")
 * inside the Harness settings panel, plus a small status chip below the
 * composer.
 *
 * The page talks to its own Host routes over `/api/github-publisher.*`. React
 * and the Harness Client services arrive as closure symbols; no Client package
 * is imported, and every visual value comes from the host's own tokens —
 * `--dsw-font-*` for typography, `--dsw-alias-*` for surfaces and labels,
 * `--dsw-radius-*` for geometry — so the page follows the active theme, the
 * user's font-size preference, and the platform font stack without a
 * stylesheet of its own.
 *
 * @module @local/dsh-github-publisher/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-github-publisher',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = {
      status: '/api/github-publisher',
      connect: '/api/github-publisher.connect',
      disconnect: '/api/github-publisher.disconnect',
      repos: '/api/github-publisher.repos',
      preview: '/api/github-publisher.preview',
      remember: '/api/github-publisher.remember',
      push: '/api/github-publisher.push',
    }

    const COPY = {
      title: 'GitHub 发布器',
      intro: '把当前工作区里 AI 生成的代码直接发布到 GitHub 仓库。凭据只保存在 Harness 一侧，浏览器不会拿到 Token 内容。',
      sectionNav: 'GitHub 发布器',
      chipConnected: 'GitHub 已连接',
      chipDisconnected: '未连接 GitHub',
      tokenHint:
        '在 GitHub → Settings → Developer settings → Personal access tokens 生成一个勾选 repo 范围的 Token，粘贴到这里。Token 只写入 Harness 的凭据文件，页面不会回显它的内容。',
    }

    /* ------------------------------------------------------------ styles -- */

    const CSS = `
.dsh-ghp-root { display: flex; flex-direction: column; gap: 20px; max-width: 720px; font-family: var(--dsw-font-family); color: var(--dsw-alias-label-primary); }
.dsh-ghp-head { display: flex; flex-direction: column; gap: 6px; }
.dsh-ghp-headline { display: flex; align-items: center; gap: 8px; margin: 0; font: var(--dsw-font-m-18); }
.dsh-ghp-headline svg { flex: none; color: var(--dsw-alias-label-primary); }
.dsh-ghp-intro { margin: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-s-14); }
.dsh-ghp-group { display: flex; flex-direction: column; gap: 10px; }
.dsh-ghp-groupHead { margin: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-strong-12); letter-spacing: .06em; text-transform: uppercase; }
.dsh-ghp-card { display: flex; flex-direction: column; gap: 12px; padding: 12px 14px; border: .5px solid var(--dsw-alias-settings-card-stroke); border-radius: var(--dsw-radius-xl); background: var(--dsw-alias-settings-card-fill); }
.dsh-ghp-cardHead { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dsh-ghp-cardTitle { display: flex; align-items: center; gap: 8px; min-width: 0; font: var(--dsw-font-s-strong-14); }
.dsh-ghp-cardSpacer { flex: 1; }
.dsh-ghp-note { margin: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xs-13); }
.dsh-ghp-banner { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; padding: 8px 10px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); }
.dsh-ghp-bannerOk { border-color: var(--dsw-alias-state-success-primary); }
.dsh-ghp-bannerWarn { border-color: var(--dsw-alias-state-warn-primary); }
.dsh-ghp-bannerBad { border-color: var(--dsw-alias-state-error-primary); }
.dsh-ghp-form { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dsh-ghp-label { color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); }
.dsh-ghp-help { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
.dsh-ghp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(216px, 1fr)); gap: 12px; }
.dsh-ghp-input, .dsh-ghp-select { box-sizing: border-box; width: 100%; min-width: 0; height: 32px; padding: 0 8px; border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: var(--dsw-font-xs-13); font-family: var(--dsw-font-family); }
.dsh-ghp-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.dsh-ghp-input:focus, .dsh-ghp-select:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.dsh-ghp-select { appearance: none; -webkit-appearance: none; padding-right: 26px; cursor: pointer; }
.dsh-ghp-selectWrap { position: relative; display: flex; align-items: center; min-width: 0; }
.dsh-ghp-selectWrap svg { position: absolute; right: 7px; width: 14px; height: 14px; pointer-events: none; color: var(--dsw-alias-label-tertiary); }
.dsh-ghp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-ghp-grow { flex: 1 1 220px; min-width: 0; }
.dsh-ghp-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 36px; padding: 0 14px; border: none; border-radius: var(--dsw-radius-md); cursor: pointer; white-space: nowrap; color: var(--dsw-alias-label-primary); background: transparent; font: var(--dsw-font-s-strong-14); font-family: var(--dsw-font-family); }
.dsh-ghp-btn:disabled { cursor: not-allowed; opacity: .4; }
.dsh-ghp-btnPrimary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.dsh-ghp-btnPrimary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dsh-ghp-btnOutline { border: .5px solid var(--dsw-alias-border-l3); }
.dsh-ghp-btnOutline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-ghp-btnSmall { height: 28px; padding: 0 10px; border-radius: var(--dsw-radius-sm); font: var(--dsw-font-xxs-strong-12); }
.dsh-ghp-check { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); cursor: pointer; }
.dsh-ghp-check input { accent-color: var(--dsw-alias-brand-primary); }
.dsh-ghp-status { display: inline-flex; align-items: center; gap: 6px; min-width: 0; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); }
.dsh-ghp-statusText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-ghp-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.dsh-ghp-dotOn { background: var(--dsw-alias-state-success-primary); }
.dsh-ghp-dotBad { background: var(--dsw-alias-state-error-primary); }
.dsh-ghp-meter { display: flex; flex-direction: column; gap: 6px; }
.dsh-ghp-meterHead { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); }
.dsh-ghp-meterLine { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-ghp-meterCount { flex: none; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.dsh-ghp-bar { display: flex; height: 4px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); overflow: hidden; }
.dsh-ghp-barFill { height: 100%; border-radius: 999px; background: var(--dsw-alias-state-business-primary); transition: width .2s ease; }
.dsh-ghp-list { display: flex; flex-direction: column; max-height: 240px; margin: 0; padding: 0; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); list-style: none; background: var(--dsw-alias-bg-layer-1); overflow-y: auto; }
.dsh-ghp-listRow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 10px; border-bottom: .5px solid var(--dsw-alias-border-l1); }
.dsh-ghp-listRow:last-child { border-bottom: none; }
.dsh-ghp-listPath { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); font-family: var(--ds-font-family-code); font-size: 12px; line-height: 19px; }
.dsh-ghp-listSize { flex: none; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); font-variant-numeric: tabular-nums; }
.dsh-ghp-kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xs-13); }
.dsh-ghp-kvKey { color: var(--dsw-alias-label-tertiary); }
.dsh-ghp-kvValue { min-width: 0; overflow-wrap: anywhere; color: var(--dsw-alias-label-primary); }
.dsh-ghp-link { color: var(--dsw-alias-link); text-decoration: none; overflow-wrap: anywhere; }
.dsh-ghp-link:hover { text-decoration: underline; }
.dsh-ghp-dock { display: inline-flex; align-items: center; gap: 6px; padding: 0 2px; border: none; background: transparent; cursor: pointer; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); font-family: var(--dsw-font-family); }
.dsh-ghp-dock:hover { color: var(--dsw-alias-label-secondary); }
`

    /* --------------------------------------------------------------- api -- */

    /** One JSON request against this plugin's Host routes. */
    async function call(url, options) {
      const init = { method: options?.method ?? 'GET' }
      if (options?.body !== undefined) {
        init.method = 'POST'
        init.headers = { 'content-type': 'application/json' }
        init.body = JSON.stringify(options.body)
      }
      const response = await fetch(url, init)
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status} ${response.statusText}${text.length > 0 ? `：${text}` : ''}`)
      }
      const json = await response.json()
      if (json?.ok !== true) throw new Error(json?.error?.message ?? '请求失败')
      return json.value
    }

    /** Split one NDJSON chunk stream into records. */
    async function* records(body) {
      const reader = body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index = buffer.indexOf('\n')
        while (index >= 0) {
          const line = buffer.slice(0, index).trim()
          buffer = buffer.slice(index + 1)
          if (line.length > 0) yield JSON.parse(line)
          index = buffer.indexOf('\n')
        }
      }
      const tail = buffer.trim()
      if (tail.length > 0) yield JSON.parse(tail)
    }

    /**
     * Publish, reporting progress as it arrives.
     *
     * The Host answers with newline-delimited JSON. A transparent response is
     * read directly; anything else (an environment that buffers the whole body)
     * is still parsed line by line from the consumed text.
     *
     * @param payload - the publish request.
     * @param onProgress - called with each progress record.
     * @returns the final report.
     */
    async function push(payload, onProgress) {
      const response = await fetch(API.push, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
      const stream = response.body?.getReader !== undefined ? response.body : null
      let report
      let failure
      /** Consume text decoded from a buffered body. */
      const consumeText = (text) => {
        for (const line of text.split('\n')) {
          const trimmed = line.trim()
          if (trimmed.length === 0) continue
          const record = JSON.parse(trimmed)
          if (record.type === 'progress') onProgress?.(record)
          else if (record.type === 'done') report = record.report
          else if (record.type === 'error') failure = new Error(record.error?.message ?? '上传失败')
        }
      }
      if (stream === null) {
        consumeText(await response.text())
      } else {
        for await (const record of records(stream)) {
          if (record.type === 'progress') onProgress?.(record)
          else if (record.type === 'done') report = record.report
          else if (record.type === 'error') failure = new Error(record.error?.message ?? '上传失败')
        }
      }
      if (failure !== undefined) throw failure
      if (report === undefined) throw new Error('上传结束但没有收到结果，请刷新设置页重试。')
      return report
    }

    /* ------------------------------------------------------------- store -- */

    /**
     * All page state in one small store, so the settings page and the composer
     * chip read the same connection status.
     */
    function createStore() {
      const listeners = new Set()
      let state = {
        phase: 'loading',
        configured: false,
        tokenSource: undefined,
        tokenHint: undefined,
        account: undefined,
        error: undefined,
        settings: { owner: '', repo: '', branch: '', sourcePath: '.', targetPrefix: '' },
        workspaces: [],
        cwd: '',
        defaultSourceDir: undefined,
        configuredSource: undefined,
        repos: [],
        reposLoaded: false,
        preview: undefined,
        push: undefined,
        report: undefined,
        notice: undefined,
        noticeTone: undefined,
      }
      const emit = () => {
        for (const listener of [...listeners]) listener()
      }
      const set = (patch) => {
        state = { ...state, ...patch }
        emit()
      }
      const scoped = (value) => ({ ...value, cwd: state.cwd })

      const loadStatus = async () => {
        set({ phase: 'loading', error: undefined })
        try {
          const value = await call(`${API.status}?cwd=${encodeURIComponent(state.cwd)}`)
          const workspaces = Array.isArray(value.workspaces) ? value.workspaces : []
          set({
            phase: 'ready',
            configured: value.configured === true,
            tokenSource: value.tokenSource,
            tokenHint: value.tokenHint,
            account: value.account,
            error: value.error?.message,
            settings: value.settings ?? state.settings,
            configuredSource: value.configuredSource,
            workspaces,
            // The first workspace is the most recently used one; the Host uses
            // the same registry entry when no directory is named.
            cwd: state.cwd.length > 0 ? state.cwd : (workspaces[0]?.path ?? ''),
            reposLoaded: false,
            preview: undefined,
          })
        } catch (error) {
          set({ phase: 'error', error: message(error) })
        }
      }

      return {
        getState: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        loadStatus,
        async connect(token) {
          set({ phase: 'busy', error: undefined, notice: undefined, noticeTone: undefined })
          try {
            const value = await call(API.connect, { body: scoped({ token }) })
            // A store that only kept the token in memory reads the same as a
            // durable one from out here, so say plainly which store accepted it.
            const memoryOnly = String(value.stored ?? '').includes('内存')
            set({
              phase: 'ready',
              configured: true,
              account: value.account,
              tokenSource: value.stored,
              notice: memoryOnly
                ? `Token 已生效，但只存在于本次运行的内存中：${value.stored}`
                : `连接成功：${value.account.login} · 凭据已保存到 ${value.stored}`,
              noticeTone: memoryOnly ? 'warn' : 'ok',
            })
            return true
          } catch (error) {
            set({ phase: 'ready', error: message(error) })
            return false
          }
        },
        async disconnect() {
          set({ phase: 'busy', error: undefined })
          try {
            const value = await call(API.disconnect, { body: scoped({}) })
            set({
              phase: 'ready',
              configured: false,
              account: undefined,
              repos: [],
              reposLoaded: false,
              preview: undefined,
              report: undefined,
              notice:
                value.previousSource === undefined
                  ? '已断开当前运行的连接。'
                  : `已断开当前运行的连接（磁盘上的凭据仍在：${value.previousSource}，如需彻底清除请删除对应条目）。`,
              noticeTone: 'ok',
            })
          } catch (error) {
            set({ phase: 'ready', error: message(error) })
          }
        },
        async loadRepos() {
          set({ phase: 'busy', error: undefined })
          try {
            const value = await call(`${API.repos}?cwd=${encodeURIComponent(state.cwd)}`)
            set({ phase: 'ready', repos: value.repos ?? [], reposLoaded: true, account: value.account })
          } catch (error) {
            set({ phase: 'ready', error: message(error) })
          }
        },
        setWorkspace(path) {
          set({ cwd: path, preview: undefined, report: undefined })
        },
        patchSettings(patch) {
          set({ settings: { ...state.settings, ...patch } })
        },
        async remember() {
          try {
            await call(API.remember, { body: scoped({ settings: state.settings }) })
          } catch {
            // Remembering the target is a convenience, never a failure the user must see.
          }
        },
        async preview(sourcePath) {
          set({ phase: 'busy', error: undefined, push: undefined, report: undefined })
          try {
            const value = await call(API.preview, { body: scoped({ sourcePath }) })
            set({ phase: 'ready', preview: value, defaultSourceDir: value.root })
          } catch (error) {
            set({ phase: 'ready', error: message(error), preview: undefined })
          }
        },
        async publish() {
          const settings = state.settings
          set({
            phase: 'pushing',
            error: undefined,
            notice: undefined,
            report: undefined,
            push: { done: 0, total: state.preview?.total ?? 0, message: '正在准备…' },
          })
          try {
            const report = await push(
              scoped({
                owner: settings.owner,
                repo: settings.repo,
                branch: settings.branch,
                sourcePath: settings.sourcePath,
                targetPrefix: settings.targetPrefix,
                createRepo: state.createRepo === true,
                private: state.privateRepo === true,
                message: state.message,
              }),
              (progress) =>
                set({
                  push: {
                    done: typeof progress.done === 'number' ? progress.done : 0,
                    total: typeof progress.total === 'number' ? progress.total : state.preview?.total ?? 0,
                    message: progress.message,
                  },
                }),
            )
            set({ phase: 'ready', push: undefined, report, preview: undefined })
          } catch (error) {
            set({ phase: 'ready', push: undefined, error: message(error) })
          }
        },
        setFlag(key, value) {
          set({ [key]: value })
        },
      }
    }

    /** One-line message from any thrown value. */
    function message(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /** Subscribe to a store for the component's lifetime. */
    function useStore(store) {
      return React.useSyncExternalStore(store.subscribe, store.getState, store.getState)
    }

    /* ---------------------------------------------------------------- art -- */

    /** The GitHub mark, drawn in `currentColor` so it follows the label tokens. */
    function GitHubMark(props) {
      const size = props?.size ?? 18
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true },
        h('path', {
          d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 8 0Z',
        }),
      )
    }

    /** A downward chevron for the styled select wrappers. */
    function Chevron() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M4 6.5 8 10.5 12 6.5',
          stroke: 'currentColor',
          'stroke-width': '1.4',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      )
    }

    /* --------------------------------------------------------------- view -- */

    /** One labelled text input. */
    function Field(props) {
      const id = `dsh-ghp-field-${props.id ?? 'value'}`
      return h(
        'div',
        { className: 'dsh-ghp-form' },
        h('label', { className: 'dsh-ghp-label', htmlFor: id }, props.label),
        h('input', {
          id,
          className: 'dsh-ghp-input',
          type: props.type ?? 'text',
          value: props.value ?? '',
          placeholder: props.placeholder,
          spellCheck: false,
          autoComplete: 'off',
          onChange: (event) => props.onChange(event.target.value),
          onKeyDown:
            props.onEnter === undefined
              ? undefined
              : (event) => {
                  if (event.key === 'Enter') props.onEnter()
                },
        }),
        props.help === undefined ? null : h('span', { className: 'dsh-ghp-help' }, props.help),
      )
    }

    /** One labelled dropdown with the host's field geometry. */
    function Select(props) {
      const id = `dsh-ghp-select-${props.id ?? 'value'}`
      return h(
        'div',
        { className: 'dsh-ghp-form' },
        h('label', { className: 'dsh-ghp-label', htmlFor: id }, props.label),
        h(
          'div',
          { className: 'dsh-ghp-selectWrap' },
          h(
            'select',
            { id, className: 'dsh-ghp-select', value: props.value, onChange: (event) => props.onChange(event.target.value) },
            props.children,
          ),
          h(Chevron, null),
        ),
        props.help === undefined ? null : h('span', { className: 'dsh-ghp-help' }, props.help),
      )
    }

    /** One checkbox row. */
    function Check(props) {
      return h(
        'label',
        { className: 'dsh-ghp-check' },
        h('input', { type: 'checkbox', checked: props.checked === true, onChange: (event) => props.onChange(event.target.checked) }),
        props.label,
      )
    }

    /** One shell-styled button. */
    function Button(props) {
      const variant = props.primary === true ? ' dsh-ghp-btnPrimary' : props.outline === true ? ' dsh-ghp-btnOutline' : ''
      const size = props.small === true ? ' dsh-ghp-btnSmall' : ''
      return h(
        'button',
        { type: 'button', className: `dsh-ghp-btn${variant}${size}`, disabled: props.disabled === true, onClick: props.onClick },
        props.label,
      )
    }

    /** A dot plus text status line. */
    function Status(props) {
      const tone = props.tone === undefined ? '' : ` dsh-ghp-dot${props.tone}`
      return h(
        'span',
        { className: 'dsh-ghp-status' },
        h('span', { className: `dsh-ghp-dot${tone}` }),
        h('span', { className: 'dsh-ghp-statusText' }, props.text),
      )
    }

    /** A titled card: the page's one content container. */
    function Card(props) {
      return h(
        'section',
        { className: 'dsh-ghp-card' },
        h(
          'header',
          { className: 'dsh-ghp-cardHead' },
          h('span', { className: 'dsh-ghp-cardTitle' }, props.title),
          h('span', { className: 'dsh-ghp-cardSpacer' }),
          props.actions ?? null,
        ),
        props.children,
      )
    }

    /** A message strip: informational, success, warning, or error. */
    function Banner(props) {
      const tone = { ok: ' dsh-ghp-bannerOk', warn: ' dsh-ghp-bannerWarn', bad: ' dsh-ghp-bannerBad' }[props.tone] ?? ''
      return h('p', { className: `dsh-ghp-banner${tone}` }, props.text)
    }

    /** A label/value grid for facts about the connection and the last run. */
    function KeyValues(props) {
      return h('div', { className: 'dsh-ghp-kv' }, props.rows)
    }

    /** One key/value pair inside {@link KeyValues}. */
    function KV(props) {
      return [h('span', { className: 'dsh-ghp-kvKey', key: 'k' }, props.label), h('span', { className: 'dsh-ghp-kvValue', key: 'v' }, props.children)]
    }

    /** The connection card: status, token entry, disconnect. */
    function ConnectionCard(props) {
      const { state, store } = props
      const [token, setToken] = React.useState('')
      const connected = state.configured === true && state.account !== undefined
      const connect = async () => {
        if (await store.connect(token)) setToken('')
      }
      const tone = connected ? 'On' : state.error !== undefined ? 'Bad' : undefined
      const statusText = connected
        ? `${state.account.login}${state.account.name === undefined ? '' : ` · ${state.account.name}`}`
        : '尚未连接'
      return h(
        Card,
        { title: '连接 GitHub', actions: h(Status, { tone, text: statusText }) },
        connected
          ? h(
              KeyValues,
              null,
              h(KV, { label: '凭据来源' }, state.tokenSource ?? '未知'),
              state.tokenHint === undefined ? null : h(KV, { label: 'Token' }, state.tokenHint),
            )
          : h('p', { className: 'dsh-ghp-note' }, COPY.tokenHint),
        h(
          'div',
          { className: 'dsh-ghp-row' },
          h(
            'div',
            { className: 'dsh-ghp-grow' },
            h('input', {
              className: 'dsh-ghp-input',
              type: 'password',
              value: token,
              placeholder: connected ? '填入新 Token 可覆盖当前凭据' : 'ghp_… 或 github_pat_…',
              spellCheck: false,
              autoComplete: 'off',
              'aria-label': 'GitHub Personal Access Token',
              onChange: (event) => setToken(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && token.trim().length > 0) connect()
              },
            }),
          ),
          h(Button, { label: connected ? '更新 Token' : '连接', primary: true, disabled: state.phase === 'busy' || token.trim().length === 0, onClick: connect }),
          connected ? h(Button, { label: '断开', outline: true, disabled: state.phase === 'busy', onClick: () => store.disconnect() }) : null,
        ),
      )
    }

    /** The target card: repository, branch, source directory, options. */
    function TargetCard(props) {
      const { state, store } = props
      const settings = state.settings
      const repos = state.repos ?? []
      const workspaces = state.workspaces ?? []
      const selectedRepo = settings.owner.length > 0 && settings.repo.length > 0 ? `${settings.owner}/${settings.repo}` : ''
      return h(
        Card,
        {
          title: '选择仓库与目录',
          actions: h(Button, {
            label: state.reposLoaded ? '刷新仓库列表' : '读取我的仓库',
            outline: true,
            small: true,
            disabled: state.phase === 'busy' || state.configured !== true,
            onClick: () => store.loadRepos(),
          }),
        },
        repos.length > 0
          ? h(
              Select,
              {
                label: `可推送仓库（${repos.length}）`,
                id: 'repo',
                value: selectedRepo,
                onChange: (value) => {
                  const found = repos.find((entry) => entry.fullName === value)
                  if (found === undefined) return
                  store.patchSettings({ owner: found.owner, repo: found.name, branch: found.defaultBranch })
                },
              },
              h('option', { value: selectedRepo }, selectedRepo.length > 0 ? selectedRepo : '选择仓库…'),
              repos.map((repo) => h('option', { key: repo.fullName, value: repo.fullName }, `${repo.fullName}${repo.private ? '（私有）' : ''}`)),
            )
          : null,
        h(
          Select,
          {
            label: '从哪里读取代码（Harness 工作区）',
            id: 'workspace',
            value: state.cwd ?? '',
            onChange: (value) => store.setWorkspace(value),
            help:
              state.configuredSource === null || state.configuredSource === undefined
                ? undefined
                : `插件配置固定了源目录：${state.configuredSource}`,
          },
          workspaces.length > 0
            ? workspaces.map((workspace) =>
                h('option', { key: workspace.path, value: workspace.path }, `${workspace.title ?? workspace.path} — ${workspace.path}`),
              )
            : h('option', { value: state.cwd ?? '' }, state.cwd ?? '（未找到工作区，请在下方填写绝对路径）'),
        ),
        h(
          'div',
          { className: 'dsh-ghp-grid' },
          h(Field, {
            label: '仓库所有者',
            id: 'owner',
            value: settings.owner,
            placeholder: 'octocat',
            onChange: (value) => store.patchSettings({ owner: value.trim() }),
          }),
          h(Field, {
            label: '仓库名',
            id: 'reponame',
            value: settings.repo,
            placeholder: 'my-project',
            onChange: (value) => store.patchSettings({ repo: value.trim() }),
          }),
          h(Field, {
            label: '分支',
            id: 'branch',
            value: settings.branch,
            placeholder: '留空用仓库默认分支',
            onChange: (value) => store.patchSettings({ branch: value.trim() }),
          }),
          h(Field, {
            label: '写入仓库的子目录',
            id: 'prefix',
            value: settings.targetPrefix,
            placeholder: '留空 = 仓库根目录',
            onChange: (value) => store.patchSettings({ targetPrefix: value.trim() }),
          }),
          h(Field, {
            label: '工作区内的子目录',
            id: 'source',
            value: settings.sourcePath === '.' ? '' : settings.sourcePath,
            placeholder: '留空 = 整个工作区',
            onChange: (value) => store.patchSettings({ sourcePath: value.trim().length === 0 ? '.' : value.trim() }),
          }),
          h(Field, {
            label: '提交信息',
            id: 'message',
            value: state.message ?? '',
            placeholder: 'chore: publish from DeepSeek Harness',
            onChange: (value) => store.setFlag('message', value),
          }),
        ),
        h(
          'div',
          { className: 'dsh-ghp-row' },
          h(Check, { label: '仓库不存在时自动创建', checked: state.createRepo === true, onChange: (value) => store.setFlag('createRepo', value) }),
          state.createRepo === true
            ? h(Check, { label: '创建为私有仓库', checked: state.privateRepo === true, onChange: (value) => store.setFlag('privateRepo', value) })
            : null,
        ),
      )
    }

    /** The upload card: preview, publish, live progress, result. */
    function PublishCard(props) {
      const { state, store } = props
      const preview = state.preview
      const push = state.push
      const pushing = state.phase === 'pushing'
      const target =
        state.settings.owner.length > 0 && state.settings.repo.length > 0 ? `${state.settings.owner}/${state.settings.repo}` : '未选择仓库'
      const ready = state.configured === true && preview !== undefined && state.settings.owner.length > 0 && state.settings.repo.length > 0
      const percent = push !== undefined && push.total > 0 ? Math.min(100, Math.round((push.done / push.total) * 100)) : 0
      return h(
        Card,
        {
          title: '预览并发布',
          actions: h(
            'div',
            { className: 'dsh-ghp-row' },
            h(Button, {
              label: '预览将上传的文件',
              outline: true,
              small: true,
              disabled: state.phase === 'busy' || pushing,
              onClick: () => store.preview(state.settings.sourcePath),
            }),
            h(Button, {
              label: pushing ? '发布中…' : '发布到 GitHub',
              small: true,
              primary: true,
              disabled: !ready || pushing,
              onClick: () => {
                store.remember()
                void store.publish()
              },
            }),
          ),
        },
        h(
          KeyValues,
          null,
          h(KV, { label: '目标' }, `${target} · ${state.settings.branch.length > 0 ? state.settings.branch : '默认分支'}`),
          h(KV, { label: '源目录' }, preview?.root ?? state.defaultSourceDir ?? state.cwd ?? '（未确定）'),
        ),
        preview === undefined
          ? h(
              'p',
              { className: 'dsh-ghp-note' },
              '先预览一次，确认文件范围；确认后「发布到 GitHub」才可用。默认忽略 node_modules、.git、构建产物与 .env 等凭据文件。',
            )
          : h(
              'p',
              { className: 'dsh-ghp-note' },
              `${preview.total} 个文件，共 ${preview.sizeText}${preview.skippedTotal > 0 ? `；已跳过 ${preview.skippedTotal} 项` : ''}。发布时每个文件一次提交。`,
            ),
        preview !== undefined && preview.files.length > 0
          ? h(
              'ul',
              { className: 'dsh-ghp-list' },
              preview.files
                .slice(0, 100)
                .map((file) =>
                  h(
                    'li',
                    { className: 'dsh-ghp-listRow', key: file.path },
                    h('span', { className: 'dsh-ghp-listPath' }, file.path),
                    h('span', { className: 'dsh-ghp-listSize' }, `${file.size} B`),
                  ),
                ),
            )
          : null,
        push !== undefined
          ? h(
              'div',
              { className: 'dsh-ghp-meter' },
              h(
                'div',
                { className: 'dsh-ghp-meterHead' },
                h('span', { className: 'dsh-ghp-meterLine' }, push.message ?? '发布中…'),
                h('span', { className: 'dsh-ghp-meterCount' }, push.total > 0 ? `${push.done}/${push.total}` : ''),
              ),
              h('div', { className: 'dsh-ghp-bar' }, h('div', { className: 'dsh-ghp-barFill', style: { width: `${percent}%` } })),
            )
          : null,
        state.report !== undefined ? h(Report, { report: state.report }) : null,
      )
    }

    /** The result of the last publish run. */
    function Report(props) {
      const report = props.report
      const failures = report.failures ?? []
      const head = `${report.aborted === true ? '发布被中断' : '发布完成'}：成功 ${report.uploaded} 个文件（${report.sizeText}），失败 ${report.failed} 个。`
      return h(
        'div',
        { className: 'dsh-ghp-form', style: { gap: '10px' } },
        h(Banner, { tone: failures.length > 0 ? 'warn' : 'ok', text: head }),
        h(
          KeyValues,
          null,
          h(KV, { label: '仓库' }, `${report.owner}/${report.repo} · ${report.branch}${report.targetPrefix.length > 0 ? ` · ${report.targetPrefix}` : ''}`),
          h(
            KV,
            { label: '地址' },
            h('a', { className: 'dsh-ghp-link', href: report.repositoryUrl, target: '_blank', rel: 'noreferrer' }, report.repositoryUrl),
          ),
          report.skippedTotal > 0 ? h(KV, { label: '跳过' }, `${report.skippedTotal} 项（依赖目录、构建产物、凭据文件或超限文件）`) : null,
        ),
        failures.length === 0
          ? null
          : h(
              'ul',
              { className: 'dsh-ghp-list' },
              failures
                .slice(0, 40)
                .map((entry) =>
                  h(
                    'li',
                    { className: 'dsh-ghp-listRow', key: entry.path },
                    h('span', { className: 'dsh-ghp-listPath' }, entry.path),
                    h('span', { className: 'dsh-ghp-listSize' }, entry.reason),
                  ),
                ),
            ),
      )
    }

    /** The whole settings page. */
    function GitHubPublisherSection() {
      const store = React.useMemo(() => createStore(), [])
      const state = useStore(store)
      React.useEffect(() => {
        void store.loadStatus()
      }, [store])
      return h(
        'div',
        { className: 'dsh-ghp-root' },
        h(
          'header',
          { className: 'dsh-ghp-head' },
          h('h2', { className: 'dsh-ghp-headline' }, h(GitHubMark, { size: 20 }), COPY.title),
          h('p', { className: 'dsh-ghp-intro' }, COPY.intro),
        ),
        h(
          'div',
          { className: 'dsh-ghp-group' },
          h('h3', { className: 'dsh-ghp-groupHead' }, '连接'),
          state.notice !== undefined ? h(Banner, { tone: state.noticeTone ?? 'ok', text: state.notice }) : null,
          state.error !== undefined ? h(Banner, { tone: 'bad', text: `错误：${state.error}` }) : null,
          state.phase === 'loading' ? h(Banner, { text: '正在读取连接状态…' }) : null,
          h(ConnectionCard, { state, store }),
        ),
        h(
          'div',
          { className: 'dsh-ghp-group' },
          h('h3', { className: 'dsh-ghp-groupHead' }, '目标'),
          h(TargetCard, { state, store }),
        ),
        h(
          'div',
          { className: 'dsh-ghp-group' },
          h('h3', { className: 'dsh-ghp-groupHead' }, '发布'),
          h(PublishCard, { state, store }),
        ),
        state.phase === 'busy' ? h('p', { className: 'dsh-ghp-help' }, '正在与 GitHub 通信…') : null,
      )
    }

    /**
     * Open the shell's settings panel on this plugin's page.
     *
     * The panel id is the shell's, not ours, so the whole attempt is optional:
     * a shell whose selection API differs leaves the chip a status read.
     *
     * @param ctx - the browser-half Cordis context.
     */
    function openSettingsPanel(ctx) {
      try {
        const layout = typeof ctx?.get === 'function' ? ctx.get('layout') : undefined
        if (layout !== undefined && typeof layout.selectPanel === 'function') layout.selectPanel('settings')
      } catch {
        // No panel navigation available; the chip stays informational.
      }
    }

    /** A quiet status chip below the composer; clicking it opens the settings page. */
    function ComposerChip(props) {
      const store = React.useMemo(() => createStore(), [])
      const state = useStore(store)
      React.useEffect(() => {
        void store.loadStatus()
      }, [store])
      const connected = state.configured === true && state.account !== undefined
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-ghp-dock',
          onClick: () => props?.openSettings?.(),
          title: '打开 设置 → GitHub 发布器',
        },
        h('span', { className: `dsh-ghp-dot${connected ? ' dsh-ghp-dotOn' : ''}` }),
        connected ? `${COPY.chipConnected}：${state.account.login}` : COPY.chipDisconnected,
      )
    }

    /* ------------------------------------------------------------ plugin -- */

    /**
     * Run one setup step without ever letting it fail this package's activation.
     *
     * A browser-half plugin that throws while applying is reported as an entry
     * that "did not activate", and the Desktop shell answers that with its
     * plugin-recovery screen and a safe-mode relaunch that blocks every
     * third-party bundle. A registry call that a newer or older shell rejects is
     * therefore logged and skipped: the rest of the page still works.
     *
     * @param label - step name for the log line.
     * @param operation - the setup work.
     */
    function guarded(label, operation) {
      try {
        return operation()
      } catch (error) {
        try {
          console.error(`[github-publisher] ${label} 失败：`, error)
        } catch {
          // A console that itself refuses must not escalate either.
        }
        return undefined
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        guarded('样式注入', () => {
          if (ctx.styles !== undefined && typeof ctx.styles.insert === 'function') {
            ctx.effect(() => ctx.styles.insert(CSS), 'github-publisher: styles')
          }
        })

        guarded('设置页注册', () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'github-publisher',
                order: 45,
                label: COPY.sectionNav,
              },
              GitHubPublisherSection,
            ),
          ),
        )

        guarded('输入框状态注册', () =>
          ctx.slots.inject('conversation.composer.dock', () =>
            ctx.slots.register({ name: 'conversation.composer.dock', id: 'github-publisher-status', order: 30 }, (props) =>
              h(ComposerChip, { ...props, openSettings: () => openSettingsPanel(ctx) }),
            ),
          ),
        )
      },
    }
  },
})
