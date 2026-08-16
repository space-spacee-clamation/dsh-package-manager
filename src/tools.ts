/**
 * `package-manager-tools` loader row. Registers `pm_install` and
 * `pm_scaffold` for the model. The tools are global (every web agent can see
 * them), but they only act on workspaces created by the settings tab: the
 * session cwd must contain a `package-manager.json` manifest written by
 * `/pm-api/ai-install`. This keeps the AI installation in-process, so the
 * Cordis hot-plug seam in `src/runtime.ts` actually runs.
 * @module @dsh-ext/dsh-package-manager/tools
 */

import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InstallResult } from './types.ts'
import { readWorkspaceManifest } from './pluginWorkspace.ts'
import type {} from './index.ts'

export const name = 'package-manager-tools'

export const inject = ['packageManager', 'tools']

export function apply(ctx: Context): void {
  const service = ctx.packageManager
  ctx.tools.register(defineTool({
    name: 'pm_install',
    description:
      'Install a DSH plugin from the package-manager settings task. Call it from the plugin workspace '
      + 'session created by the "派发给 AI 安装" action. The install runs inside this process; '
      + 'dsh-bundle plugins are hot-mounted through Cordis immediately. If the tool reports that a '
      + 'custom adapter is required, call pm_scaffold, edit the generated adapter.yaml, then call '
      + 'pm_install again with adapter="custom" and adapterDir=<adapter directory>.',
    parameters: {
      adapter: {
        type: 'string',
        enum: ['auto', 'dsh-bundle', 'custom'],
        description: 'Adapter choice. Defaults to auto detection.',
      },
      adapterDir: {
        type: 'string',
        description: 'Absolute adapter directory, only for adapter="custom".',
      },
      ref: {
        type: 'string',
        description: 'Optional git branch/tag/commit.',
      },
      allowBuild: {
        type: 'boolean',
        description: 'Whether the isolated .venv may run pnpm build scripts. Defaults to false.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          profile: { type: 'string', required: true },
          id: { type: 'string', required: true },
          adapter: { type: 'string', required: true },
          packageName: { type: 'string', required: true },
          hotMounted: { type: 'boolean', required: true },
          workspacePath: { type: 'string', required: true },
          logs: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `Installed ${value.id} (${value.adapter}, ${value.hotMounted ? 'hot-mounted, no restart needed' : 'restart required'}): ${value.logs.join('\n')}`
          : `Install failed: ${value.logs.join('\n')}`,
      }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined) throw new Error('pm_install must be called from an agent session with a cwd')
      const manifest = readWorkspaceManifest(cwd)
      if (manifest === undefined) {
        throw new Error(`pm_install only runs inside a package-manager plugin workspace (${cwd} has no package-manager.json)`)
      }
      const adapter = typeof args.adapter === 'string' ? args.adapter : 'auto'
      const source = resolveSourceFor(cwd, manifest.source)
      const result = await service.manager.install({
        profile: manifest.profile,
        id: manifest.id,
        source,
        adapter: adapter === 'custom' ? 'custom' : adapter === 'dsh-bundle' ? 'dsh-bundle' : 'auto',
        ...(typeof args.adapterDir === 'string' && args.adapterDir !== '' ? { adapterDir: args.adapterDir } : {}),
        ...(typeof args.ref === 'string' && args.ref !== '' ? { ref: args.ref } : {}),
        allowBuild: args.allowBuild === true,
      })
      return toolInstallValue(result)
    },
    presentCall: () => ({
      card: 'terminal',
      title: 'Package manager',
      description: 'Installing plugin into the workspace .venv',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'pm_scaffold',
    description:
      'Generate a requirements entry and custom adapter scaffold for a plugin the built-in dsh-bundle '
      + 'adapter cannot install. Call it from the plugin workspace session. The adapter is written to '
      + '<workspace>/requirements/adapters/<id>/adapter.yaml; edit it, then call pm_install with '
      + 'adapter="custom" and that adapterDir.',
    parameters: {
      ref: {
        type: 'string',
        description: 'Optional git branch/tag/commit.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          adapter: { type: 'string', required: true },
          adapterDir: { type: 'string', required: true },
          reason: { type: 'string', required: true },
          logs: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `Scaffolded ${value.adapter} adapter at ${value.adapterDir}: ${value.reason}`
          : `Scaffold failed: ${value.logs.join('\n')}`,
      }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined) throw new Error('pm_scaffold must be called from an agent session with a cwd')
      const manifest = readWorkspaceManifest(cwd)
      if (manifest === undefined) {
        throw new Error(`pm_scaffold only runs inside a package-manager plugin workspace (${cwd} has no package-manager.json)`)
      }
      const source = resolveSourceFor(cwd, manifest.source)
      const result = service.manager.adapterInit({
        source,
        id: manifest.id,
        outDir: cwd,
        profile: manifest.profile,
        ...(typeof args.ref === 'string' && args.ref !== '' ? { ref: args.ref } : {}),
      })
      return {
        ok: true,
        adapter: result.adapter,
        adapterDir: result.adapter === 'custom' ? join(cwd, 'requirements', 'adapters', manifest.id) : '',
        reason: result.reason,
        logs: result.logs.map(line => `[${line.level}] ${line.message}`),
      }
    },
  }))
}

function resolveSourceFor(cwd: string, source: string): string {
  return isAbsolute(source) || /^[A-Za-z]:[\/]/.test(source) || /^[A-Za-z]:$/.test(source) ? source : resolve(cwd, source)
}

function toolInstallValue(result: InstallResult): {
  ok: boolean
  profile: string
  id: string
  adapter: string
  packageName: string
  hotMounted: boolean
  workspacePath: string
  logs: string[]
} {
  return {
    ok: true,
    profile: result.profile,
    id: result.id,
    adapter: result.adapter,
    packageName: result.packageName,
    hotMounted: result.hotMounted,
    workspacePath: result.workspaceDir,
    logs: result.logs.map(line => `[${line.level}] ${line.message}`),
  }
}

