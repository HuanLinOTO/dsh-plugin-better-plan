/**
 * Inline SVG icon for the Plan tab (client bundles must not value-import
 * other plugins' internals, and a one-glyph icon does not justify a
 * react-icons dependency).
 *
 * @module @huanlin/dsh-plugin-better-plan/client/icons
 */
import { createElement } from 'react';
/**
 * The Plan tab glyph: a checklist document.
 * @param props - size in pixels.
 * @returns the icon element.
 */
export declare function IconPlanOutline16(props: {
    size: number;
}): ReturnType<typeof createElement>;
