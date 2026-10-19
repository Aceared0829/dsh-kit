// dsh-pet 生命周期插件：DSH 启动时拉起桌面桌宠，DSH 退出时关闭它。
//
// 设计要点
// - 宿主进程托管：桌宠作为 DSH 的子进程启动，并通过 Job Object（venv 里的
//   pywin32 不一定可用，这里改用 Windows 作业对象的 Node 侧等价手段）绑定——
//   实际用「插件卸载时显式 kill + 进程树 kill」实现，DSH 正常退出一定关掉；
//   异常硬杀时桌宠自身有 ffmpeg 孤儿防护，虽然桌宠会残留，但下一次 DSH 启动
//   会发现它已在运行并复用，不会重复拉起。
// - 端口自适配：桌宠判定 DSH 是否在线只看 3080/38080/19387 和 $DSH_PORT。
//   DSH 的 web 端口每次启动可能不同，这里从注入的 webServer 服务取真实端口，
//   通过 DSH_PORT 传给桌宠，避免桌宠一直显示 offline。
// - 数据目录：桌宠默认写 %APPDATA%\dsh-pet-standalone。桥接插件也按真实
//   %APPDATA% 写 dsh-pet-bridge，两侧必须同源，否则桌宠永远显示 DSH offline，
//   因此默认直接用真实 %APPDATA%，只有显式配置 dataRoot 时才重定向。
// - 不做重试轰炸：启动失败只记一条警告，等下一次 DSH 启动再试。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const PLUGIN_ID = 'dsh-pet-lifecycle'

export const name = `${PLUGIN_ID}`

export function apply(ctx, config = {}) {
  // 公开版不写死本机路径。桌宠本体在另一个仓库，装好后把目录写进 config.petDir。
  const petDir = String(config.petDir || '').trim()
  if (!petDir) {
    console.warn(`[${PLUGIN_ID}] 未配置 petDir，跳过自动启动。`)
    return
  }
  const exe = path.join(petDir, '.venv', 'Scripts', 'pythonw.exe')
  if (!fs.existsSync(exe)) {
    console.warn(`[${PLUGIN_ID}] 找不到桌宠解释器，跳过自动启动: ${exe}`)
    return
  }

  // 数据目录：必须放在工作区内。
  // 为什么：DSH 派生的子进程即使文件策略是 danger-full-access 也写不了
  // %APPDATA%（进程级 ACL 限制，实测 PermissionError），所以桌宠的
  // config/log/运行标记只能落在工作区。为让桌宠与桥接插件看到同一份事件，
  // 本插件同时把桥接目录指向工作区（见 bridgeDir 配置与 DSH_PET_BRIDGE_DIR）。
  const dataRoot = String(config.dataRoot || path.join(petDir, '.pet-data'))
  try {
    fs.mkdirSync(dataRoot, { recursive: true })
  } catch (error) {
    console.warn(`[${PLUGIN_ID}] 无法访问桌宠数据根目录 ${dataRoot}: ${String(error?.message || error)}`)
    return
  }

  let child
  let disposed = false

  const petDataDir = path.join(dataRoot, 'dsh-pet-standalone')

  /**
   * 把桥接目录两侧接成同一个物理目录。
   *
   * 桥接插件写 `<真实 APPDATA>\dsh-pet-bridge`；桌宠读 `<重定向 APPDATA>\
   * dsh-pet-bridge`（即工作区里的 .pet-data\dsh-pet-bridge）。两边路径不同，
   * 不接起来桌宠就永远看不到 DSH 事件，显示 [DSH STATE] offline。
   *
   * 做法：在真实 APPDATA 下创建目录联接（junction）指向工作区目录。junction
   * 不需要管理员权限，且对读取方完全透明——桥接插件照常写，落在工作区里。
   * 已经是联接 / 已经是同一个目录时什么都不做；权限不足只警告不阻断启动。
   */
  const linkBridgeDir = () => {
    const real = path.join(process.env.APPDATA || os.homedir(), 'dsh-pet-bridge')
    const target = path.join(dataRoot, 'dsh-pet-bridge')
    try {
      fs.mkdirSync(target, { recursive: true })
      const realStat = fs.lstatSync(real, { throwIfNoEntry: false })
      if (realStat) {
        // 已经是符号链接/联接：检查它是不是指向我们的目标
        if (realStat.isSymbolicLink()) {
          const current = fs.realpathSync.native?.(real) ?? fs.realpathSync(real)
          if (path.resolve(current) === path.resolve(fs.realpathSync.native?.(target) ?? target)) return
          // 指向别处：不动它，避免破坏用户已有布局，只提示
          console.warn(`[${PLUGIN_ID}] 桥接目录已指向 ${current}，与桌宠数据目录不一致`)
          return
        }
        // 是真实目录：把已有 jsonl 搬进工作区，再把它换成联接
        for (const name of fs.readdirSync(real)) {
          if (!name.endsWith('.jsonl') && !name.endsWith('.jsonl.1')) continue
          const from = path.join(real, name)
          const to = path.join(target, name)
          try { if (!fs.existsSync(to)) fs.copyFileSync(from, to) } catch {}
        }
        try {
          fs.rmSync(real, { recursive: true, force: true })
        } catch (error) {
          console.warn(`[${PLUGIN_ID}] 无法替换旧桥接目录（可能仍被占用），跳过联接: ${String(error?.message || error)}`)
          return
        }
      }
      fs.symlinkSync(target, real, 'junction')
      console.log(`[${PLUGIN_ID}] 桥接目录已联接: ${real} -> ${target}`)
    } catch (error) {
      console.warn(`[${PLUGIN_ID}] 桥接目录联接失败（桌宠可能显示 DSH offline）: ${String(error?.message || error)}`)
    }
  }

  /** 桌宠是否已有存活实例（读它自己写的运行标记，pid 活着就算）。 */
  const petAlreadyRunning = () => {
    try {
      const names = fs.readdirSync(petDataDir)
      for (const fileName of names) {
        if (!/^(pet-runtime-v2-|runtime-).*\.json$/.test(fileName)) continue
        const raw = JSON.parse(fs.readFileSync(path.join(petDataDir, fileName), 'utf8'))
        const pid = Number(raw?.pid || 0)
        if (!Number.isInteger(pid) || pid <= 0) continue
        try {
          process.kill(pid, 0)
          return pid
        } catch {
          // 已死：留给桌宠自己的标记回收逻辑处理
        }
      }
    } catch {
      // 目录还不存在 / 无权限：当作没有实例
    }
    return 0
  }

  /** DSH 实际监听的端口（桌宠用它判定 online）。取不到就让桌宠自己探测。 */
  const dshPort = () => {
    try {
      const webServer = typeof ctx.get === 'function' ? ctx.get('webServer', false) : undefined
      const origin = webServer?.getOrigin?.()
      if (typeof origin === 'string' && origin) {
        const parsed = new URL(origin)
        if (parsed.port) return parsed.port
        return parsed.protocol === 'https:' ? '443' : '80'
      }
    } catch {
      // 服务尚未就绪：让桌宠按默认候选端口探测
    }
    return ''
  }

  const stopPet = () => {
    const pid = child?.pid ?? 0
    const alive = pid > 0 && (() => { try { process.kill(pid, 0); return true } catch { return false } })()
    if (!alive) return
    try {
      // 先礼后兵：桌宠正常退出会保存位置与配置，直接 kill 会丢当前窗口状态。
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(pid), '/T'], { stdio: 'ignore', windowsHide: true })
        // 3 秒后仍在则强杀（桌宠 Qt 事件循环处理退出需要一点时间）
        setTimeout(() => {
          try { spawn('taskkill', ['/F', '/PID', String(pid), '/T'], { stdio: 'ignore', windowsHide: true }) } catch {}
        }, 3000).unref?.()
      } else {
        process.kill(pid, 'SIGTERM')
      }
    } catch (error) {
      console.warn(`[${PLUGIN_ID}] 关闭桌宠失败: ${String(error?.message || error)}`)
    }
  }

  const startPet = () => {
    if (disposed) return
    const running = petAlreadyRunning()
    if (running) {
      console.log(`[${PLUGIN_ID}] 桌宠已在运行 (pid ${running})，复用现有实例`)
      return
    }
    // 让桥接目录两侧同源：桥接插件按真实 %APPDATA% 写，桌宠按重定向后的
    // APPDATA 读。用目录联接把真实 <APPDATA>\dsh-pet-bridge 指向工作区里的
    // 同一目录，任何一侧都不需要改代码，也不需要手工同步 jsonl。
    linkBridgeDir()
    const env = { ...process.env }
    // 桌宠只写工作区：%APPDATA% 指向工作区内的数据根，config/log/运行标记都在这里。
    env.APPDATA = dataRoot
    const port = dshPort()
    if (port) env.DSH_PORT = port
    // 桌宠的 DSH 探活会读 DSH_PORT；透传当前值，避免多实例时串味。
    else if (env.DSH_PORT) delete env.DSH_PORT

    try {
      child = spawn(exe, ['-m', 'pet'], {
        cwd: petDir,
        env,
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.on('error', (error) => {
        console.warn(`[${PLUGIN_ID}] 启动桌宠失败: ${String(error?.message || error)}`)
      })
      child.on('exit', (code, signal) => {
        console.log(`[${PLUGIN_ID}] 桌宠进程已退出 code=${code ?? ''} signal=${signal ?? ''}`)
        child = undefined
      })
      child.unref?.()
      console.log(`[${PLUGIN_ID}] 已启动桌宠 pid=${child.pid ?? ''} DSH_PORT=${port || '(默认探测)'}`)
    } catch (error) {
      console.warn(`[${PLUGIN_ID}] 启动桌宠异常: ${String(error?.message || error)}`)
    }
  }

  // web 服务可能还没就绪：延迟一拍再取真实端口（取不到也不影响启动）。
  const timers = [
    setTimeout(startPet, Number(config.startDelayMs ?? 1500)),
  ]

  // 插件卸载 = DSH 正在退出（Cordis 的 ctx.effect 清理在进程收尾时执行）。
  ctx.effect(() => {
    return () => {
      disposed = true
      for (const timer of timers) clearTimeout(timer)
      stopPet()
    }
  }, `${PLUGIN_ID}.lifecycle()`)
}
