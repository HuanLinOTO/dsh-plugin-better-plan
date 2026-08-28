/**
 * Chrome labels for DSH's shared `MarkdownText`, shaped for BOTH prop
 * generations the plugin supports (inlined from the sidebar's
 * markdown-labels helper — client bundles must not value-import other
 * plugins' internals):
 *
 * - 0.1.1-rc.x: optional flat prop `codeLabels` — the renderer reads
 *   `labels.copyLabel` / `labels.copiedLabel` directly.
 * - 0.1.2-alpha.1+: a REQUIRED nested `labels` prop
 *   (`labels.code.copyLabel` + a screen-reader-only `labels.footnotes`
 *   heading). Passing only the old prop crashes the fence render with
 *   "Cannot read properties of undefined (reading 'code')".
 *
 * The union object satisfies both readers, and {@link markdownTextProps}
 * passes it under BOTH prop names — each host ignores the one it does not
 * know.
 *
 * @module @huanlin/dsh-plugin-better-plan/client/markdown-props
 */
import type { ComponentProps } from 'react';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
/** The flat copy-button pair. */
export interface MarkdownCopyLabels {
    copyLabel: string;
    copiedLabel: string;
}
/** The dual-generation chrome labels object. */
export interface MarkdownChromeLabels extends MarkdownCopyLabels {
    /** 0.1.2-alpha.1+ nested reads. */
    code: MarkdownCopyLabels;
    /** 0.1.2-alpha.1+ sr-only footnotes heading. */
    footnotes: string;
}
/** Build the dual-shape chrome labels from a flat copy-button pair. */
export declare function markdownChromeLabels(labels: MarkdownCopyLabels): MarkdownChromeLabels;
/**
 * MarkdownText props carrying the labels under BOTH prop names. The cast is
 * load-bearing: this plugin builds against one generation's declaration where
 * the other prop does not exist.
 * @param text - the markdown source.
 * @param labels - the flat copy-button pair.
 * @returns props spreadable onto `MarkdownText`.
 */
export declare function markdownTextProps(text: string, labels: MarkdownCopyLabels): ComponentProps<typeof MarkdownText>;
