import { useEffect, useState } from 'react'
import type { DbStopMark } from '@shared/dbstop'

/**
 * Per profile, in the app's own storage: the entries of its last start that got to the main menu (the game wrote its
 * script log), and the last database stop until the profile's next start. The game-exit handler in App.tsx writes both;
 * the load order shows the stop (ProfileEditor).
 */
const GOOD = (profileId: string) => `goodStart:${profileId}`
const STOP = (profileId: string) => `dbStop:${profileId}`
export const DBSTOP_EVENT = 'wh3lmm-dbstop'

function read<T>(key: string): T | undefined {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : undefined
  } catch {
    return undefined
  }
}
function write(key: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch { /* without storage the hint shows only as the message card */ }
  window.dispatchEvent(new Event(DBSTOP_EVENT))
}

export const lastGoodStart = (profileId: string) => read<string[]>(GOOD(profileId))
export const saveGoodStart = (profileId: string, keys: string[]) => write(GOOD(profileId), keys)
export const readDbStop = (profileId: string) => read<DbStopMark>(STOP(profileId))
export const saveDbStop = (mark: DbStopMark) => write(STOP(mark.profileId), mark)
export const clearDbStop = (profileId: string) => write(STOP(profileId), undefined)

/** The stop of this profile, kept current. */
export function useDbStop(profileId: string): DbStopMark | undefined {
  const [mark, setMark] = useState(() => readDbStop(profileId))
  useEffect(() => {
    setMark(readDbStop(profileId))
    const on = () => setMark(readDbStop(profileId))
    window.addEventListener(DBSTOP_EVENT, on)
    return () => window.removeEventListener(DBSTOP_EVENT, on)
  }, [profileId])
  return mark
}
