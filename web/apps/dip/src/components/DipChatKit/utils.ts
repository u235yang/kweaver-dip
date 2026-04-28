import isEmpty from 'lodash/isEmpty'
import isString from 'lodash/isString'
import truncate from 'lodash/truncate'
import dh1 from '@/assets/icons/avator/dh_1.svg'
import dh2 from '@/assets/icons/avator/dh_2.svg'
import dh3 from '@/assets/icons/avator/dh_3.svg'
import dh4 from '@/assets/icons/avator/dh_4.svg'
import dh5 from '@/assets/icons/avator/dh_5.svg'
import dh6 from '@/assets/icons/avator/dh_6.svg'
import dh7 from '@/assets/icons/avator/dh_7.svg'
import dh8 from '@/assets/icons/avator/dh_8.svg'
import type { AiPromptSubmitPayload } from './components/AiPromptInput/types'
import { replaceChannelMentionsWithDisplayNames } from './components/ChannelMention/utils'
import type { DipChatKitMessageTurn } from './types'

const presetAvatarIconMap: Record<string, string> = {
  dh_1: dh1,
  dh_2: dh2,
  dh_3: dh3,
  dh_4: dh4,
  dh_5: dh5,
  dh_6: dh6,
  dh_7: dh7,
  dh_8: dh8,
}

/**
 * 解析数字员工头像地址：`data:image` 直接使用；`http(s)` 直接使用；
 * 预置 `dh_1`…`dh_8` 走本地资源；疑似裸 base64 则按 png data URL 包装；否则使用默认图。
 */
export function resolveDigitalHumanIconSrc(iconId: string | undefined, fallback?: string): string {
  if (!iconId?.trim()) return fallback || ''
  const v = iconId.trim()

  if (v.startsWith('data:image')) return v
  if (v.startsWith('http://') || v.startsWith('https://')) return v

  const preset = presetAvatarIconMap[v]
  if (preset) return preset

  const compact = v.replace(/\s/g, '')
  if (/^[A-Za-z0-9+/]+=*$/.test(compact) && compact.length >= 32) {
    return `data:image/png;base64,${compact}`
  }

  return fallback || ''
}

export const getConversationTitle = (messageTurns: DipChatKitMessageTurn[]): string => {
  const defaultTitle = ''
  if (isEmpty(messageTurns)) return defaultTitle
  const firstQuestion = messageTurns[0]?.question ?? ''
  if (!firstQuestion) return defaultTitle
  return truncate(replaceChannelMentionsWithDisplayNames(firstQuestion), {
    length: 50,
    omission: '',
  })
}

export const maskFirstQuestionTurn = (
  messageTurns: DipChatKitMessageTurn[],
): DipChatKitMessageTurn[] => {
  const firstQuestionTurnIndex = messageTurns.findIndex(
    (turn) => turn.question.trim().length > 0 || turn.questionAttachments.length > 0,
  )
  if (firstQuestionTurnIndex < 0) return messageTurns
  return messageTurns.map((turn, index) => {
    if (index !== firstQuestionTurnIndex) return turn
    return {
      ...turn,
      question: '',
      questionAttachments: [],
    }
  })
}

export const isAsyncIterable = <T = unknown>(value: unknown): value is AsyncIterable<T> => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as { [Symbol.asyncIterator]?: unknown }
  return typeof candidate[Symbol.asyncIterator] === 'function'
}

export const normalizeStreamChunk = (chunk: unknown): string => {
  if (isString(chunk)) return chunk
  if (chunk === null || chunk === undefined) return ''
  return String(chunk)
}

export const splitTextToChunks = (text: string, chunkSize = 14): string[] => {
  if (!text) return []
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize))
  }
  return chunks
}

export const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export const parseAgentIdFromSessionKey = (sessionKey: string): string => {
  const normalizedSessionKey = sessionKey.trim()
  if (!normalizedSessionKey.startsWith('agent:')) return ''

  const parts = normalizedSessionKey.split(':')
  if (parts.length < 3) return ''
  if (parts[0] !== 'agent') return ''

  return parts[1]?.trim() || ''
}

export const buildDefaultMessageTurnsFromSubmitPayload = (
  payload?: AiPromptSubmitPayload,
): DipChatKitMessageTurn[] => {
  if (!payload?.content) {
    return []
  }

  const questionAttachments = payload.files.map((file) => ({
    uid: `${file.name}_${file.size}_${file.lastModified}`,
    name: file.name,
    size: file.size,
    type: file.type,
    file,
  }))

  return [
    {
      id: `turn_init_${Date.now()}`,
      question: payload.content,
      questionEmployees: payload.employees,
      pendingSend: true,
      questionAttachments,
      answerMarkdown: '',
      answerEvents: [],
      answerTimeline: [],
      answerLoading: false,
      answerStreaming: false,
      createdAt: new Date().toISOString(),
    },
  ]
}
