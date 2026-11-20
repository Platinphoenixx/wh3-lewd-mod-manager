import { describe, expect, it } from 'vitest'
import { progressText, timeLeft } from './progress'

describe('download progress text', () => {
  it('says percent, size, speed and time left', () => {
    const p = progressText({ name: 'CB Resources.7z', got: 1.24e9, total: 2.1e9, speed: 3.4e6, idle: 0 })
    expect(p.percent).toBe('59 %')
    expect(p.head).toBe('Downloading “CB Resources.7z” – 1.24 of 2.10 GB')
    expect(p.line.startsWith('3.4 MB/s · about 4 min left · ')).toBe(true)
    expect(p.title).toBe('Downloading · 59 % · 3.4 MB/s · about 4 min left')
    expect(p.warn).toBeUndefined()
  })

  it('warns after a minute without data, and drops speed and time left then', () => {
    const p = progressText({ name: 'x.7z', got: 5e8, total: 1e9, speed: 2e6, idle: 61_000 })
    expect(p.title).toBe('Download paused? 50 %')
    expect(p.warn).toMatch(/^No data for 1 minute – /)
    expect(p.line).not.toMatch(/MB\/s/)
  })

  it('shows what arrived when the site does not say the size', () => {
    const p = progressText({ name: 'x.pack', got: 3.2e8, total: 0, speed: 1e6, idle: 0 })
    expect(p.percent).toBe('320 MB')
    expect(p.fraction).toBeUndefined()
  })

  it('rounds the time left', () => {
    expect(timeLeft(30)).toBe('less than a minute left')
    expect(timeLeft(11 * 60)).toBe('about 11 min left')
    expect(timeLeft(3 * 3600)).toBe('about 3 h left')
  })
})
