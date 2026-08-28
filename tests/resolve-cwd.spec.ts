import { describe, expect, it, vi } from 'vitest'
import { resolveSessionCwd } from '../src/resolve-cwd.ts'

describe('resolveSessionCwd', () => {
  it('prefers the live session header cwd', async () => {
    const inspect = vi.fn()
    const cwd = await resolveSessionCwd(
      { header: { cwd: '/repo' } },
      's1',
      { inspect: inspect as never },
    )
    expect(cwd).toBe('/repo')
    expect(inspect).not.toHaveBeenCalled()
  })

  it('falls through an empty header cwd to the persistence index', async () => {
    const cwd = await resolveSessionCwd(
      { header: { cwd: '' } },
      's1',
      { inspect: () => Promise.resolve({ meta: { cwd: '/persisted' } }) },
    )
    expect(cwd).toBe('/persisted')
  })

  it('falls through a missing header to the persistence index', async () => {
    const cwd = await resolveSessionCwd(
      undefined,
      'cold-session',
      { inspect: () => Promise.resolve({ meta: { cwd: '/cold' } }) },
    )
    expect(cwd).toBe('/cold')
  })

  it('ignores a persistence failure and reaches the process cwd', async () => {
    const cwd = await resolveSessionCwd(
      { header: {} },
      's1',
      { inspect: () => Promise.reject(new Error('index gone')) },
    )
    expect(cwd).toBe(process.cwd())
  })

  it('ignores a relative persisted cwd and reaches the process cwd', async () => {
    const cwd = await resolveSessionCwd(
      { header: {} },
      's1',
      { inspect: () => Promise.resolve({ meta: { cwd: 'relative/path' } }) },
    )
    expect(cwd).toBe(process.cwd())
  })

  it('returns the process cwd when no source is available', async () => {
    expect(await resolveSessionCwd({ header: {} }, 's1', undefined)).toBe(process.cwd())
  })
})
