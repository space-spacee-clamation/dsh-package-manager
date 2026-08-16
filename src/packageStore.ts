/**
 * Centralized package store under `<home>/package-manager/runtime/packages`.
 * Git sources are mirrored once per normalized URL; per-install work
 * directories then clone from the local mirror, so installing the same plugin
 * into several workspace roots does not clone it from the remote every time.
 * File sources are snapshotted once per recursive content fingerprint.
 * @module @dsh-ext/dsh-package-manager/packageStore
 */

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GitRunner } from './source.ts'
import type { SpawnResult } from './types.ts'

export interface MaterializedGitSource {
  dir: string
  resolvedCommit: string
}

function keyOf(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 24)
}

export function gitMirrorPath(packageRoot: string, url: string): string {
  return join(packageRoot, 'git', `${keyOf(url)}.git`)
}

export function fileSnapshotPath(packageRoot: string, key: string): string {
  return join(packageRoot, 'files', `${key}.snapshot`)
}

/** Stable recursive fingerprint: path, per-file mtime, and size. */
function fingerprintFileSource(sourcePath: string): string {
  const hash = createHash('sha1')
  hash.update(sourcePath)
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childPath = join(dir, entry.name)
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        hash.update(`D:${rel}\u0000`)
        walk(childPath, rel)
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        const stat = statSync(childPath)
        hash.update(`F:${rel}\u0000${stat.mtimeMs}\u0000${stat.size}\u0000`)
      }
    }
  }
  walk(sourcePath, '')
  return hash.digest('hex').slice(0, 24)
}

function gitError(label: string, result: SpawnResult): Error {
  return new Error(`${label} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`)
}

const mirrorLocks = new Map<string, Promise<void>>()

/** Publish one mirror at a time; concurrent installs share the same clone. */
async function ensureGitMirror(mirror: string, url: string, git: GitRunner): Promise<void> {
  const pending = mirrorLocks.get(mirror)
  if (pending !== undefined) {
    await pending
    return
  }
  if (existsSync(mirror)) return
  const task = (async () => {
    if (existsSync(mirror)) return
    const clone = await git(['clone', '--mirror', '--quiet', url, mirror], dirname(mirror))
    if (clone.exitCode !== 0) throw gitError('git mirror clone', clone)
  })()
  mirrorLocks.set(mirror, task)
  try {
    await task
  } finally {
    if (mirrorLocks.get(mirror) === task) mirrorLocks.delete(mirror)
  }
}

/**
 * Clone one git source into `destination` through the local mirror cache.
 * If the mirror is missing, create it from the remote. If a local clone fails
 * (for example the mirror is stale and lacks a newly published branch), update
 * the mirror once and retry. Full-SHA requests are handled by the caller with
 * a direct clone because arbitrary SHAs are usually not fetched by a mirror.
 */
export async function cloneGitFromStore(
  packageRoot: string,
  url: string,
  targetRef: string,
  git: GitRunner,
  destination: string,
): Promise<MaterializedGitSource> {
  mkdirSync(dirname(destination), { recursive: true })
  const mirror = gitMirrorPath(packageRoot, url)
  mkdirSync(dirname(mirror), { recursive: true })

  await ensureGitMirror(mirror, url, git)

  const cloneArgs = ['clone', '--quiet']
  if (targetRef !== '') cloneArgs.push('--branch', targetRef)
  cloneArgs.push(mirror, destination)

  const first = await git(cloneArgs, dirname(destination))
  if (first.exitCode === 0) return { dir: destination, resolvedCommit: await resolveCommit(destination, git) }

  const update = await git(['remote', 'update', '--prune'], mirror)
  if (update.exitCode !== 0) throw gitError('git mirror update', update)

  rmSync(destination, { recursive: true, force: true })
  const retry = await git(cloneArgs, dirname(destination))
  if (retry.exitCode !== 0) throw gitError('git clone from package store', retry)
  return { dir: destination, resolvedCommit: await resolveCommit(destination, git) }
}

async function resolveCommit(destination: string, git: GitRunner): Promise<string> {
  const rev = await git(['rev-parse', 'HEAD'], destination)
  if (rev.exitCode !== 0) throw gitError('git rev-parse', rev)
  return rev.stdout.trim()
}

/**
 * Return a stable central snapshot for a file source. Snapshots are content
 * addressed by resolved path + recursive file mtimes and sizes; when the
 * source changes, a new snapshot is created and old snapshots remain available for
 * already-installed ledgers to keep working.
 */
export function snapshotFileSource(packageRoot: string, sourcePath: string): string {
  const snapshot = fileSnapshotPath(packageRoot, fingerprintFileSource(sourcePath))
  if (existsSync(snapshot)) return snapshot
  mkdirSync(dirname(snapshot), { recursive: true })
  const temp = `${snapshot}.${process.pid}.${Date.now()}.tmp`
  rmSync(temp, { recursive: true, force: true })
  cpSync(sourcePath, temp, { recursive: true, force: true })
  try {
    renameSync(temp, snapshot)
  } catch (error) {
    // Another DSH process may have published the same snapshot concurrently.
    rmSync(temp, { recursive: true, force: true })
    if (!existsSync(snapshot)) throw error
  }
  return snapshot
}
