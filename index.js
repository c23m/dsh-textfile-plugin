/**
 * Host half of the text-file editor bundle.
 *
 * The editor itself lives in the browser half (`client.js`). The browser reaches
 * Host code through one command: `commands.execute` is the Client-callable entry
 * point in this profile. The handler resolves the path through the composed
 * filesystem and writes through the same sandbox policy the filesystem tools
 * use, so a read-only session stays read-only.
 */

/** Services the handler needs; the plugin stays inactive in a profile without them. */
export const inject = ['commands', 'fs', 'workingDirectory', 'sandboxPolicy']

const COMMAND = 'textfile-save'

const failure = (text) => ({ kind: 'error', text })

/** Read the filesystem session behind a command invocation, when the Agent exposes it. */
function sessionOf(agent) {
  return agent?.session !== undefined ? agent.session : undefined
}

export function apply(ctx) {
  ctx.effect(() =>
    ctx.commands.register({
      name: COMMAND,
      description: '把右侧栏「文本文件」页签里的内容保存到对应文件。',
      recordInput: false,
      handler: async (invocation) => {
        const { agent, rawInput } = invocation
        let payload
        try {
          payload = JSON.parse(rawInput)
        } catch {
          return failure(`${COMMAND}：需要 JSON 负载`)
        }
        const filePath = typeof payload?.path === 'string' ? payload.path : ''
        const content = typeof payload?.content === 'string' ? payload.content : ''
        if (filePath === '') return failure(`${COMMAND}：缺少 path`)

        const session = sessionOf(agent)
        let cwd
        let policy
        let signal
        try {
          if (session !== undefined) cwd = ctx.workingDirectory.get(session)
        } catch {
          cwd = undefined
        }
        try {
          if (session !== undefined) policy = ctx.sandboxPolicy.resolve({ session })
        } catch {
          policy = undefined
        }
        try {
          signal = invocation.signal
        } catch {
          signal = undefined
        }

        try {
          const target = await ctx.fs.resolve(filePath, cwd !== undefined ? { cwd } : undefined)
          await ctx.fs.writeText(target, content, undefined, signal, policy)
          return { kind: 'success', text: `已保存 ${ctx.fs.processPath(target)}` }
        } catch (error) {
          return failure(`${COMMAND} 保存失败：${error?.message ?? String(error)}`)
        }
      },
    }),
  )
}
