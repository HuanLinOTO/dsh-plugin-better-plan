import { describe, expect, it } from 'vitest'
import { basenameOf, firstHeading } from '../src/first-heading.ts'

describe('firstHeading', () => {
  it('extracts the first heading of any level (same regex as the built-in exit tool)', () => {
    expect(firstHeading('# Title\n\nbody')).toBe('Title')
    expect(firstHeading('intro\n## Fix the flake\n### deeper')).toBe('Fix the flake')
    expect(firstHeading('###### six')).toBe('six')
  })

  it('trims heading text and tolerates surrounding blank lines', () => {
    expect(firstHeading('##  spaced title  \n')).toBe('spaced title')
    expect(firstHeading('\n\n# after blank\n')).toBe('after blank')
  })

  it('rejects seven hashes, bare hashes, hash without space, and indented lines', () => {
    expect(firstHeading('####### seven\n# real')).toBe('real')
    expect(firstHeading('#\n# real')).toBe('real')
    expect(firstHeading('#nospace\n# real')).toBe('real')
    expect(firstHeading('  ## indented is not a heading\n# real')).toBe('real')
  })

  it('is fence-blind exactly like the built-in (a # line inside a fence still matches)', () => {
    // The built-in exit tool scans lines without fence tracking; this keeps
    // both tools' titles identical for the same plan.
    expect(firstHeading('```sh\n# looks like a heading\n```')).toBe('looks like a heading')
  })

  it('returns undefined without any heading', () => {
    expect(firstHeading('')).toBeUndefined()
    expect(firstHeading('plain text\nmore text')).toBeUndefined()
  })
})

describe('basenameOf', () => {
  it('splits POSIX and Windows paths', () => {
    expect(basenameOf('/a/b/plan.md')).toBe('plan.md')
    expect(basenameOf('C:\\a\\b\\plan.md')).toBe('plan.md')
    expect(basenameOf('docs/plans')).toBe('plans')
  })

  it('drops trailing separators and keeps bare names', () => {
    expect(basenameOf('/a/b/')).toBe('b')
    expect(basenameOf('plan.md')).toBe('plan.md')
    expect(basenameOf('')).toBe('')
  })
})
