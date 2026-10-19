#!/usr/bin/env node
/**
 * Install or update dsh-kit into an existing DeepSeek Harness profile.
 * Package changes go through `dsh plugin`. Safe to re-run.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const kitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NPM_SPEC = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SHIPPED_NAME = /^@deepseek-ai\/dsh-[a-z0-9-]+$/

function fail(message, code = 1) {
  console.error(message)
  process.exit(code)
}

function parseArgs(argv) {
  const out = { applyPreferences: true, dryRun: false, skipShipped: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value === undefined) fail('缺少参数值: ' + arg)
      return value
    }
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--profile') out.profile = next()
    else if (arg === '--dsh') out.dsh = next()
    else if (arg === '--home') out.home = next()
    else if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--skip-preferences') out.applyPreferences = false
    else if (arg === '--skip-shipped') out.skipShipped = true
    else fail('未知参数: ' + arg + '\n运行 node scripts/install.mjs --help')
  }
  return out
}

function help() {
  console.log(`dsh-kit 安装器

用法:
  node scripts/install.mjs [--profile <name>] [--dsh <path>] [--home <dir>]
                           [--dry-run] [--skip-preferences] [--skip-shipped]

前提: 本机已经有 DeepSeek Harness。安装器只补插件；空的设置层才会写入模板。
Desktop 的 profile 名叫 desktop，必须用 Desktop 自带的 dsh，并且要先完全退出应用。
`)
}

function whereDsh() {
  const command = process.platform === 'win32' ? 'where.exe' : 'which'
  const args = process.platform === 'win32' ? ['dsh'] : ['-a', 'dsh']
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) return []
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

function desktopCommand() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA
    if (!base) return undefined
    return join(base, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')
  }
  if (process.platform === 'darwin') return '/usr/local/bin/dsh'
  return undefined
}

function readText(path) {
  try { return readFileSync(path, 'utf8') } catch { return '' }
}

function canManageDesktop(path) {
  const text = readText(path)
  return text.includes('dsh-desktop-host') || text.includes('DeepSeek Harness')
}

function findDesktopDsh(requested) {
  if (requested && existsSync(requested) && canManageDesktop(requested)) return requested
  const found = whereDsh().find(path => existsSync(path) && canManageDesktop(path))
  if (found) return found
  const bundled = desktopCommand()
  if (bundled && existsSync(bundled)) return bundled
  return undefined
}

function findAnyDsh(requested) {
  if (requested) {
    if (!existsSync(requested)) fail('找不到 dsh: ' + requested)
    return requested
  }
  const found = whereDsh().find(path => existsSync(path))
  if (found) return found
  const bundled = desktopCommand()
  if (bundled && existsSync(bundled)) return bundled
  fail('找不到 dsh。请先安装 DeepSeek Harness，并让 dsh 出现在 PATH 上。')
}

function homeDir(explicit) {
  return explicit || process.env.DSH_HOME || join(homedir(), '.dsh')
}

function loadManifest() {
  const manifest = JSON.parse(readFileSync(join(kitRoot, 'manifest.json'), 'utf8'))
  if (!Array.isArray(manifest.npm) || !Array.isArray(manifest.local)) fail('manifest.json 格式不对')
  for (const item of manifest.npm) {
    const spec = item.name + '@' + item.version
    if (!NPM_SPEC.test(spec)) fail('拒绝不合法的 npm 规格: ' + spec)
  }
  for (const item of manifest.local) {
    if (typeof item.path !== 'string' || item.path.includes('..') || item.path.startsWith('/') || /^[A-Za-z]:/.test(item.path)) {
      fail('本地插件路径必须是库内相对路径: ' + item.path)
    }
    const dir = resolve(kitRoot, item.path)
    if (!existsSync(join(dir, 'package.json'))) fail('本地插件缺少 package.json: ' + item.path)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    if (pkg.name !== item.name) fail('package.json 的 name 与清单不一致: ' + item.path)
  }
  if (manifest.shippedOptional !== undefined) {
    if (!Array.isArray(manifest.shippedOptional)) fail('shippedOptional 必须是数组')
    for (const name of manifest.shippedOptional) {
      if (!SHIPPED_NAME.test(name)) fail('拒绝不合法的可选包名: ' + name)
    }
  }
  return manifest
}

function installedVersion(profileDir, name) {
  const path = join(profileDir, 'node_modules', ...name.split('/'), 'package.json')
  if (!existsSync(path)) return undefined
  try { return JSON.parse(readFileSync(path, 'utf8')).version } catch { return undefined }
}

function sameLink(spec, absDir) {
  if (typeof spec !== 'string') return false
  const matched = spec.match(/^(?:link:|file:)(.+)$/i)
  if (!matched) return false
  return resolve(matched[1]) === resolve(absDir)
}

function cmdQuote(value) {
  if (value.length === 0) return '""'
  if (!/[\s"&|<>^]/.test(value)) return value
  return '"' + value.replace(/"/g, '""') + '"'
}

function runDsh(dsh, args, dryRun) {
  const shown = [dsh, ...args].join(' ')
  console.log(dryRun ? '  [dry-run] ' + shown : '  $ ' + shown)
  if (dryRun) return 0
  const result = process.platform === 'win32'
    ? spawnSync([dsh, ...args].map(cmdQuote).join(' '), { shell: true, stdio: 'inherit', windowsVerbatimArguments: true })
    : spawnSync(dsh, args, { stdio: 'inherit' })
  return result.status ?? 1
}

function desktopRunning() {
  if (process.platform === 'win32') {
    const result = spawnSync('tasklist', ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/NH'], { encoding: 'utf8' })
    return (result.stdout || '').includes('DeepSeek Harness.exe')
  }
  if (process.platform === 'darwin') {
    return spawnSync('pgrep', ['-f', 'DeepSeek Harness'], { encoding: 'utf8' }).status === 0
  }
  return false
}

function runtimeFor(dshPath) {
  const text = readText(dshPath)
  const bin = dirname(dshPath)
  if (text.includes('DeepSeek Harness')) {
    const exe = process.platform === 'darwin'
      ? resolve(bin, '..', '..', '..', '..', 'MacOS', 'DeepSeek Harness')
      : resolve(bin, '..', '..', '..', '..', 'DeepSeek Harness.exe')
    const asar = resolve(bin, '..', '..', '..', 'app.asar', 'dsh')
    if (existsSync(exe)) {
      return {
        kind: 'electron',
        exe,
        anchors: [
          join(asar, 'package.json'),
          join(asar, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
          join(asar, 'node_modules', '@deepseek-ai', 'dsh-base', 'package.json'),
        ],
      }
    }
  }
  const fromFile = text.match(/DSH_REPO=([^"\r\n]+)/)?.[1]?.trim()
  const root = process.env.DSH_REPO || fromFile
  if (root) {
    const anchor = join(root, 'apps', 'cli', 'package.json')
    if (existsSync(anchor)) return { kind: 'node', exe: 'node', anchors: [anchor] }
  }
  return undefined
}

function canResolve(runtime, name) {
  const script = join(kitRoot, 'scripts', 'resolve-bundle.mjs')
  for (const anchor of runtime.anchors) {
    const args = runtime.kind === 'electron'
      ? ['--expose-internals', script, anchor, name]
      : [script, anchor, name]
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    if (spawnSync(runtime.exe, args, { env, encoding: 'utf8' }).status === 0) return true
  }
  return false
}

function enableShipped(profileDir, names, dshPath, dryRun) {
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) {
    console.log('跳过随安装提供的可选包：profile 还没有 package.json')
    return
  }
  const runtime = runtimeFor(dshPath)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
  const added = []
  for (const name of names) {
    if (bundles.includes(name)) continue
    if (dryRun) {
      console.log('  [dry-run] 若当前 Harness 自带，将启用 ' + name)
      continue
    }
    if (!runtime || !canResolve(runtime, name)) {
      console.log('跳过 ' + name + '：当前 Harness 安装里没有这个包')
      continue
    }
    bundles.push(name)
    added.push(name)
    console.log('启用 ' + name)
  }
  if (!dryRun && added.length > 0) {
    const backup = manifestPath + '.bak-dsh-kit'
    copyFileSync(manifestPath, backup)
    manifest.dsh = { ...(manifest.dsh ?? {}), profile: { ...(manifest.dsh?.profile ?? {}), bundles } }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    console.log('已备份 ' + backup)
  }
}

function applyPreferences(profileDir, dryRun) {
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const template = readFileSync(join(kitRoot, 'settings', 'preferences.patch.yml'), 'utf8')
  if (!existsSync(patchPath)) {
    console.log(dryRun ? '  [dry-run] 将写入设置模板' : '写入设置模板')
    if (!dryRun) writeFileSync(patchPath, template)
    return
  }
  const current = readFileSync(patchPath, 'utf8')
  if (current.includes('dsh-kit preferences')) {
    console.log('设置模板已经写过，不重复覆盖')
    return
  }
  if (!/^\s*(?:#[^\n]*\n\s*)*\[\s*\]\s*$/.test(current)) {
    console.log('profile 已有自己的设置，没有覆盖。模板在 settings/preferences.patch.yml')
    return
  }
  console.log(dryRun ? '  [dry-run] 将把空的设置层换成模板' : '空的设置层已换成模板（不含账号）')
  if (!dryRun) {
    copyFileSync(patchPath, patchPath + '.bak-dsh-kit')
    writeFileSync(patchPath, template)
  }
}

function selectProfile(requested, home) {
  if (requested) return requested.toLowerCase() === 'desktop' ? 'desktop' : requested
  const desktopJson = join(home, 'profiles', 'desktop', 'package.json')
  if (existsSync(desktopJson) && findDesktopDsh()) return 'desktop'
  return 'web'
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    help()
    return
  }
  const manifest = loadManifest()
  const home = homeDir(args.home)
  const profile = selectProfile(args.profile, home)
  const dsh = profile === 'desktop' ? findDesktopDsh(args.dsh) : findAnyDsh(args.dsh)
  if (profile === 'desktop' && !dsh) {
    fail(
      'profile desktop 只能由 Desktop 自带的 dsh 管理。\n'
      + '请在 Desktop 里用「管理 dsh 命令」注册命令，完全退出应用后再运行。\n'
      + '当前 PATH 上的 dsh 不能改 desktop profile。',
      2,
    )
  }
  const dir = join(home, 'profiles', profile)
  console.log('dsh: ' + dsh)
  console.log('profile: ' + profile)
  console.log('home: ' + home)
  if (profile === 'desktop' && !existsSync(join(dir, 'package.json'))) {
    fail('还没有 desktop profile。请先打开一次 Desktop，再完全退出，然后重跑安装器。', 2)
  }
  if (profile === 'desktop' && !args.dryRun && desktopRunning()) {
    fail('DeepSeek Harness 还在运行。请从托盘完全退出后再安装。只关窗口不够。', 2)
  }

  let deps = {}
  const profileJsonPath = join(dir, 'package.json')
  if (existsSync(profileJsonPath)) deps = JSON.parse(readFileSync(profileJsonPath, 'utf8')).dependencies ?? {}

  const npmAdd = []
  for (const item of manifest.npm) {
    const spec = item.name + '@' + item.version
    if (installedVersion(dir, item.name) === item.version) {
      console.log('已是目标版本，跳过 ' + spec)
      continue
    }
    npmAdd.push(spec)
  }
  const localAdd = []
  const localRemove = []
  for (const item of manifest.local) {
    const abs = resolve(kitRoot, item.path)
    if (sameLink(deps[item.name], abs)) {
      console.log('已链接到本库，跳过 ' + item.name)
      continue
    }
    if (deps[item.name] !== undefined) localRemove.push(item.name)
    localAdd.push('link:' + abs.replace(/\\/g, '/'))
  }

  if (localRemove.length > 0) {
    console.log('先卸掉旧位置的本地插件，再链到本库')
    const code = runDsh(dsh, ['plugin', '--profile', profile, 'remove', ...localRemove], args.dryRun)
    if (code !== 0) fail('卸载旧链接失败，退出码 ' + code)
  }
  if (npmAdd.length > 0) {
    console.log('安装或更新第三方插件')
    const code = runDsh(dsh, ['plugin', '--profile', profile, 'add', ...npmAdd], args.dryRun)
    if (code !== 0) fail('第三方插件安装失败，退出码 ' + code + '\n如果提示 already-installed，先完全退出应用再重跑。')
  } else console.log('第三方插件版本已对齐')
  if (localAdd.length > 0) {
    console.log('链接本库里的插件')
    const code = runDsh(dsh, ['plugin', '--profile', profile, 'add', ...localAdd], args.dryRun)
    if (code !== 0) fail('本地插件链接失败，退出码 ' + code)
  } else console.log('本库插件已链接')
  if (!args.skipShipped && Array.isArray(manifest.shippedOptional)) {
    console.log('启用当前 Harness 自带、默认关闭的可选包')
    enableShipped(dir, manifest.shippedOptional, dsh, args.dryRun)
  }
  if (args.applyPreferences) applyPreferences(dir, args.dryRun)
  console.log(args.dryRun
    ? '演练结束，没有改任何 profile。'
    : '安装完成。请重新打开 DeepSeek Harness。Grok 需要在设置里登录；WorkBuddy 账号不会从本库带过去。')
}

main()
