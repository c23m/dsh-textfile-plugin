/**
 * Browser half of the text-file editor bundle.
 *
 * One entry point only: the 编辑 button this half adds to the shipped document
 * preview's toolbar (`sidebar.right.tab.document.actions`). It hands the previewed
 * file's Host path to the editor tab, whose body reads it through the
 * `workspaceFiles` Remote and edits it in a textarea. Saving is the only
 * mutation: the Host half registers the `textfile-save` command and this half
 * invokes it through the `commands` Remote.
 *
 * Rendering: the editor draws its text in a decoration layer that mirrors the
 * textarea exactly (same font, padding, wrapping and scroll offset) while the
 * textarea itself keeps the real text with a transparent color. That layer is
 * where the predefined render defaults live — mono font, faint dots for spaces,
 * faint arrows for tabs, and a line-number gutter — none of which touch the
 * file's bytes. Editing, selection, IME and the browser's own undo stay native.
 */

window.__ModuleLoader__.load({
  id: 'dsh-textfile-editor',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const ID = 'dsh-textfile-editor'
    const KIND = 'textfile'
    const SAVE_COMMAND = 'textfile-save'
    const BODY_SLOT = 'sidebar.right.pane.tab'
    const TITLE_SLOT = 'sidebar.right.pane.tab.title'
    const DOCUMENT_ACTIONS_SLOT = 'sidebar.right.tab.document.actions'
    const EDIT_ACTION_ID = 'textfile-edit'
    const TAB_TITLE = '文本文件'

    /**
     * Fixed rendering limits. The user-tunable display options live in
     * `DEFAULT_SETTINGS` and are editable from the editor's settings popover.
     */
    const RENDER = {
      /** Reserve at least this many digits so the gutter does not jump for short files. */
      minGutterDigits: 4,
      /** A window at most this share of the screen width keeps the exact digit count. */
      narrowWindowRatio: 0.5,
      /** Below this editor width the gutter also keeps the exact digit count. */
      roomyEditorPx: 360,
      /** Blank space kept below the last line when scrolled to the end, as a share of the viewport. */
      tailSpaceRatio: 0.33,
      /** Delay before a hovered settings popover closes, in milliseconds. */
      settingsCloseDelayMs: 250,
      maxDecoratedLines: 4000,
      maxDecoratedChars: 300000,
    }

    const SETTINGS_KEY = 'dsh.textfile.settings.v1'
    const DEFAULT_SETTINGS = {
      /** `'tab'` inserts one tab; `'spaces'` inserts `tabSize` spaces. */
      indent: 'spaces',
      /** Display width of a literal tab, and the number of spaces Tab inserts. */
      tabSize: 2,
      /** Soft wrap on by default; a per-tab toggle is not kept. */
      wrap: true,
      whitespace: true,
      lineNumbers: true,
    }

    function readSettings() {
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY)
        const parsed = raw === null ? {} : JSON.parse(raw)
        const settings = { ...DEFAULT_SETTINGS }
        if (parsed?.indent === 'tab' || parsed?.indent === 'spaces') settings.indent = parsed.indent
        if (Number.isInteger(parsed?.tabSize) && parsed.tabSize > 0) settings.tabSize = parsed.tabSize
        for (const key of ['wrap', 'whitespace', 'lineNumbers']) {
          if (typeof parsed?.[key] === 'boolean') settings[key] = parsed[key]
        }
        return settings
      } catch {
        return { ...DEFAULT_SETTINGS }
      }
    }

    function writeSettings(settings) {
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
      } catch {
        // A read-only browser profile keeps the edited values for this page only.
      }
    }

    /** Extensions the editor claims; everything else is left to the preview. */
    const TEXT_EXTENSIONS = new Set([
      'txt', 'text', 'md', 'markdown', 'mdx', 'log', 'json', 'jsonc', 'json5',
      'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'properties', 'env', 'csv',
      'tsv', 'xml', 'html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs',
      'ts', 'mts', 'cts', 'jsx', 'tsx', 'vue', 'svelte', 'py', 'rb', 'go', 'rs',
      'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php', 'sh', 'bash',
      'zsh', 'ps1', 'bat', 'cmd', 'sql', 'graphql', 'gql', 'tex', 'rst', 'adoc',
      'srt', 'vtt', 'diff', 'patch', 'gitignore', 'editorconfig',
    ])

    /** Services this half needs; activation waits for all of them. */
    const inject = [
      'slots',
      'sidebarRightTabs',
      'sidebarRight',
      'remote',
      'remote.workspaceFiles',
      'remote.commands',
    ]

    /** Filled by `apply`; the components render with the services the half injected. */
    const api = { remote: undefined, sidebarRight: undefined }

    /**
     * Same-plugin shared state.
     *
     * `pending` is a one-shot request from the preview toolbar to the editor tab;
     * `lastPath` is the file the tab currently shows, which the tab chip reads.
     * Page tabs are deduplicated per pane, so an already-mounted body must react
     * to a new request instead of being rebuilt.
     */
    const shared = {
      pending: undefined,
      lastPath: undefined,
      pendingListeners: new Set(),
      lastListeners: new Set(),
    }

    function requestEdit(path) {
      shared.pending = path
      for (const listener of shared.pendingListeners) listener()
    }

    function takePending() {
      const path = shared.pending
      shared.pending = undefined
      return path
    }

    function setLastPath(path) {
      if (shared.lastPath === path) return
      shared.lastPath = path
      for (const listener of shared.lastListeners) listener()
    }

    function useLastPath() {
      const [path, setPath] = React.useState(shared.lastPath)
      React.useEffect(() => {
        const listener = () => setPath(shared.lastPath)
        shared.lastListeners.add(listener)
        listener()
        return () => shared.lastListeners.delete(listener)
      }, [])
      return path
    }

    const CSS = `
/* CJK glyphs advance one em in every ideographic font; Latin cells come from
   Consolas (0.55em), so scaling the CJK face to 1.1em makes one CJK character
   exactly two Latin cells wide. Both the textarea and the decoration layer use
   this stack, so their layouts stay identical. */
@font-face {
  font-family: "dsh-tf-cjk";
  src: local("Microsoft YaHei"), local("微软雅黑"), local("PingFang SC"),
       local("Noto Sans CJK SC"), local("Source Han Sans SC"),
       local("Hiragino Sans GB"), local("Microsoft JhengHei"), local("SimSun");
  size-adjust: 110%;
  unicode-range: U+2E80-303F, U+3040-30FF, U+3400-4DBF, U+4E00-9FFF,
                 U+F900-FAFF, U+FF00-FFEF, U+20000-2FA1F;
}
.dsh-tf { display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: transparent; color: var(--dsw-alias-label-primary);
  font-size: 12px; }
.dsh-tf * { box-sizing: border-box; }
.dsh-tf-head { position: relative; display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
  padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); min-height: 34px; }
/* The name takes the left side; the icon buttons stay together on the right. */
.dsh-tf-head > .dsh-tf-grow { order: -1; }
.dsh-tf-grow { flex: 1 1 auto; min-width: 0; }
.dsh-tf-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-tf-dot { color: var(--dsw-alias-state-warn-primary); flex: 0 0 auto; }
.dsh-tf-btn { flex: 0 0 auto; font: inherit; font-size: 12px; line-height: 18px;
  padding: 2px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsh-tf-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-tf-btn:disabled { opacity: .45; cursor: default; }
.dsh-tf-btn.dsh-tf-primary { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dsh-tf-iconbtn { display: inline-flex; align-items: center; justify-content: center; padding: 2px 6px; }
.dsh-tf-iconbtn[aria-pressed="true"] { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.dsh-tf-settings { flex: 0 0 auto; }
/* Anchored to the editor header, so it hugs the pane's right edge instead of the
   button's; the 6px strip above it is bridged by the hover-close delay. */
.dsh-tf-pop { position: absolute; top: 100%; right: 6px; left: auto; z-index: 20; width: 212px;
  max-width: calc(100% - 12px);
  display: flex; flex-direction: column; gap: 2px; padding: 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent); }
.dsh-tf-pop-row { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; padding: 4px 6px; border: 0; border-radius: 7px; background: transparent;
  color: inherit; font: inherit; text-align: left; cursor: pointer; }
.dsh-tf-pop-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-tf-pop-row:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.dsh-tf-pop-label { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-tf-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px;
  overflow: hidden; flex: 0 0 auto; }
.dsh-tf-seg > span { font-size: 11px; line-height: 18px; padding: 1px 8px;
  color: var(--dsw-alias-label-secondary); }
/* The active value gets a brand tint so it stays distinct from the row's neutral hover fill. */
.dsh-tf-seg > span.dsh-tf-seg-on { background: var(--dsw-alias-bg-layer-1);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent);
  color: var(--dsw-alias-label-primary); font-weight: 500; }
.dsh-tf-code { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.dsh-tf-editor { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0;
  padding: 10px 12px 10px var(--tf-gutter, 12px); border: 0; outline: none; resize: none;
  background: transparent; color: var(--dsw-alias-label-primary);
  font-family: Consolas, "Courier New", "dsh-tf-cjk", monospace;
  font-size: 12.5px; line-height: 1.55; tab-size: var(--tf-tab, 2);
  font-variant-ligatures: none; white-space: pre; overflow: auto; }
.dsh-tf-editor.dsh-tf-wrap { white-space: pre-wrap; overflow-wrap: anywhere; }
.dsh-tf-editor.dsh-tf-overlay { color: transparent; caret-color: var(--dsw-alias-label-primary); }
.dsh-tf-editor.dsh-tf-overlay::selection {
  background-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent); }
.dsh-tf-layer { position: absolute; top: 0; left: 0; margin: 0; box-sizing: border-box;
  padding: 10px 12px 10px var(--tf-gutter, 12px); pointer-events: none; will-change: transform;
  color: var(--dsw-alias-label-primary);
  font-family: Consolas, "Courier New", "dsh-tf-cjk", monospace;
  font-size: 12.5px; line-height: 1.55; tab-size: var(--tf-tab, 2);
  font-variant-ligatures: none; white-space: pre; }
.dsh-tf-layer.dsh-tf-wrap { white-space: pre-wrap; overflow-wrap: anywhere; }
.dsh-tf-layer.dsh-tf-hidden { visibility: hidden; }
.dsh-tf-line { position: relative; }
.dsh-tf-ln { position: absolute; top: 0; left: calc(-1 * var(--tf-gutter, 0px));
  width: var(--tf-gutter, 0px); padding-right: var(--tf-gutter-pad, 10px); text-align: right;
  color: var(--dsw-alias-label-secondary); opacity: .5; user-select: none; }
.dsh-tf-ws { color: var(--dsw-alias-label-secondary); opacity: .55; }
/* VS Code-like Markdown palette, built from the app's static design tokens with
   one light/dark pair each (the same pattern the shipped Shiki stylesheet uses). */
.dsh-tf-md-heading { color: var(--dsw-static-blue-600); }
.dsh-tf-md-link { color: var(--dsw-static-blue-600); text-decoration: underline; }
.dsh-tf-md-marker { color: var(--dsw-static-blue-600); }
.dsh-tf-md-code { color: var(--dsw-static-amber-600); }
.dsh-tf-md-quote { color: var(--dsw-static-green-900); }
body[data-ds-dark-theme] .dsh-tf-md-heading,
body[data-ds-dark-theme] .dsh-tf-md-link,
body[data-ds-dark-theme] .dsh-tf-md-marker { color: var(--dsw-static-blue-400); }
body[data-ds-dark-theme] .dsh-tf-md-code { color: var(--dsw-static-amber-400); }
body[data-ds-dark-theme] .dsh-tf-md-quote { color: var(--dsw-static-green-400); }
.dsh-tf-md-strong { font-weight: 600; }
.dsh-tf-md-em { font-style: italic; }
.dsh-tf-tab { display: inline-block; position: relative; height: 0; vertical-align: baseline; }
.dsh-tf-tab-arrow { position: absolute; left: 0; bottom: -0.08em; width: 1ch; height: 0.62em;
  opacity: .55; overflow: visible; }
.dsh-tf-empty { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 8px; padding: 24px;
  color: var(--dsw-alias-label-secondary); text-align: center; line-height: 1.6; }
.dsh-tf-foot { flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
  padding: 4px 10px; border-top: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-tf-foot .dsh-tf-state { flex: 0 0 auto; }
.dsh-tf-foot .dsh-tf-path { flex: 1 1 auto; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.dsh-tf-err { color: var(--dsw-alias-state-error-primary); }
.dsh-tf-title { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
.dsh-tf-title svg { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.dsh-tf-title-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-tf-edit { display: inline-flex; align-items: center; justify-content: center;
  height: 24px; width: 24px; padding: 0;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsh-tf-edit:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-tf-edit:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-tf-edit-wrap { display: inline-flex; align-items: center; }
`

    function messageOf(error) {
      if (error === undefined || error === null) return '未知错误'
      if (typeof error === 'string') return error
      return error.message !== undefined ? String(error.message) : String(error)
    }

    function baseName(path) {
      const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
      return cut === -1 ? path : path.slice(cut + 1)
    }

    function isTextPath(path) {
      const name = baseName(path).toLowerCase()
      const dot = name.lastIndexOf('.')
      return dot !== -1 && TEXT_EXTENSIONS.has(name.slice(dot + 1))
    }

    function isMarkdownPath(path) {
      const name = baseName(path).toLowerCase()
      return name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.mdx')
    }

    /** Inline Markdown pieces: code span, link/image, bold, italic. Colours only. */
    const MD_INLINE =
      /(`[^`\n]+`)|(!?\[[^\]\n]*\]\([^)\n]*\))|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*|_[^_\n]+_)/gu

    /**
     * Minimal Markdown highlighting for the decoration layer, following VS Code's
     * default scheme: headings/links/bullets blue, inline and fenced code amber,
     * quotes green, strong bold and emphasis italic. A marker always shares its
     * construct's style (`#` is as blue as the heading text, `**` as bold as its
     * content).
     *
     * Returns one token list per line: `{ start, end, cls }` colour spans. Nothing
     * here changes characters, so the textarea keeps the exact bytes and layout;
     * only the painted layer is styled.
     */
    function markdownLines(lines) {
      const table = lines.map(() => [])
      const add = (row, start, end, cls) => {
        if (end > start) table[row].push({ start, end, cls })
      }
      let inFence = ''
      let inFrontmatter = lines.length > 0 && /^---\s*$/u.test(lines[0])
      for (let row = 0; row < lines.length; row += 1) {
        const line = lines[row]
        if (inFrontmatter) {
          add(row, 0, line.length, 'dsh-tf-md-heading')
          if (row > 0 && /^(---|\.\.\.)\s*$/u.test(line)) inFrontmatter = false
          continue
        }
        const fence = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)
        if (inFence !== '') {
          if (fence !== null && fence[1][0] === inFence[0]) inFence = ''
          add(row, 0, line.length, 'dsh-tf-md-code')
          continue
        }
        if (fence !== null) {
          add(row, 0, line.length, 'dsh-tf-md-code')
          inFence = fence[1]
          continue
        }
        if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
          add(row, 0, line.length, 'dsh-tf-md-marker')
          continue
        }
        const heading = /^\s{0,3}#{1,6}\s+/u.exec(line)
        if (heading !== null) {
          add(row, 0, line.length, 'dsh-tf-md-heading')
          continue
        }
        const quote = /^\s{0,3}(?:>\s?)+/u.exec(line)
        if (quote !== null) {
          add(row, 0, line.length, 'dsh-tf-md-quote')
          continue
        }
        const list = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)/u.exec(line)
        if (list !== null) {
          add(row, list[1].length, list[1].length + list[2].length, 'dsh-tf-md-marker')
        }
        MD_INLINE.lastIndex = 0
        let match
        while ((match = MD_INLINE.exec(line)) !== null) {
          const text = match[0]
          const start = match.index
          const end = start + text.length
          if (end <= start) {
            MD_INLINE.lastIndex = start + 1
            continue
          }
          if (match[1] !== undefined) add(row, start, end, 'dsh-tf-md-code')
          else if (match[2] !== undefined) add(row, start, end, 'dsh-tf-md-link')
          else if (match[3] !== undefined) add(row, start, end, 'dsh-tf-md-strong')
          else add(row, start, end, 'dsh-tf-md-em')
        }
      }
      for (const row of table) row.sort((left, right) => left.start - right.start)
      return table
    }

    /** UTF-8 byte length, used to keep a file's trailing newline across a save. */
    function utf8Length(value) {
      return new TextEncoder().encode(value).length
    }

    /** The outline glyph used by the tab chip and the empty state. */
    function FileOutlineIcon(props) {
      const size = props?.size ?? 14
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
          className: props?.className,
        },
        h('path', {
          d: 'M6.5 3.5h7l4 4v13h-11z',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M13.5 3.5v4h4', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', {
          d: 'M9 12.5h6M9 16h4',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
      )
    }

    /** Pencil glyph for the document-preview entry button. */
    function PencilIcon() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3z',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M14.5 6.5l3 3', stroke: 'currentColor', strokeWidth: 1.5 }),
      )
    }

    /** Reload glyph. */
    function ReloadIcon() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M20 12a8 8 0 1 1-2.34-5.66',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M20 4.5V9h-4.5',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /** Save glyph (floppy outline). */
    function SaveIcon() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M5 4.5h11L19.5 8v11.5h-15z',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M8 4.5v5h7v-5',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M8.5 19.5v-5.5h7v5.5',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
      )
    }

    /** A tab: a box exactly as wide as the tab's cells, carrying a faint arrow. */
    function TabArrow(props) {
      return h(
        'span',
        { className: 'dsh-tf-tab', style: { width: `${props.cells}ch` } },
        h(
          'svg',
          { className: 'dsh-tf-tab-arrow', viewBox: '0 0 10 8', 'aria-hidden': 'true' },
          h('path', { d: 'M0 3.2h6V1l4 3-4 3V4.8H0z', fill: 'currentColor' }),
        ),
      )
    }

    /**
     * One settings row. The whole row is the switch: clicking anywhere on it —
     * the label or either value — moves to the other value.
     */
    function SettingsRow(props) {
      const index = props.options.findIndex((option) => option.value === props.value)
      const active = index === -1 ? 0 : index
      const current = props.options[active]
      const next = props.options[(active + 1) % props.options.length]
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-tf-pop-row',
          title: '点击切换',
          'aria-label': `${props.label}：${current?.label ?? ''}，点击切换`,
          onClick: () => props.onChange(next.value),
        },
        h('span', { className: 'dsh-tf-pop-label' }, props.label),
        h(
          'span',
          { className: 'dsh-tf-seg' },
          props.options.map((option) =>
            h(
              'span',
              {
                key: String(option.value),
                className: option.value === props.value ? 'dsh-tf-seg-on' : undefined,
              },
              option.label,
            ),
          ),
        ),
      )
    }

    /** Editor-settings glyph (three sliders). */
    function SettingsIcon() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M4 7h16M4 12h16M4 17h16',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
        h('circle', {
          cx: 9,
          cy: 7,
          r: 2,
          fill: 'var(--dsw-alias-bg-base)',
          stroke: 'currentColor',
          strokeWidth: 1.5,
        }),
        h('circle', {
          cx: 15,
          cy: 12,
          r: 2,
          fill: 'var(--dsw-alias-bg-base)',
          stroke: 'currentColor',
          strokeWidth: 1.5,
        }),
        h('circle', {
          cx: 8,
          cy: 17,
          r: 2,
          fill: 'var(--dsw-alias-bg-base)',
          stroke: 'currentColor',
          strokeWidth: 1.5,
        }),
      )
    }

    /**
     * One logical line as render nodes.
     *
     * With whitespace marking on, space runs become dot strings and tabs keep
     * their exact cell width through a fixed-width inline box; a zero-width space
     * after each dot keeps the line's soft-wrap opportunities where the textarea
     * has them. `tokens` (Markdown colour spans) add classes without changing a
     * single character, so layout stays identical either way.
     */
    function lineNodes(line, whitespace, tabSize, tokens) {
      const spans = tokens ?? []
      if (!whitespace && spans.length === 0) return [line === '' ? '\u200b' : line]
      const nodes = []
      let plain = ''
      let className = ''
      let column = 0
      let index = 0
      let tokenIndex = 0
      const flush = () => {
        if (plain === '') return
        nodes.push(
          className === ''
            ? plain
            : h('span', { key: `p${nodes.length}`, className }, plain),
        )
        plain = ''
      }
      while (index < line.length) {
        while (tokenIndex < spans.length && spans[tokenIndex].end <= index) tokenIndex += 1
        const span = tokenIndex < spans.length && spans[tokenIndex].start <= index ? spans[tokenIndex] : undefined
        const cls = span === undefined ? '' : span.cls
        const char = line[index]
        if (whitespace && char === ' ') {
          flush()
          let count = 1
          while (line[index + count] === ' ') count += 1
          index += count
          column += count
          nodes.push(
            h(
              'span',
              { key: `s${nodes.length}`, className: 'dsh-tf-ws' },
              '\u00b7\u200b'.repeat(count),
            ),
          )
          continue
        }
        if (whitespace && char === '\t') {
          flush()
          const cells = tabSize - (column % tabSize)
          index += 1
          column += cells
          nodes.push(h(TabArrow, { key: `t${nodes.length}`, cells }))
          continue
        }
        if (cls !== className) {
          flush()
          className = cls
        }
        plain += char
        column += char.codePointAt(0) >= 0x2e80 ? 2 : 1
        index += 1
      }
      flush()
      nodes.push('\u200b')
      return nodes
    }

    /**
     * Toolbar button for the shipped document preview. That slot hands over the
     * previewed file's Host path (`absolutePath`) once it is known; text files get
     * a control that opens the same file here, everything else is left untouched.
     */
    function EditFileAction(props) {
      const candidate = props?.absolutePath
      const absolutePath = typeof candidate === 'string' ? candidate : ''
      if (absolutePath === '' || !isTextPath(absolutePath)) return null
      const open = () => {
        try {
          requestEdit(absolutePath)
          api.sidebarRight.openTab(KIND)
        } catch {
          takePending()
        }
      }
      return h(
        'span',
        { className: 'dsh-tf-edit-wrap' },
        h('style', null, CSS),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-tf-edit',
            title: '用文本编辑器打开',
            'aria-label': '用文本编辑器打开',
            onClick: open,
          },
          h(PencilIcon, null),
        ),
      )
    }

    /** Tab chip: outline file glyph plus the open file's name. */
    function TabTitle() {
      const path = useLastPath()
      const name = typeof path === 'string' && path !== '' ? baseName(path) : TAB_TITLE
      return h(
        'span',
        { className: 'dsh-tf-title' },
        h('style', null, CSS),
        h(FileOutlineIcon, { size: 14 }),
        h(
          'span',
          { className: 'dsh-tf-title-name', title: typeof path === 'string' ? path : TAB_TITLE },
          name,
        ),
      )
    }

    function TextFileBody(props) {
      const sessionId = props.sessionId
      const [file, setFile] = React.useState(null)
      const [text, setText] = React.useState('')
      const [base, setBase] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [composing, setComposing] = React.useState(false)
      const [settings, setSettings] = React.useState(readSettings)
      const [settingsOpen, setSettingsOpen] = React.useState(false)
      const [request, setRequest] = React.useState({ path: undefined, nonce: 0 })
      const [editorWidth, setEditorWidth] = React.useState(0)
      const [viewportWidth, setViewportWidth] = React.useState(() =>
        typeof window === 'undefined' ? 0 : window.innerWidth,
      )

      const editorRef = React.useRef(null)
      const layerRef = React.useRef(null)
      const tailRef = React.useRef(-1)
      const pendingSelection = React.useRef(null)
      const settingsRef = React.useRef(null)
      const settingsCloseTimer = React.useRef(0)
      /** A click that closes the popover also suppresses hover until the pointer leaves. */
      const settingsSuppressed = React.useRef(false)

      const updateSettings = (patch) => {
        setSettings((current) => {
          const next = { ...current, ...patch }
          writeSettings(next)
          return next
        })
      }

      // Hover-open with a short close delay, so crossing the gap between the
      // button and the flush-right popover does not close it.
      const cancelSettingsClose = () => {
        window.clearTimeout(settingsCloseTimer.current)
        settingsCloseTimer.current = 0
      }

      const openSettings = () => {
        if (settingsSuppressed.current) return
        cancelSettingsClose()
        setSettingsOpen(true)
      }

      /** Leave the button or the popover: the next hover may open it again. */
      const leaveSettings = () => {
        settingsSuppressed.current = false
        closeSettingsSoon()
      }

      /** Clicking the button toggles: an open popover closes at once and stays closed. */
      const toggleSettings = () => {
        if (settingsOpen) {
          settingsSuppressed.current = true
          cancelSettingsClose()
          setSettingsOpen(false)
          return
        }
        settingsSuppressed.current = false
        cancelSettingsClose()
        setSettingsOpen(true)
      }

      const closeSettingsSoon = () => {
        cancelSettingsClose()
        settingsCloseTimer.current = window.setTimeout(() => {
          settingsCloseTimer.current = 0
          setSettingsOpen(false)
        }, RENDER.settingsCloseDelayMs)
      }

      React.useEffect(() => () => cancelSettingsClose(), [])

      const dirty = file !== null && text !== base
      const readOnly = file !== null && file.truncated === true
      const wrap = settings.wrap
      const showWhitespace = settings.whitespace
      const showLineNumbers = settings.lineNumbers
      const lines = React.useMemo(() => text.split('\n'), [text])
      const decorated =
        (showWhitespace || showLineNumbers) &&
        file !== null &&
        lines.length <= RENDER.maxDecoratedLines &&
        text.length <= RENDER.maxDecoratedChars
      const lineDigits = String(lines.length).length
      const markdown = file !== null && isMarkdownPath(file.path)
      const lineSpans = React.useMemo(
        () => (markdown && decorated ? markdownLines(lines) : null),
        [markdown, decorated, lines],
      )
      // The 4-digit reserve is a luxury: a narrow window (at most half the screen)
      // or a narrow pane keeps exactly the digits in use instead.
      const screenWidth =
        typeof window === 'undefined' || window.screen === undefined ? 0 : window.screen.width
      const narrowWindow =
        screenWidth > 0 && viewportWidth > 0 && viewportWidth <= screenWidth * RENDER.narrowWindowRatio
      const roomy = !narrowWindow && editorWidth >= RENDER.roomyEditorPx
      const gutterDigits = roomy ? Math.max(RENDER.minGutterDigits, lineDigits) : lineDigits
      // The number is right-aligned, so equal left/right margins need 2× the pad.
      const gutterPad = roomy ? 10 : 6
      const gutter =
        showLineNumbers && decorated
          ? `calc(${gutterDigits}ch + ${gutterPad * 2}px)`
          : undefined

      // Keep the decoration layer on the textarea's exact content box and scroll
      // offset. A mismatch would show as drifting dots or misaligned numbers.
      const syncLayer = React.useCallback(() => {
        const editor = editorRef.current
        const layer = layerRef.current
        if (editor === null || layer === null) return
        // Keep the last line off the bottom edge: the textarea's own padding-bottom
        // is scrollable, so the tail shows only when the reader reaches the end.
        // Written before the width read, because a new scrollbar narrows the content.
        const tail = Math.max(0, Math.round(editor.clientHeight * RENDER.tailSpaceRatio))
        if (tailRef.current !== tail) {
          tailRef.current = tail
          editor.style.paddingBottom = `${10 + tail}px`
        }
        layer.style.width = wrap ? `${editor.clientWidth}px` : 'max-content'
        layer.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`
      }, [wrap])

      React.useLayoutEffect(() => {
        const editor = editorRef.current
        if (editor !== null && pendingSelection.current !== null) {
          editor.setSelectionRange(pendingSelection.current.start, pendingSelection.current.end)
          pendingSelection.current = null
        }
        syncLayer()
        if (editor !== null && editor.clientWidth !== editorWidth) {
          setEditorWidth(editor.clientWidth)
        }
      })

      React.useEffect(() => {
        const onResize = () => setViewportWidth(window.innerWidth)
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])

      // Close the settings popover on an outside press or Escape.
      React.useEffect(() => {
        if (!settingsOpen) return undefined
        const onPointerDown = (event) => {
          const root = settingsRef.current
          if (root !== null && !root.contains(event.target)) {
            settingsSuppressed.current = false
            setSettingsOpen(false)
          }
        }
        const onKey = (event) => {
          if (event.key === 'Escape') {
            settingsSuppressed.current = false
            setSettingsOpen(false)
          }
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [settingsOpen])

      React.useEffect(() => {
        const editor = editorRef.current
        if (editor === null || typeof ResizeObserver !== 'function') return undefined
        const observer = new ResizeObserver(() => {
          syncLayer()
          const next = editor.clientWidth
          setEditorWidth((current) => (current === next ? current : next))
        })
        observer.observe(editor)
        return () => observer.disconnect()
      }, [syncLayer])

      const openPath = React.useCallback(
        async (path) => {
          if (sessionId === undefined) return
          const controller = new AbortController()
          setBusy(true)
          setError('')
          try {
            // `stat` supplies the Host's absolute path, which is what the save
            // command needs; `read` supplies the first page of text.
            const stat = await api.remote.workspaceFiles.stat(sessionId, path, controller.signal)
            if (stat === undefined || stat.ok !== true) {
              setError(messageOf(stat?.error))
              return
            }
            const absolutePath =
              typeof stat.value.absolutePath === 'string' && stat.value.absolutePath !== ''
                ? stat.value.absolutePath
                : path
            const result = await api.remote.workspaceFiles.read(
              sessionId,
              path,
              { offset: 1 },
              controller.signal,
            )
            if (result === undefined || result.ok !== true) {
              setError(messageOf(result?.error))
              return
            }
            const value = result.value
            const content = typeof value.text === 'string' ? value.text : ''
            const complete = value.eof !== false
            const bytes = typeof stat.value.bytes === 'number' ? stat.value.bytes : undefined
            // A page joins lines with "\n" and carries no terminator, so the file's
            // own trailing newline is one byte beyond the page's UTF-8 length.
            const trailingNewline =
              complete && bytes !== undefined && bytes - utf8Length(content) === 1
            setFile({
              path,
              absolutePath,
              lines: value.lines,
              truncated: !complete,
              trailingNewline,
            })
            setText(content)
            setBase(content)
            setLastPath(absolutePath)
          } catch (failure) {
            setError(messageOf(failure))
          } finally {
            setBusy(false)
          }
        },
        [sessionId],
      )

      // The framework-owned hook identifies this tab and lets the body close it.
      const useTabInfo = props.useTabInfo
      const tabInfo = typeof useTabInfo === 'function' ? useTabInfo() : undefined
      const closeTab = tabInfo?.tab?.actions?.close

      // The preview toolbar hands this tab one file path. A page tab is
      // deduplicated per pane, so an already-open editor must react as well.
      React.useEffect(() => {
        const listener = () => {
          const next = takePending() ?? shared.lastPath
          if (typeof next !== 'string' || next === '') return
          setRequest((current) => ({ path: next, nonce: current.nonce + 1 }))
        }
        shared.pendingListeners.add(listener)
        const initial = takePending() ?? shared.lastPath
        if (typeof initial === 'string' && initial !== '') {
          setRequest((current) => ({ path: initial, nonce: current.nonce + 1 }))
        } else if (typeof closeTab === 'function') {
          // Nothing to edit: a restored/empty editor tab closes itself instead of
          // showing a placeholder.
          closeTab()
        }
        return () => shared.pendingListeners.delete(listener)
      }, [])

      React.useEffect(() => {
        if (request.path === undefined) return
        if (file !== null && file.path === request.path) return
        void openPath(request.path)
      }, [request.nonce])

      const save = React.useCallback(async () => {
        if (file === null || readOnly || busy) return
        setBusy(true)
        setError('')
        try {
          const content =
            text !== '' && file.trailingNewline === true ? `${text}\n` : text
          const payload = JSON.stringify({ path: file.absolutePath, content })
          const outcome = await api.remote.commands.execute(
            sessionId,
            `/${SAVE_COMMAND} ${payload}`,
            [],
          )
          if (outcome === undefined || outcome.ok !== true) {
            setError(messageOf(outcome?.error))
            return
          }
          if (outcome.value === undefined) {
            setError(`未知命令：/${SAVE_COMMAND}（插件的 Host 半边是否已激活？）`)
            return
          }
          const result = outcome.value.result ?? {}
          if (result.kind === 'error') {
            setError(result.text !== undefined ? String(result.text) : '保存失败')
            return
          }
          setBase(text)
        } catch (failure) {
          setError(messageOf(failure))
        } finally {
          setBusy(false)
        }
      }, [busy, file, readOnly, sessionId, text])

      /** Indent unit for Tab: one tab, or as many spaces as the tab width. */
      const indentUnit = settings.indent === 'tab' ? '\t' : ' '.repeat(settings.tabSize)

      const replaceWithSelection = (nextText, start, end) => {
        pendingSelection.current = { start, end }
        setText(nextText)
      }

      /**
       * Tab / Shift+Tab inside the editor. The browser would move focus instead;
       * preventing the default is also what makes Tab typable at all here.
       */
      const applyIndent = (outdent) => {
        const editor = editorRef.current
        if (editor === null) return
        const value = editor.value
        const start = editor.selectionStart
        const end = editor.selectionEnd
        if (!outdent && start === end) {
          const next = `${value.slice(0, start)}${indentUnit}${value.slice(end)}`
          replaceWithSelection(next, start + indentUnit.length, start + indentUnit.length)
          return
        }
        if (outdent && start === end) {
          const before = value.slice(0, start)
          const spaces = before.match(/ +$/u)?.[0].length ?? 0
          const remove = before.endsWith('\t') ? 1 : Math.min(spaces, settings.tabSize)
          if (remove === 0) return
          const next = `${value.slice(0, start - remove)}${value.slice(start)}`
          replaceWithSelection(next, start - remove, start - remove)
          return
        }
        const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
        const newline = value.indexOf('\n', end)
        const lineEnd = newline === -1 ? value.length : newline
        const block = value.slice(lineStart, lineEnd)
        const nextBlock = block
          .split('\n')
          .map((line) => {
            if (!outdent) return `${indentUnit}${line}`
            if (line.startsWith('\t')) return line.slice(1)
            const spaces = line.match(/^ +/u)?.[0].length ?? 0
            return line.slice(Math.min(spaces, settings.tabSize))
          })
          .join('\n')
        const next = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`
        replaceWithSelection(next, lineStart, lineStart + nextBlock.length)
      }

      const onKeyDown = (event) => {
        if (
          event.key === 'Tab' &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !readOnly
        ) {
          event.preventDefault()
          applyIndent(event.shiftKey)
          return
        }
        if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's') {
          event.preventDefault()
          void save()
        }
      }

      const header =
        file === null
          ? null
          : h(
              'div',
              { className: 'dsh-tf-head' },
              h(
                'span',
                {
                  className: 'dsh-tf-settings',
                  ref: settingsRef,
                  onMouseEnter: openSettings,
                  onMouseLeave: leaveSettings,
                  onBlur: (event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      settingsSuppressed.current = false
                      setSettingsOpen(false)
                    }
                  },
                },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-tf-btn dsh-tf-iconbtn',
                    title: '编辑器设置',
                    'aria-label': '编辑器设置',
                    'aria-expanded': settingsOpen,
                    onClick: toggleSettings,
                    onFocus: openSettings,
                  },
                  h(SettingsIcon, null),
                ),
                settingsOpen
                  ? h(
                      'div',
                      {
                        className: 'dsh-tf-pop',
                        onMouseEnter: openSettings,
                        onMouseLeave: leaveSettings,
                      },
                      h(SettingsRow, {
                        label: '换行',
                        value: wrap,
                        options: [
                          { value: true, label: '开' },
                          { value: false, label: '关' },
                        ],
                        onChange: (value) => updateSettings({ wrap: value }),
                      }),
                      h(SettingsRow, {
                        label: '缩进',
                        value: settings.indent,
                        options: [
                          { value: 'spaces', label: '空格' },
                          { value: 'tab', label: 'Tab' },
                        ],
                        onChange: (value) => updateSettings({ indent: value }),
                      }),
                      h(SettingsRow, {
                        label: '制表符宽度',
                        value: settings.tabSize,
                        options: [
                          { value: 2, label: '2' },
                          { value: 4, label: '4' },
                        ],
                        onChange: (value) => updateSettings({ tabSize: value }),
                      }),
                      h(SettingsRow, {
                        label: '显示空白',
                        value: showWhitespace,
                        options: [
                          { value: true, label: '显示' },
                          { value: false, label: '隐藏' },
                        ],
                        onChange: (value) => updateSettings({ whitespace: value }),
                      }),
                      h(SettingsRow, {
                        label: '显示行号',
                        value: showLineNumbers,
                        options: [
                          { value: true, label: '显示' },
                          { value: false, label: '隐藏' },
                        ],
                        onChange: (value) => updateSettings({ lineNumbers: value }),
                      }),
                    )
                  : null,
              ),
              h(
                'span',
                { className: 'dsh-tf-grow' },
                h(
                  'span',
                  { className: 'dsh-tf-name', title: file.absolutePath },
                  baseName(file.path),
                ),
                dirty
                  ? h('span', { className: 'dsh-tf-dot', title: '有未保存的修改' }, ' ●')
                  : null,
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-tf-btn dsh-tf-iconbtn',
                  title: '重新加载',
                  'aria-label': '重新加载',
                  disabled: busy,
                  onClick: () => void openPath(file.path),
                },
                h(ReloadIcon, null),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-tf-btn dsh-tf-iconbtn dsh-tf-primary',
                  title: '保存 (Ctrl+S)',
                  'aria-label': '保存',
                  disabled: busy || !dirty || readOnly,
                  onClick: () => void save(),
                },
                h(SaveIcon, null),
              ),
            )

      const layerNodes = React.useMemo(() => {
        if (!decorated) return null
        return lines.map((line, index) =>
          h(
            'div',
            { className: 'dsh-tf-line', key: index },
            showLineNumbers
              ? h('span', { className: 'dsh-tf-ln', 'aria-hidden': 'true' }, String(index + 1))
              : null,
            ...lineNodes(line, showWhitespace, settings.tabSize, lineSpans?.[index]),
          ),
        )
        // `composing` only toggles visibility; the nodes themselves follow text.
      }, [decorated, lines, showLineNumbers, showWhitespace, settings.tabSize, lineSpans])

      const body =
        file === null
          ? h('div', { className: 'dsh-tf-empty' })
          : h(
              'div',
              {
                className: 'dsh-tf-code',
                style: {
                  ...(gutter !== undefined
                    ? { '--tf-gutter': gutter, '--tf-gutter-pad': `${gutterPad}px` }
                    : {}),
                  '--tf-tab': String(settings.tabSize),
                },
              },
              layerNodes === null
                ? null
                : h(
                    'pre',
                    {
                      className: `dsh-tf-layer${wrap ? ' dsh-tf-wrap' : ''}${composing ? ' dsh-tf-hidden' : ''}`,
                      ref: layerRef,
                      'aria-hidden': 'true',
                    },
                    layerNodes,
                  ),
              h('textarea', {
                ref: editorRef,
                className: `dsh-tf-editor${wrap ? ' dsh-tf-wrap' : ''}${
                  layerNodes !== null && !composing ? ' dsh-tf-overlay' : ''
                }`,
                value: text,
                spellCheck: false,
                wrap: wrap ? 'soft' : 'off',
                readOnly,
                onChange: (event) => setText(event.target.value),
                onScroll: () => syncLayer(),
                onKeyDown,
                onCompositionStart: () => setComposing(true),
                onCompositionEnd: (event) => {
                  setComposing(false)
                  setText(event.currentTarget.value)
                },
              }),
            )

      const largeFileNotice =
        readOnly && file !== null
          ? h(
              'div',
              { className: 'dsh-tf-foot' },
              h(
                'span',
                { className: 'dsh-tf-state dsh-tf-err' },
                '文件较大：只显示第一页，已禁用保存。',
              ),
            )
          : null

      const banner =
        error !== ''
          ? h(
              'div',
              { className: 'dsh-tf-foot' },
              h('span', { className: 'dsh-tf-state dsh-tf-err', title: error }, error),
            )
          : null

      const foot =
        file === null
          ? null
          : h(
              'div',
              { className: 'dsh-tf-foot' },
              h(
                'span',
                { className: 'dsh-tf-state' },
                `${file.lines ?? text.split('\n').length} 行 · ${text.length} 字符`,
              ),
              h('span', { className: 'dsh-tf-path', title: file.absolutePath }, file.absolutePath),
            )

      return h(
        'div',
        { className: 'dsh-tf' },
        h('style', null, CSS),
        header,
        largeFileNotice,
        body,
        banner,
        foot,
      )
    }

    return {
      inject,
      apply(ctx) {
        api.remote = ctx.remote
        api.sidebarRight = ctx.sidebarRight

        // A page tab with no guide entry: the preview toolbar's 编辑 button is
        // the only entry point. `keepMounted` keeps the buffer while the tab is
        // switched away from, so switching tabs does not drop the open file.
        ctx.effect(
          () =>
            ctx.sidebarRightTabs.register({
              id: ID,
              kind: KIND,
              priority: 'builtin',
              keepMounted: true,
              title: () => TAB_TITLE,
            }),
          'textfile: tab type',
        )

        ctx.effect(
          () =>
            ctx.slots.inject(BODY_SLOT, () =>
              ctx.slots.register({ name: BODY_SLOT, key: ID }, TextFileBody),
            ),
          'textfile: tab body',
        )

        ctx.effect(
          () =>
            ctx.slots.inject(TITLE_SLOT, () =>
              ctx.slots.register({ name: TITLE_SLOT, key: ID }, TabTitle),
            ),
          'textfile: tab title',
        )

        ctx.effect(
          () =>
            ctx.slots.inject(DOCUMENT_ACTIONS_SLOT, () =>
              ctx.slots.register(
                { name: DOCUMENT_ACTIONS_SLOT, id: EDIT_ACTION_ID, order: 10 },
                EditFileAction,
              ),
            ),
          'textfile: document action',
        )
      },
    }
  },
})
