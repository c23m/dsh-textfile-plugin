#!/usr/bin/env node
/**
 * 本地与 CI 共用的自检：`node --check` 负责语法，这里校验清单与资源。
 * 用法：node scripts/check.mjs
 */
import { existsSync, readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const path = (name) => new URL(name, root)
const read = (name) => readFileSync(path(name), 'utf8')

const failures = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}

const manifest = JSON.parse(read('package.json'))
check(manifest.name === '@local/dsh-plugin-textfile', 'package.json 的 name 应为 @local/dsh-plugin-textfile')
check(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'package.json 缺少或写错 dsh.bundle.patch')
check(manifest.dsh?.client?.platform === 'web', 'package.json 缺少 dsh.client.platform = web')
check(manifest.dsh?.client?.immediately === true, 'package.json 缺少 dsh.client.immediately = true')

for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json']) {
  check(existsSync(path(file)), `缺少文件：${file}`)
}

for (const file of ['locale/en.json', 'locale/zh.json']) {
  const meta = JSON.parse(read(file))?.meta
  check(
    typeof meta?.title === 'string' && typeof meta?.description === 'string',
    `${file} 缺少 meta.title / meta.description`,
  )
}

const patch = read('cordis.patch.yml')
check(/- insert:/.test(patch), 'cordis.patch.yml 缺少 insert 段')
check(patch.includes('@local/dsh-plugin-textfile'), 'cordis.patch.yml 未引用 @local/dsh-plugin-textfile')
check(/<svg[\s>]/.test(read('icon.svg')), 'icon.svg 不是有效的 SVG')

if (failures.length > 0) {
  console.error('校验失败：')
  for (const failure of failures) console.error('  - ' + failure)
  process.exit(1)
}
console.log('校验通过')
