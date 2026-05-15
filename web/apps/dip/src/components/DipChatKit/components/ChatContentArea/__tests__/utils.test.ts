import { describe, expect, it } from 'vitest'
import { mapSessionMessagesToTurns, shouldPreserveLiveConversationOnSessionAttach } from '../utils'

describe('ChatContentArea/utils mapSessionMessagesToTurns', () => {
  it('restores archive tool result text from historical function_call_output messages', () => {
    const turns = mapSessionMessagesToTurns(
      [
        {
          id: 'msg-user',
          role: 'user',
          content: '归档一下',
          ts: 1714450000000,
        },
        {
          id: 'msg-tool-call',
          role: 'assistant',
          content: [
            {
              type: 'function_call',
              id: 'call_archive_1',
              name: 'archive',
              arguments: '{"kind":"file","sourcePath":"output"}',
            },
          ],
          ts: 1714450001000,
        },
        {
          id: 'msg-tool-result',
          role: 'assistant',
          content: [
            {
              type: 'function_call_output',
              call_id: 'call_archive_1',
              output: [
                {
                  type: 'text',
                  text: '```json\n{"type":"archive_grid","data":{"type":"directory","archive_root":"archives/chat-1","subpath":"2026-03-25-03-04-05/output","name":"output"}}\n```',
                },
              ],
            },
          ],
          ts: 1714450002000,
        },
      ],
      'session-1',
    )

    expect(turns).toHaveLength(1)
    expect(turns[0]?.answerEvents).toHaveLength(1)
    expect(turns[0]?.answerEvents[0]).toMatchObject({
      type: 'toolResult',
      toolName: 'archive',
      toolCallId: 'call_archive_1',
      resultText:
        '```json\n{"type":"archive_grid","data":{"type":"directory","archive_root":"archives/chat-1","subpath":"2026-03-25-03-04-05/output","name":"output"}}\n```',
    })
  })

  it('stores top-level toolResult message content into resultText for archive history replay', () => {
    const turns = mapSessionMessagesToTurns(
      [
        {
          id: 'msg-user',
          role: 'user',
          content: [{ type: 'text', text: '归档一个目录' }],
          timestamp: 1777528005378,
        },
        {
          id: 'msg-tool-call',
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'call_n7velwfpfgike3six9awyddb',
              name: 'archive',
              arguments: {
                kind: 'file',
                sourcePath: 'temp_dir',
              },
            },
          ],
          timestamp: 1777528012347,
        },
        {
          id: 'msg-tool-result',
          role: 'toolResult',
          toolCallId: 'call_n7velwfpfgike3six9awyddb',
          toolName: 'archive',
          content: [
            {
              type: 'text',
              text: '```json\n{\n  "type": "archive_grid",\n  "data": {\n    "type": "directory",\n    "archive_root": "archives/chat-1",\n    "subpath": "2026-04-30-13-46-55/temp_dir",\n    "name": "temp_dir"\n  }\n}\n```',
            },
          ],
          isError: false,
          timestamp: 1777528015192,
        },
      ],
      'session-1',
    )

    expect(turns).toHaveLength(1)
    expect(turns[0]?.answerEvents).toHaveLength(1)
    expect(turns[0]?.answerEvents[0]).toMatchObject({
      type: 'toolResult',
      toolName: 'archive',
      toolCallId: 'call_n7velwfpfgike3six9awyddb',
      resultText: expect.stringContaining('"type": "archive_grid"'),
    })
  })
})

describe('ChatContentArea/utils shouldPreserveLiveConversationOnSessionAttach', () => {
  it('preserves the in-flight first turn when the same session key is attached to the URL', () => {
    expect(
      shouldPreserveLiveConversationOnSessionAttach('session-1', [
        {
          id: 'turn-1',
          sessionKey: 'session-1',
          question: '@库存助手 帮我看下今日异常订单',
          questionEmployees: [{ value: 'employee-1', label: '库存助手' }],
          questionAttachments: [],
          pendingSend: false,
          answerMarkdown: '',
          answerEvents: [],
          answerTimeline: [],
          answerLoading: true,
          answerStreaming: true,
          createdAt: '2026-05-15T00:00:00.000Z',
        },
      ]),
    ).toBe(true)
  })

  it('does not preserve when attaching a different session onto existing turns', () => {
    expect(
      shouldPreserveLiveConversationOnSessionAttach('session-2', [
        {
          id: 'turn-1',
          sessionKey: 'session-1',
          question: '继续刚才的话题',
          questionEmployees: [{ value: 'employee-1', label: '库存助手' }],
          questionAttachments: [],
          pendingSend: false,
          answerMarkdown: '好的',
          answerEvents: [],
          answerTimeline: [],
          answerLoading: false,
          answerStreaming: false,
          createdAt: '2026-05-15T00:00:00.000Z',
        },
      ]),
    ).toBe(false)
  })
})
