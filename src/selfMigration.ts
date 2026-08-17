/**
 * One-time self migration: move dsh-package-manager itself from the host-owned
 * `dsh.profile.bundles` layer into its own managed block in the profile's
 * `cordis.patch.yml`. After this file edit the next profile boot mounts this
 * package from the user patch layer, so future source changes can be applied
 * by the official watchUserPatches path.
 */

import { managedPatchForPackage, writeManagedPatch } from './profilePatch.ts'
import { readManifest, writeManifest } from './profile.ts'
import { profileDir } from './paths.ts'

export interface SelfMigrationResult {
  profile: string
  patchPath: string
  removedFromBundles: boolean
  rowIds: string[]
}

export function migratePackageManagerSelf(
  home: string,
  packageManagerDir: string,
  profile = 'web',
): SelfMigrationResult {
  const dir = profileDir(home, profile)
  const managed = managedPatchForPackage(packageManagerDir, profile, 'package-manager')
  if (managed === undefined) {
    throw new Error(`package-manager bundle patch not found in ${packageManagerDir}`)
  }
  const written = writeManagedPatch(dir, 'package-manager', managed.entries, false, managed.rowIds)
  const manifest = readManifest(dir)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const next = bundles.filter(name => name !== '@dsh-ext/dsh-package-manager')
  const removed = next.length !== bundles.length
  if (removed) {
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: next } }
    writeManifest(dir, manifest)
  }
  return {
    profile,
    patchPath: written.path,
    removedFromBundles: removed,
    rowIds: [...managed.rowIds],
  }
}
