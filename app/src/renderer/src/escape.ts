import { useEffect, useRef } from 'react'

/**
 * Esc closes what is open on top: a picture, then the mod's page, then a dialog under it – one per key press. While the
 * player types in a field, Esc belongs to the field (it clears a search there) and closes nothing, so no text is lost.
 */
const stack: { current: () => void }[] = []

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !stack.length) return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  e.preventDefault()
  stack[stack.length - 1].current()
})

export function useEscape(close: () => void, active = true): void {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => {
    if (!active) return
    stack.push(ref)
    return () => {
      const i = stack.lastIndexOf(ref)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}
