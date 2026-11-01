import { describe, expect, it } from 'vitest'
import { isNewerVersion } from './version'

describe('app versions', () => {
  it('compares release versions number by number', () => {
    expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true)
    expect(isNewerVersion('0.10.0', '0.9.3')).toBe(true)
    expect(isNewerVersion('v0.1.0', '0.1.0')).toBe(false)
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(false)
  })

  it('ignores pre-releases and anything that is not a version', () => {
    expect(isNewerVersion('v0.3.0-beta', '0.1.0')).toBe(false)
    expect(isNewerVersion('latest', '0.1.0')).toBe(false)
  })
})
