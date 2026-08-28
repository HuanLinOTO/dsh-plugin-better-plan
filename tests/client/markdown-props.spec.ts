import { describe, expect, it } from 'vitest'
import { markdownChromeLabels, markdownTextProps } from '../../src/client/markdown-props.ts'

describe('markdownTextProps (dual-generation chrome labels)', () => {
  it('builds the nested 0.1.2-alpha.1 shape from the flat pair', () => {
    const labels = markdownChromeLabels({ copyLabel: 'Copy', copiedLabel: 'Copied' })
    expect(labels).toEqual({
      copyLabel: 'Copy',
      copiedLabel: 'Copied',
      code: { copyLabel: 'Copy', copiedLabel: 'Copied' },
      footnotes: '',
    })
  })

  it('passes the labels under BOTH prop names so either host generation reads its own', () => {
    const props = markdownTextProps('# Hi', { copyLabel: 'Copy', copiedLabel: 'Copied' }) as unknown as Record<string, unknown>
    expect(props.text).toBe('# Hi')
    // The flat optional prop (0.1.1-rc.x readers)...
    expect(props.codeLabels).toEqual({
      copyLabel: 'Copy', copiedLabel: 'Copied',
      code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: '',
    })
    // ...and the required nested prop (0.1.2-alpha.1+ readers).
    expect(props.labels).toEqual(props.codeLabels)
  })
})
