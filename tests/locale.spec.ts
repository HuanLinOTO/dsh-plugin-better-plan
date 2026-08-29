import { describe, expect, it } from 'vitest'
import { resolveBetterPlanConfig } from '../src/config.ts'
import {
  LocaleDirectory, localizedRenderContent, normalizeReportedLocale, resolvePlanLocale,
} from '../src/locale.ts'

describe('normalizeReportedLocale', () => {
  it('maps BCP 47-style tags to the shipped locales', () => {
    expect(normalizeReportedLocale('zh')).toBe('zh')
    expect(normalizeReportedLocale('zh-CN')).toBe('zh')
    expect(normalizeReportedLocale('ZH-TW')).toBe('zh')
    expect(normalizeReportedLocale('en')).toBe('en')
    expect(normalizeReportedLocale('en-US')).toBe('en')
  })

  it('ignores unsupported tags and non-strings', () => {
    expect(normalizeReportedLocale('xx')).toBeUndefined()
    expect(normalizeReportedLocale('fr-FR')).toBeUndefined()
    expect(normalizeReportedLocale('')).toBeUndefined()
    expect(normalizeReportedLocale('way-too-long-tag-value')).toBeUndefined()
    expect(normalizeReportedLocale(42)).toBeUndefined()
    expect(normalizeReportedLocale(null)).toBeUndefined()
  })
})

describe('LocaleDirectory', () => {
  it('records and resolves per-session reports, ignoring invalid ones', () => {
    const directory = new LocaleDirectory()
    expect(directory.known('s1')).toBeUndefined()
    directory.report('s1', 'zh-CN')
    expect(directory.known('s1')).toBe('zh')
    directory.report('s1', 'en')
    expect(directory.known('s1')).toBe('en')
    // Invalid reports never clobber a valid one; blank sessions are ignored.
    directory.report('s1', 'xx-YY')
    expect(directory.known('s1')).toBe('en')
    directory.report('', 'zh')
    expect(directory.known('')).toBeUndefined()
  })

  it('dispose clears every report', () => {
    const directory = new LocaleDirectory()
    directory.report('s1', 'zh')
    directory.dispose()
    expect(directory.known('s1')).toBeUndefined()
  })
})

describe('resolvePlanLocale', () => {
  const directory = new LocaleDirectory()

  it('a forced config locale wins over any report', () => {
    const reported = new LocaleDirectory()
    reported.report('s1', 'en')
    expect(resolvePlanLocale('zh', reported, 's1')).toBe('zh')
    expect(resolvePlanLocale('en', reported, 's1')).toBe('en')
  })

  it('auto follows the reported locale and falls back to English', () => {
    const reported = new LocaleDirectory()
    reported.report('s1', 'zh-CN')
    expect(resolvePlanLocale('auto', reported, 's1')).toBe('zh')
    expect(resolvePlanLocale('auto', reported, 'unknown')).toBe('en')
    expect(resolvePlanLocale('auto', reported, undefined)).toBe('en')
  })

  it('the config schema resolves the locale knob with the auto default', () => {
    expect(resolveBetterPlanConfig({}).locale).toBe('auto')
    expect(resolveBetterPlanConfig({ locale: 'zh' }).locale).toBe('zh')
    expect(() => resolveBetterPlanConfig({ locale: 'fr' as never })).toThrow()
    expect(() => resolveBetterPlanConfig({ extra: 1 } as unknown as Partial<Parameters<typeof resolveBetterPlanConfig>[0]>)).toThrow('unknown config key "extra"')
  })
})

describe('localizedRenderContent', () => {
  it('localizes the pending and approved branches into Chinese', () => {
    const pending = localizedRenderContent('/p.md', { decision: 'pending' }, 'zh')
    expect(pending).toHaveLength(1)
    expect(pending?.[0]?.text).toContain('请立即结束回合')
    expect(pending?.[0]?.text).toContain('「继续规划」的反馈会要求你修改计划文件后重新提交')
    const approved = localizedRenderContent('/p.md', { decision: 'approved' }, 'zh')
    expect(approved?.[0]?.text).toContain('计划已批准')
    expect(approved?.[0]?.text).toContain('/p.md')
  })

  it('English returns undefined (the render baseline is preserved) and unknown decisions never localize', () => {
    expect(localizedRenderContent('/p.md', { decision: 'pending' }, 'en')).toBeUndefined()
    expect(localizedRenderContent('/p.md', { decision: 'other' }, 'zh')).toBeUndefined()
  })
})
