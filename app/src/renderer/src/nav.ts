import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Back and forward (the mouse's side buttons, Alt+← / Alt+→) through the places the player has been: the tab, Play's
 * pages, the selected profile and its step, an open mod. Each piece of such state is a `useNavState` value; every
 * change the player makes records a snapshot of the mounted values, and going back restores one. A value whose view is
 * not on screen waits until that view mounts again (switching back to the Profiles tab reopens the profile).
 */
type Snapshot = Record<string, unknown>
interface Entry { get(): unknown; set(v: unknown): void; initial: unknown }

const registry = new Map<string, Entry>()
let stack: Snapshot[] = []
let at = -1
let pending: Snapshot = {}
let restoring = false
let scheduled = false

function snapshot(): Snapshot {
  const s: Snapshot = {}
  for (const [k, e] of registry) if (e.get() !== e.initial) s[k] = e.get()
  return s
}

const same = (a: Snapshot, b: Snapshot) => {
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => a[k] === b[k])
}

/** Remembers where the player is now (once per tick, however many values changed). */
export function recordPlace(): void {
  if (restoring || scheduled) return
  scheduled = true
  // After React has mounted what the change opened, so the new view's values are part of the place.
  setTimeout(() => {
    scheduled = false
    if (restoring) return
    const s = snapshot()
    if (at >= 0 && same(stack[at], s)) return
    stack = [...stack.slice(0, at + 1), s].slice(-100)
    at = stack.length - 1
  }, 0)
}

/** The view filled in a value by itself (a default selection): it belongs to the place the player is at, no new one. */
function replacePlace(): void {
  setTimeout(() => {
    if (restoring || at < 0) return
    stack[at] = snapshot()
  }, 0)
}

function restore(s: Snapshot): void {
  restoring = true
  pending = { ...s }
  for (const [k, e] of registry) {
    e.set(k in s ? s[k] : e.initial)
    delete pending[k]
  }
  // Views that mount because of the restore take their values from `pending`; their own start-up effects do not
  // count as a new place.
  setTimeout(() => {
    restoring = false
    pending = {}
  }, 250)
}

export function goBack(): void {
  if (at <= 0) return
  at -= 1
  restore(stack[at])
}

export function goForward(): void {
  if (at >= stack.length - 1) return
  at += 1
  restore(stack[at])
}

/** Goes to a place in one step (tab and the values of the view it opens), e.g. Play's page for a mod. */
export function openPlace(values: Snapshot): void {
  for (const [k, v] of Object.entries(values)) {
    const e = registry.get(k)
    if (e) e.set(v)
    else pending[k] = v
  }
  setTimeout(() => { if (!restoring) pending = {} }, 1000)
  recordPlace()
}

/** True while a back/forward step is putting the views back; a view's own effects should not move away then. */
export const isRestoring = () => restoring

/** `useState` whose value is part of the place the player is at (see above). */
export function useNavState<T>(key: string, initial: T | (() => T)): [T, (v: T | ((prev: T) => T), how?: { replace?: boolean }) => void] {
  const first = useRef<T | undefined>(undefined)
  const [value, setValue] = useState<T>(() => {
    const def = typeof initial === 'function' ? (initial as () => T)() : initial
    first.current = def
    if (key in pending) {
      const v = pending[key] as T
      delete pending[key]
      return v
    }
    return def
  })
  const current = useRef(value)
  current.current = value
  useLayoutEffect(() => {
    const entry: Entry = {
      get: () => current.current,
      set: (v) => { current.current = v as T; setValue(v as T) },
      initial: first.current
    }
    registry.set(key, entry)
    return () => { if (registry.get(key) === entry) registry.delete(key) }
  }, [key])
  const set = useCallback((v: T | ((prev: T) => T), how?: { replace?: boolean }) => {
    const next = typeof v === 'function' ? (v as (prev: T) => T)(current.current) : v
    if (Object.is(next, current.current)) return
    current.current = next
    setValue(next)
    if (how?.replace) replacePlace()
    else recordPlace()
  }, [])
  return [value, set]
}

/** Mouse buttons 4/5 and Alt+←/→ step through the places; call once in the app. */
export function useBackForwardKeys(): void {
  useEffect(() => {
    recordPlace()
    const stop = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) e.preventDefault() }
    const up = (e: MouseEvent) => {
      if (e.button === 3) { e.preventDefault(); goBack() }
      if (e.button === 4) { e.preventDefault(); goForward() }
    }
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); goBack() }
      if (e.key === 'ArrowRight') { e.preventDefault(); goForward() }
    }
    window.addEventListener('mousedown', stop, true)
    window.addEventListener('mouseup', up, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', stop, true)
      window.removeEventListener('mouseup', up, true)
      window.removeEventListener('keydown', key)
    }
  }, [])
}
