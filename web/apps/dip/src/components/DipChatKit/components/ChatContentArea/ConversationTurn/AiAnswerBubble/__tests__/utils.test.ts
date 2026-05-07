import { describe, expect, it, vi } from 'vitest'
import {
  buildArchiveGridPreviewPayload,
  buildWebLinkPreviewPayload,
  extractArchiveArtifactsFromEvents,
  isPreviewableWebHref,
} from '../utils'

vi.mock('react-intl-universal', () => ({
  default: {
    get: (_key: string, vars?: Record<string, unknown>) => ({
      d: (fallback: string) => {
        if (!vars) return fallback
        return Object.entries(vars).reduce(
          (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
          fallback,
        )
      },
    }),
  },
}))

describe('AiAnswerBubble/utils buildArchiveGridPreviewPayload', () => {
  it('parses directory archive cards with directory entry type', () => {
    const payload = buildArchiveGridPreviewPayload(
      'session-1',
      JSON.stringify({
        type: 'archive_grid',
        data: {
          type: 'directory',
          archive_root: 'archives/chat-1',
          subpath: '2026-03-25-03-04-05/output',
          name: 'output',
        },
      }),
    )

    expect(payload?.sourceType).toBe('artifact')
    expect(payload?.artifact).toMatchObject({
      sessionKey: 'session-1',
      subpath: '2026-03-25-03-04-05/output',
      archiveRoot: 'archives/chat-1',
      fileName: 'output',
      entryType: 'directory',
    })
  })

  it('extracts archive artifacts from completed archive events and deduplicates them', () => {
    const payloads = extractArchiveArtifactsFromEvents('session-1', [
      {
        id: 'archive-1-progress',
        type: 'toolCall',
        role: 'assistant',
        text: '',
        resultText: '',
        toolName: 'archive',
        toolCallId: 'tool-1',
        details: { status: 'in_progress' },
      },
      {
        id: 'archive-1-completed',
        type: 'toolCall',
        role: 'assistant',
        text: '',
        resultText:
          '```json\n{"type":"archive_grid","data":{"type":"directory","archive_root":"archives/chat-1","subpath":"2026-03-25-03-04-05/output","name":"output"}}\n```',
        toolName: 'archive',
        toolCallId: 'tool-1',
        details: { status: 'completed' },
      },
      {
        id: 'archive-1-duplicate',
        type: 'toolCall',
        role: 'assistant',
        text: '',
        resultText:
          '```json\n{"type":"archive_grid","data":{"type":"directory","archive_root":"archives/chat-1","subpath":"2026-03-25-03-04-05/output","name":"output"}}\n```',
        toolName: 'archive',
        toolCallId: 'tool-2',
        details: { status: 'completed' },
      },
    ])

    expect(payloads).toHaveLength(1)
    expect(payloads[0]?.artifact).toMatchObject({
      entryType: 'directory',
      archiveRoot: 'archives/chat-1',
      subpath: '2026-03-25-03-04-05/output',
    })
  })

  it('extracts archive artifacts even when historical toolName is missing', () => {
    const payloads = extractArchiveArtifactsFromEvents('session-1', [
      {
        id: 'archive-historical-result',
        type: 'toolResult',
        role: 'toolResult',
        text: '',
        resultText:
          '{"type":"archive_grid","data":{"type":"file","archive_root":"archives/chat-1","subpath":"PLAN.md","name":"PLAN.md"}}',
        toolName: '',
        toolCallId: 'tool-historical-1',
        details: { status: 'completed' },
      },
    ])

    expect(payloads).toHaveLength(1)
    expect(payloads[0]?.artifact).toMatchObject({
      archiveRoot: 'archives/chat-1',
      subpath: 'PLAN.md',
      fileName: 'PLAN.md',
      entryType: 'file',
    })
  })
})

describe('AiAnswerBubble/utils web preview links', () => {
  it('recognizes absolute http links and ignores non-web links', () => {
    expect(isPreviewableWebHref('https://example.com/index.html')).toBe(true)
    expect(isPreviewableWebHref('http://example.com/a/b/report.htm?version=1')).toBe(true)
    expect(isPreviewableWebHref('http://localhost:3001/dip-hub/application/app-id')).toBe(true)
    expect(isPreviewableWebHref('mailto:test@example.com')).toBe(false)
    expect(isPreviewableWebHref('/local/report.html')).toBe(false)
  })

  it('builds web preview payload from a html link', () => {
    expect(buildWebLinkPreviewPayload('https://example.com/index.html', 'HTML 测试页面')).toEqual({
      title: 'HTML 测试页面',
      content: 'https://example.com/index.html',
      sourceType: 'web',
    })
  })
})
