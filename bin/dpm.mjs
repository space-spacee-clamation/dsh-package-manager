#!/usr/bin/env node
/**
 * dpm — standalone command-line face for the dsh-package-manager core.
 * The Web settings tab is the primary surface; this bin lets scripts and
 * headless workflows drive install/uninstall/restore/sync without a browser.
 *
 * Usage:
 *   node bin/dpm.mjs state
 *   node bin/dpm.mjs install --profile web --source github:owner/repo [--adapter auto] [--allow-build]
 *   node bin/dpm.mjs uninstall --profile web --id plugin-id
 *   node bin/dpm.mjs restore --file ./requirements/deps.yaml [--modes web,headless] [--dry-run]
 *   node bin/dpm.mjs sync --repo . [--file ./requirements/deps.yaml]
 *   node bin/dpm.mjs adapter-init --source <repo> --id plugin-id --out-dir .
 */

import { createPackageManager } from '../lib/index.js'
import { request as httpRequest } from 'node:http'

const [command, ...args] = process.argv.slice(2)

function valueOf(flags) {
  const flag = args.findIndex(argument => argument === flags[0] || argument === flags[1])
  if (flag < 0 || flag + 1 >= args.length) return undefined
  return args[flag + 1]
}

function has(flags) {
  return args.some(argument => flags.includes(argument))
}

function boolOf(flags) {
  const next = valueOf(flags)
  if (next === undefined) return has(flags)
  return !/^(0|false|no)$/i.test(next)
}

function print(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

function printLogs(result) {
  for (const line of result?.logs ?? []) {
    process.stderr.write(`[${line.level}] ${line.message}\n`)
  }
}

async function main() {
  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(`dpm — dsh-package-manager CLI
  state
  install   --profile <name> --source <spec> [--id <id>] [--adapter auto|dsh-bundle|custom]
            [--adapter-dir <dir>] [--ref <ref>] [--allow-build] [--dry-run]
  uninstall --profile <name> --id <id> [--dry-run]
  restore   --file <requirements.yaml> [--modes a,b] [--dry-run]
  sync      --repo <path> [--file <requirements.yaml>] [--modes a,b] [--dry-run]
  switch    --path <workspace-root> [--dry-run]
  doctor    repair home state: prune unresolvable bundle rows, dangling links, stale ledger records
  adapter-init --source <spec> --id <id> --out-dir <dir> [--profile web] [--ref <ref>]
  config      [--workspace-root <dir>] [--storage-path <dir>] [--remote-url <url>] [--auto-sync]
  sync-configured
  disable     --profile <name> --id <id>
  enable      --profile <name> --id <id>
`)
    return
  }

  const manager = createPackageManager()
  switch (command) {
    case 'state':
      print(manager.state())
      return
    case 'doctor':
      print(await manager.doctor())
      return
    case 'install': {
      const result = await manager.install({
        profile: valueOf(['--profile', '-p']) ?? 'web',
        id: valueOf(['--id']),
        source: valueOf(['--source', '-s']) ?? '',
        adapter: (valueOf(['--adapter']) ?? 'auto'),
        adapterDir: valueOf(['--adapter-dir']),
        ref: valueOf(['--ref']),
        allowBuild: boolOf(['--allow-build']),
        dryRun: boolOf(['--dry-run']),
      })
      printLogs(result)
      print(result)
      return
    }
    case 'uninstall': {
      const result = await manager.uninstall({
        profile: valueOf(['--profile', '-p']) ?? 'web',
        id: valueOf(['--id', '-i']) ?? '',
        dryRun: boolOf(['--dry-run']),
      })
      printLogs(result)
      print(result)
      return
    }
    case 'switch': {
      const result = await manager.switchWorkspace(valueOf(['--path', '-p']) ?? '', boolOf(['--dry-run']))
      printLogs(result)
      print(result)
      return
    }
    case 'restore': {
      const result = await manager.restore({
        file: valueOf(['--file', '-f']) ?? '',
        modes: (valueOf(['--modes']) ?? '').split(',').map(mode => mode.trim()).filter(mode => mode !== ''),
        dryRun: boolOf(['--dry-run']),
      })
      printLogs(result)
      print(result)
      return
    }
    case 'sync': {
      const result = await manager.sync({
        repo: valueOf(['--repo', '-r']) ?? '.',
        file: valueOf(['--file', '-f']),
        modes: (valueOf(['--modes']) ?? '').split(',').map(mode => mode.trim()).filter(mode => mode !== ''),
        dryRun: boolOf(['--dry-run']),
      })
      printLogs(result)
      print(result)
      return
    }
    case 'adapter-init': {
      const result = await manager.adapterInit({
        source: valueOf(['--source', '-s']) ?? '',
        id: valueOf(['--id', '-i']) ?? '',
        outDir: valueOf(['--out-dir', '-o']) ?? '.',
        profile: valueOf(['--profile', '-p']),
        ref: valueOf(['--ref']),
      })
      printLogs(result)
      print(result)
      return
    }
    case 'config': {
      const current = manager.getConfig()
      const next = {
        workspaceRoot: valueOf(['--workspace-root']) ?? current.workspaceRoot,
        storagePath: valueOf(['--storage-path']) ?? current.storagePath,
        remoteUrl: valueOf(['--remote-url']) ?? current.remoteUrl,
        autoSync: valueOf(['--auto-sync']) === undefined ? current.autoSync : boolOf(['--auto-sync']),
      }
      print(manager.setConfig(next))
      return
    }
    case 'sync-configured': {
      const result = await manager.syncConfigured()
      printLogs(result)
      print(result)
      return
    }
    case 'disable': {
      const result = await manager.disable({
        profile: valueOf(['--profile', '-p']) ?? 'web',
        id: valueOf(['--id', '-i']) ?? '',
      })
      printLogs(result)
      print(result)
      return
    }
    case 'enable': {
      const result = await manager.enable({
        profile: valueOf(['--profile', '-p']) ?? 'web',
        id: valueOf(['--id', '-i']) ?? '',
      })
      printLogs(result)
      print(result)
      return
    }
    case 'restart': {
      // Ask the running backend (if any) to restart itself: the backend
      // spawns a detached restarter, answers, then exits gracefully — the
      // restarter relaunches it once the port frees. No manual killing.
      const port = Number.parseInt(process.env.DSH_PM_PORT ?? '3080', 10)
      const payload = JSON.stringify({})
      const req = httpRequest({
        host: '127.0.0.1',
        port,
        path: '/pm-api/restart',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'x-dsh-pm': '1',
        },
      }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          console.log(`dpm: backend answered ${res.statusCode}`)
          console.log(body)
        })
      })
      req.on('error', (error) => {
        throw new Error(`backend not reachable on 127.0.0.1:${port} — start the backend first, then run "dpm restart" from inside it (or use the pm_restart_backend tool)` + `: ${error.message}`)
      })
      req.end(payload)
      return
    }

    default:
      throw new Error(`unknown command ${JSON.stringify(command)} — run "dpm --help"`)
  }
}

main().catch((error) => {
  process.stderr.write(`dpm: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
