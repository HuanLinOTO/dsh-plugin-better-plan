import { describe, expect, it, vi } from 'vitest'
import { resolveSessionCwd } from '../src/resolve-cwd.ts'

describe('resolveSessionCwd', () => {
  it('prefers the live session header cwd', async () => {
    const stat = vi.fn()
    const cwd = await resolveSessionCwd(
      { header: { cwd: '/repo' } },
      's1',
      { stat: stat as never },
    )
    expect(cwd).toBe('/repo')
    expect(stat).not.toHaveBeenCalled()
  })

  it('falls through an empty header cwd to the persistence snapshot', async () => {
    const cwd = await resolveSessionCwd(
      { header: { cwd: '' } },
      's1',
      { stat: () => Promise.resolve({ header: { cwd: '/persisted' } }) },
    )
    expect(cwd).toBe('/persisted')
  })

  it('falls through a missing header to the persistence snapshot', async () => {
    const cwd = await resolveSessionCwd(
      undefined,
      'cold-session',
      { stat: () => Promise.resolve({ header: { cwd: '/cold' } }) },
    )
    expect(cwd).toBe('/cold')
  })

  it('ignores a persistence failure and reaches the process cwd', async () => {
    const cwd = await resolveSessionCwd(
      { header: {} },
      's1',
      { stat: () => Promise.reject(new Error('index gone')) },
    )
    expect(cwd).toBe(process.cwd())
  })

  it('ignores a relative persisted cwd and reaches the process cwd', async () => {
    const cwd = await resolveSessionCwd(
      { header: {} },
      's1',
      { stat: () => Promise.resolve({ header: { cwd: 'relative/path' } }) },
    )
    expect(cwd).toBe(process.cwd())
  })

  it('ignores an unknown session (undefined snapshot) and reaches the process cwd', async () => {
    const cwd = await resolveSessionCwd(
      { header: {} },
      's1',
      { stat: () => Promise.resolve(undefined) },
    )
    expect(cwd).toBe(process.cwd())
  })

  it('returns the process cwd when no source is available', async () => {
    expect(await resolveSessionCwd({ header: {} }, 's1', undefined)).toBe(process.cwd())
  })
})
