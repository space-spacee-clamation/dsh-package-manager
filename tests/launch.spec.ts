import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRestartScript, launchPath, readLaunch, recordLaunch } from '../src/launch.ts'

const roots: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-launch-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('launch records and restarter scripts', () => {
  it('records and reads back the launch command verbatim', () => {
    const home = tempDir()
    const record = recordLaunch(home, 3080, ['--profile', 'web'], 'D:/work')
    expect(record.command).toContain('node')
    expect(record.command).toContain('--profile')
    expect(record.port).toBe(3080)
    const read = readLaunch(home)
    expect(read?.command).toBe(record.command)
    expect(read?.cwd).toBe('D:/work')
    expect(launchPath(home)).toContain('launch.json')
  })

  it('returns undefined for absent or corrupt launch records', () => {
    const home = tempDir()
    expect(readLaunch(home)).toBeUndefined()
    const fs = require('node:fs') as typeof import('node:fs')
    fs.mkdirSync(join(launchPath(home), '..'), { recursive: true })
    fs.writeFileSync(launchPath(home), '{ not json')
    expect(readLaunch(home)).toBeUndefined()
  })

  it('builds a restarter that probes the port and relaunches the command', () => {
    const home = tempDir()
    const log = join(home, 'restart.log')
    const script = buildRestartScript(3080, 'node -e "console.log(1)"', log)
    expect(script).toContain('const port = 3080')
    expect(script).toContain('console.log(1)')
    expect(script).toContain(JSON.stringify(log))
    expect(script).toContain('cp.spawn(cmd')
    // The script must be valid JS.
    expect(() => new Function(script)).not.toThrow()
  })
})
