/**
 * Inline SVG icon for the Plan tab (client bundles must not value-import
 * other plugins' internals, and a one-glyph icon does not justify a
 * react-icons dependency).
 *
 * @module @huanlin/dsh-plugin-better-plan/client/icons
 */

import { createElement } from 'react'

/**
 * The Plan tab glyph: a checklist document.
 * @param props - size in pixels.
 * @returns the icon element.
 */
export function IconPlanOutline16(props: { size: number }): ReturnType<typeof createElement> {
  return createElement(
    'svg',
    {
      width: props.size,
      height: props.size,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    },
    createElement('path', { d: 'M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5l-3.5-3.5Z' }),
    createElement('path', { d: 'M9.5 1.5V5H13' }),
    createElement('path', { d: 'M5.5 8.5 6.5 9.5 8.5 7' }),
    createElement('path', { d: 'M5.5 11.5h5' }),
  )
}
