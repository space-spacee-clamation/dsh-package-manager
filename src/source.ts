/**
 * Source resolution: detect what a source string means and materialize git and
 * filesystem sources into a stable per-install snapshot for probing and
 * custom adapters. npm names pass through to pnpm untouched. Git and file
 * source material is cached centrally under `<home>/package-manager/runtime/
 * packages` so multiple plugin workspaces never trigger repeated remote
 * clones.
 * @module @dsh-ext/dsh-package-manager/source
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cloneGitFromStore, snapshotFileSource } from './packageStore.ts'
import { isAbsolutePath } from './paths.ts'
import { quoteShellArg } from './process.ts'
import type { SourceKind, SpawnResult } from './types.ts'

export type GitRunner = (args: string[], cwd: string) => Promise<SpawnResult>

export function defaultGitRunner(): GitRunner {
  return async (args, cwd) => {
    const shell = process.platform === 'win32'
    const argv = [...args]
    const commandText = shell && argv.length > 0
      ? ['git', ...argv].map(quoteShellArg).join(' ')
      : 'git'
    const result = spawnSync(commandText, shell ? [] : argv, { cwd, encoding: 'utf8', shell, windowsHide: true })
    const status = result.status ?? 1
    const error = result.error
    if (error !== undefined) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('git not found on PATH')
      throw new Error(`git failed to start: ${String(error.message ?? error)}`)
    }
    return { exitCode: status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
  }
}

/** Parse a `github:owner/repo#ref` shorthand into an https URL and ref. */
export function parseGithubSpec(source: string): { url: string; ref: string } | undefined {
  const match = /^github:([^#]+?)(?:#(.+))?$/.exec(source)
  if (match === null) return undefined
  const [, repo] = match
  if (repo === undefined || !repo.includes('/')) return undefined
  return { url: `https://github.com/${repo}.git`, ref: match[2] ?? '' }
}

export function detectSourceKind(source: string): SourceKind {
  if (parseGithubSpec(source) !== undefined) return 'git'
  if (/^git\+|^git:|^ssh:\/\//.test(source)) return 'git'
  if (/^https?:\/\//.test(source)) {
    return /(^|\/)(github\.com|gitlab\.com|gitlab\.[^/]+|bitbucket\.org)\/|\.git(?:#.*)?$/.test(source) ? 'git' : 'npm'
  }
  if (isAbsolutePath(source) || source.startsWith('.') || source.startsWith('file:') || source.startsWith('link:')) return 'file'
  return 'npm'
}

export interface MaterializedSource {
  kind: SourceKind
  /** Absolute snapshot directory (git clone or file copy); empty for npm. */
  dir: string
  resolvedCommit: string
}

function isFullSha(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value)
}

/**
 * Materialize a git/file source into `workDir/source`. Git clones go through
 * the centralized package store; file sources are copied from a centralized
 * snapshot so probing sees one stable snapshot while the pnpm dependency
 * still points at the user-supplied original path (matching `dsh plugin`
 * semantics).
 * @param workDir - per-install scratch directory.
 * @param source - verbatim source spec.
 * @param ref - requested branch/tag/commit (empty = remote default).
 * @param git - git runner seam.
 * @param packageRoot - centralized package store root.
 */
export async function materializeSource(
  workDir: string,
  source: string,
  ref: string,
  git: GitRunner,
  packageRoot: string,
): Promise<MaterializedSource> {
  const kind = detectSourceKind(source)
  if (kind === 'npm') return { kind, dir: '', resolvedCommit: '' }
  mkdirSync(workDir, { recursive: true })
  mkdirSync(packageRoot, { recursive: true })
  const dir = join(workDir, 'source')

  if (kind === 'git') {
    const github = parseGithubSpec(source)
    const url = github?.url ?? source.replace(/^git\+/, '')
    const targetRef = github !== undefined && github.ref !== '' ? github.ref : ref
    if (isFullSha(targetRef)) {
      // Mirror clones fetch advertised refs, not arbitrary SHAs. Full-SHA
      // installs keep the previous complete direct clone.
      const args = ['clone', '--quiet', url, dir]
      const clone = await git(args, workDir)
      if (clone.exitCode !== 0) throw new Error(`git clone failed (exit ${clone.exitCode}): ${clone.stderr || clone.stdout}`)
      const rev = await git(['rev-parse', 'HEAD'], dir)
      if (rev.exitCode !== 0) throw new Error(`git rev-parse failed (exit ${rev.exitCode}): ${rev.stderr || rev.stdout}`)
      return { kind, dir, resolvedCommit: rev.stdout.trim() }
    }
    const materialized = await cloneGitFromStore(packageRoot, url, targetRef, git, dir)
    return { kind, dir, resolvedCommit: materialized.resolvedCommit }
  }

  const resolved = resolve(source.replace(/^file:/, ''))
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`file source is not a directory: ${resolved}`)
  }
  const snapshot = snapshotFileSource(packageRoot, resolved)
  cpSync(snapshot, dir, { recursive: true, force: true })
  return { kind, dir, resolvedCommit: '' }
}
