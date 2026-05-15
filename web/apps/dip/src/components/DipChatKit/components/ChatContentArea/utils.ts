import type { DipChatKitSessionMessage } from '../../apis/types'
import type {
  DipChatKitAnswerEvent,
  DipChatKitAttachment,
  DipChatKitMessageTurn,
} from '../../types'
import type { AiPromptSubmitPayload } from '../AiPromptInput/types'

const SYSTEM_ROLE = 'system'

export const buildRegeneratePayload = (turn: DipChatKitMessageTurn): AiPromptSubmitPayload => {
  const files = turn.questionAttachments
    .map((attachment) => attachment.file)
    .filter((file): file is File => file instanceof File)

  return {
    content: turn.question,
    files,
    employees: turn.questionEmployees || [],
  }
}

export const shouldPreserveLiveConversationOnSessionAttach = (
  sessionId: string,
  messageTurns: DipChatKitMessageTurn[],
): boolean => {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId || messageTurns.length === 0) {
    return false
  }

  const hasLiveConversationContent = messageTurns.some((turn) => {
    return (
      turn.pendingSend === true ||
      turn.answerLoading === true ||
      turn.answerStreaming === true ||
      turn.question.trim().length > 0 ||
      turn.questionAttachments.length > 0 ||
      turn.answerMarkdown.trim().length > 0 ||
      turn.answerEvents.length > 0
    )
  })

  if (!hasLiveConversationContent) {
    return false
  }

  return messageTurns.every((turn) => {
    const turnSessionKey = turn.sessionKey?.trim() || ''
    return !turnSessionKey || turnSessionKey === normalizedSessionId
  })
}

const normalizeSessionMessageRole = (role: unknown): string => {
  if (typeof role !== 'string') return ''
  return role.trim().toLowerCase()
}

const normalizeSessionContentPartType = (type: unknown): string => {
  if (typeof type !== 'string') return ''
  return type.trim().toLowerCase()
}

const isNonTextContentPartType = (type: string): boolean => {
  if (!type) return false
  return (
    type === 'toolcall' ||
    type === 'tool_call' ||
    type === 'function_call' ||
    type === 'function_call_output' ||
    type === 'item_reference'
  )
}

const getPathTail = (path: string): string => {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] || ''
}

const createHistoryAttachment = (path: string): DipChatKitAttachment | null => {
  const normalizedPath = path.trim()
  if (!normalizedPath) return null

  const name = getPathTail(normalizedPath) || normalizedPath
  return {
    uid: `history_attachment_${normalizedPath}`,
    name,
    size: 0,
    type: '',
  }
}

const parseAttachmentFromRecord = (value: unknown): DipChatKitAttachment | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const payload = value as Record<string, unknown>
  const type = normalizeSessionContentPartType(payload.type)
  if (type !== 'input_file') return null

  const source = payload.source
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null

  const path = (source as Record<string, unknown>).path
  return typeof path === 'string' ? createHistoryAttachment(path) : null
}

const parseAttachmentFromUnknown = (value: unknown): DipChatKitAttachment | null => {
  const fromRecord = parseAttachmentFromRecord(value)
  if (fromRecord) return fromRecord

  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) return null

  try {
    return parseAttachmentFromRecord(JSON.parse(trimmed))
  } catch {
    return null
  }
}

const dedupeAttachments = (attachments: DipChatKitAttachment[]): DipChatKitAttachment[] => {
  const seen = new Set<string>()
  return attachments.filter((attachment) => {
    const key = attachment.uid.trim() || attachment.name.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const extractSessionContent = (
  content: unknown,
): { text: string; attachments: DipChatKitAttachment[] } => {
  if (content === null || content === undefined) {
    return { text: '', attachments: [] }
  }

  const directAttachment = parseAttachmentFromUnknown(content)
  if (directAttachment) {
    return {
      text: '',
      attachments: [directAttachment],
    }
  }

  if (typeof content === 'string') {
    return { text: content, attachments: [] }
  }

  if (typeof content === 'number' || typeof content === 'boolean') {
    return { text: String(content), attachments: [] }
  }

  if (Array.isArray(content)) {
    const parts = content.map((item) => extractSessionContent(item))
    return {
      text: parts
        .map((part) => part.text)
        .filter(Boolean)
        .join(''),
      attachments: dedupeAttachments(parts.flatMap((part) => part.attachments)),
    }
  }

  if (typeof content === 'object') {
    const payload = content as Record<string, unknown>
    const contentType = normalizeSessionContentPartType(payload.type)
    if (isNonTextContentPartType(contentType)) {
      return { text: '', attachments: [] }
    }

    const directTextKeys = ['text', 'output_text', 'content', 'value']

    for (const key of directTextKeys) {
      const value = payload[key]
      if (typeof value === 'string') {
        return { text: value, attachments: [] }
      }
    }

    const nestedContent = payload.content
    if (Array.isArray(nestedContent)) {
      const nested = extractSessionContent(nestedContent)
      if (nested.text || nested.attachments.length > 0) {
        return nested
      }
    }
  }

  try {
    return {
      text: JSON.stringify(content),
      attachments: [],
    }
  } catch {
    return {
      text: String(content),
      attachments: [],
    }
  }
}

const normalizeSessionMessageContentPart = (part: unknown): string => {
  return extractSessionContent(part).text
}

export const normalizeSessionMessageContent = (content: unknown): string => {
  return normalizeSessionMessageContentPart(content)
}

const normalizeToolName = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  return value.trim()
}

const normalizeToolCallId = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  return value.trim()
}

const normalizeDetails = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

const resolveMessageTimestamp = (message: DipChatKitSessionMessage): number | undefined => {
  if (typeof message.ts === 'number' && Number.isFinite(message.ts)) {
    return message.ts
  }

  const timestamp = (message as Record<string, unknown>).timestamp
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return timestamp
  }

  return undefined
}

const toTextFromUnknown = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const extractToolCallEventsFromMessage = (
  message: DipChatKitSessionMessage,
  index: number,
): DipChatKitAnswerEvent[] => {
  const content = message.content
  if (!Array.isArray(content)) return []

  const timestamp = resolveMessageTimestamp(message)

  return content.reduce<DipChatKitAnswerEvent[]>((events, part, partIndex) => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return events
    const payload = part as Record<string, unknown>
    const type = normalizeSessionContentPartType(payload.type)
    if (type !== 'toolcall' && type !== 'tool_call' && type !== 'function_call') {
      return events
    }

    const name = normalizeToolName(payload.name ?? payload.toolName)
    const callId = normalizeToolCallId(payload.id ?? payload.call_id ?? payload.callId)
    const text = normalizeSessionMessageContent(payload.arguments)

    events.push({
      id: `session_event_tool_call_${index}_${partIndex}`,
      type: 'toolCall',
      role: 'assistant',
      toolName: name,
      toolCallId: callId,
      text,
      timestamp,
    })

    return events
  }, [])
}

const extractToolResultEventsFromMessage = (
  message: DipChatKitSessionMessage,
  index: number,
): DipChatKitAnswerEvent[] => {
  const content = message.content
  if (!Array.isArray(content)) return []

  const timestamp = resolveMessageTimestamp(message)
  const fallbackToolName = normalizeToolName((message as Record<string, unknown>).toolName)

  return content.reduce<DipChatKitAnswerEvent[]>((events, part, partIndex) => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return events
    const payload = part as Record<string, unknown>
    const type = normalizeSessionContentPartType(payload.type)
    if (
      type !== 'function_call_output' &&
      type !== 'function_call_result' &&
      type !== 'toolresult' &&
      type !== 'tool_result'
    ) {
      return events
    }

    const toolName = normalizeToolName(payload.name ?? payload.toolName) || fallbackToolName
    const toolCallId = normalizeToolCallId(
      payload.call_id ?? payload.callId ?? payload.id ?? payload.toolCallId,
    )
    const resultText = (
      extractSessionContent(payload.output).text ||
      extractSessionContent(payload.result).text ||
      extractSessionContent(payload.content).text ||
      extractSessionContent(payload.value).text ||
      extractSessionContent(payload.text).text
    ).trim()

    if (!(resultText || toolName || toolCallId)) {
      return events
    }

    events.push({
      id: `session_event_tool_result_${index}_${partIndex}`,
      type: 'toolResult',
      role: 'toolResult',
      toolName,
      toolCallId,
      text: '',
      resultText,
      timestamp,
      details: {
        status: 'completed',
      },
    })

    return events
  }, [])
}

const createSessionEvent = (
  message: DipChatKitSessionMessage,
  index: number,
  role: string,
): DipChatKitAnswerEvent | null => {
  const toolName = normalizeToolName((message as Record<string, unknown>).toolName)
  const toolCallId = normalizeToolCallId((message as Record<string, unknown>).toolCallId)
  const isError = (message as Record<string, unknown>).isError === true
  const details = normalizeDetails((message as Record<string, unknown>).details)
  const timestamp = resolveMessageTimestamp(message)
  const contentText = normalizeSessionMessageContent(message.content).trim()
  const detailsText = details ? toTextFromUnknown(details) : ''
  const text = contentText || detailsText

  if (!(text || toolName || toolCallId || details)) {
    return null
  }

  if (role === 'toolresult' || role === 'tool') {
    return {
      id: `session_event_tool_result_${index}`,
      type: 'toolResult',
      role,
      text: '',
      resultText: text,
      toolName,
      toolCallId,
      isError,
      timestamp,
      details,
    }
  }

  if (role && role !== 'assistant' && role !== 'user' && role !== SYSTEM_ROLE) {
    return {
      id: `session_event_unknown_${index}`,
      type: 'unknown',
      role,
      text,
      toolName,
      toolCallId,
      isError,
      timestamp,
      details,
    }
  }

  return null
}

const createEmptyTurn = (
  index: number,
  createdAt: string,
  sessionKey: string,
  question = '',
  questionAttachments: DipChatKitAttachment[] = [],
  id?: string,
): DipChatKitMessageTurn => {
  const normalizedId = id ? `${id}_${index}` : String(index)

  return {
    id: `session_turn_${normalizedId}`,
    sessionKey,
    question,
    questionEmployees: [],
    questionAttachments,
    answerMarkdown: '',
    answerEvents: [],
    answerTimeline: [],
    answerLoading: false,
    answerStreaming: false,
    createdAt,
  }
}

const normalizeSessionCreatedAt = (rawTs: unknown): string => {
  if (typeof rawTs === 'number' && Number.isFinite(rawTs)) {
    return new Date(rawTs).toISOString()
  }
  return new Date().toISOString()
}

const appendTurnAnswerText = (turn: DipChatKitMessageTurn, text: string, timelineId: string) => {
  const normalizedText = text.trim()
  if (!normalizedText) return

  turn.answerMarkdown = turn.answerMarkdown
    ? `${turn.answerMarkdown}\n\n${normalizedText}`
    : normalizedText
  turn.answerTimeline.push({
    id: timelineId,
    kind: 'text',
    text: normalizedText,
  })
}

const appendTurnAnswerEvent = (
  turn: DipChatKitMessageTurn,
  event: DipChatKitAnswerEvent,
  timelineId: string,
) => {
  const normalizedToolCallId = event.toolCallId?.trim() || ''
  const isToolLifecycleEvent = event.type === 'toolCall' || event.type === 'toolResult'
  if (isToolLifecycleEvent && normalizedToolCallId) {
    const existedEventIndex = turn.answerEvents.findIndex((item) => {
      const candidateToolCallId = item.toolCallId?.trim() || ''
      const candidateIsToolLifecycle = item.type === 'toolCall' || item.type === 'toolResult'
      return candidateIsToolLifecycle && candidateToolCallId === normalizedToolCallId
    })

    if (existedEventIndex >= 0) {
      const existedEvent = turn.answerEvents[existedEventIndex]
      const shouldUseResultText = event.type === 'toolResult' && event.text.trim().length > 0
      const mergedEvent: DipChatKitAnswerEvent = {
        ...existedEvent,
        ...event,
        id: existedEvent.id,
        type:
          existedEvent.type === 'toolResult' || event.type === 'toolResult'
            ? 'toolResult'
            : 'toolCall',
        role:
          existedEvent.type === 'toolResult' || event.type === 'toolResult'
            ? 'toolResult'
            : 'assistant',
        toolName: event.toolName?.trim() ? event.toolName : existedEvent.toolName,
        toolCallId: event.toolCallId?.trim() ? event.toolCallId : existedEvent.toolCallId,
        text: shouldUseResultText ? event.text : existedEvent.text || event.text,
        resultText: event.resultText !== undefined ? event.resultText : existedEvent.resultText,
        details: {
          ...(existedEvent.details || {}),
          ...(event.details || {}),
          status:
            existedEvent.type === 'toolResult' || event.type === 'toolResult'
              ? 'completed'
              : existedEvent.details?.status || event.details?.status || 'in_progress',
        },
      }

      turn.answerEvents[existedEventIndex] = mergedEvent

      const existedTimelineEventIndex = turn.answerTimeline.findIndex(
        (item) => item.kind === 'event' && item.event.id === existedEvent.id,
      )
      if (existedTimelineEventIndex >= 0) {
        const timelineItem = turn.answerTimeline[existedTimelineEventIndex]
        if (timelineItem.kind === 'event') {
          turn.answerTimeline[existedTimelineEventIndex] = {
            ...timelineItem,
            event: mergedEvent,
          }
        }
      }
      return
    }
  }

  turn.answerEvents.push(event)
  turn.answerTimeline.push({
    id: timelineId,
    kind: 'event',
    event,
  })
}

export const mapSessionMessagesToTurns = (
  messages: DipChatKitSessionMessage[] | undefined,
  sessionKey = '',
): DipChatKitMessageTurn[] => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return []
  }

  const turns: DipChatKitMessageTurn[] = []
  let activeTurn: DipChatKitMessageTurn | null = null

  messages.forEach((message, index) => {
    const role = normalizeSessionMessageRole(message.role)
    const content = normalizeSessionMessageContent(message.content).trim()
    const extractedContent = role === 'user' ? extractSessionContent(message.content) : null
    const createdAt = normalizeSessionCreatedAt(resolveMessageTimestamp(message))

    if (role === SYSTEM_ROLE) {
      return
    }

    if (role === 'user') {
      const nextTurn = createEmptyTurn(
        index,
        createdAt,
        sessionKey,
        extractedContent?.text.trim() || content,
        extractedContent?.attachments || [],
        message.id,
      )
      turns.push(nextTurn)
      activeTurn = nextTurn
      return
    }

    if (!activeTurn) {
      activeTurn = createEmptyTurn(index, createdAt, sessionKey, '', [], message.id)
      turns.push(activeTurn)
    }
    const resolvedTurn = activeTurn
    if (!resolvedTurn) return

    if (role === 'assistant' && content) {
      appendTurnAnswerText(resolvedTurn, content, `session_timeline_text_${index}`)
    }

    if (role === 'assistant') {
      const toolCallEvents = extractToolCallEventsFromMessage(message, index)
      if (toolCallEvents.length > 0) {
        toolCallEvents.forEach((toolEvent, toolIndex) => {
          appendTurnAnswerEvent(
            resolvedTurn,
            toolEvent,
            `session_timeline_event_tool_call_${index}_${toolIndex}`,
          )
        })
      }

      const toolResultEvents = extractToolResultEventsFromMessage(message, index)
      if (toolResultEvents.length > 0) {
        toolResultEvents.forEach((toolEvent, toolIndex) => {
          appendTurnAnswerEvent(
            resolvedTurn,
            toolEvent,
            `session_timeline_event_tool_result_${index}_${toolIndex}`,
          )
        })
      }
    }

    const event = createSessionEvent(message, index, role)
    if (event) {
      appendTurnAnswerEvent(resolvedTurn, event, `session_timeline_event_${index}`)
    }

    if (
      role !== 'assistant' &&
      role !== SYSTEM_ROLE &&
      role !== 'toolresult' &&
      role !== 'tool' &&
      content
    ) {
      appendTurnAnswerText(resolvedTurn, content, `session_timeline_text_non_assistant_${index}`)
    }
  })

  return turns.filter((turn) => {
    return (
      turn.question.trim().length > 0 ||
      turn.answerMarkdown.trim().length > 0 ||
      turn.answerEvents.length > 0
    )
  })
}
