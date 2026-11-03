import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { Profile } from '@shared/profile'
import type { Settings } from '@shared/api'
import type { Contribution, UserRule } from '@shared/community'

/** Small JSON files in the app's user-data folder (per user, never inside the install). */
export async function readJson<T>(name: string, fallback: T): Promise<T> {
  const file = join(app.getPath('userData'), name)
  if (!existsSync(file)) return fallback
  // A file edited by hand in a Windows editor may start with a byte-order mark (trimStart removes it).
  return JSON.parse((await readFile(file, 'utf8')).trimStart()) as T
}

export async function writeJson(name: string, value: unknown): Promise<void> {
  const file = join(app.getPath('userData'), name)
  await mkdir(dirname(file), { recursive: true })
  // Write-then-rename so a crash never leaves a half-written file behind.
  await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2), 'utf8')
  await rename(`${file}.tmp`, file)
}

export const listProfiles = () => readJson<Profile[]>('profiles.json', [])

export async function saveProfile(profile: Profile): Promise<Profile[]> {
  const all = (await listProfiles()).filter((p) => p.id !== profile.id)
  all.push({ ...profile, updatedAt: new Date().toISOString() })
  await writeJson('profiles.json', all)
  return all
}

export async function deleteProfile(id: string): Promise<Profile[]> {
  const all = (await listProfiles()).filter((p) => p.id !== id)
  await writeJson('profiles.json', all)
  return all
}

export const getSettings = () => readJson<Settings>('settings.json', {})
export const saveSettings = (s: Settings) => writeJson('settings.json', s)

export const listRules = () => readJson<UserRule[]>('rules.json', [])
export const saveRules = (rules: UserRule[]) => writeJson('rules.json', rules)

export const listContributions = () => readJson<Contribution[]>('contributions.json', [])
export async function addContribution(c: Contribution): Promise<Contribution[]> {
  const all = [...(await listContributions()), c]
  await writeJson('contributions.json', all)
  return all
}
