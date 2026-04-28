import type React from 'react'

export const CHANNEL_MENTION_TAG = 'channel-mention'

const CHANNEL_MENTION_PREFIX = '@{channel:'
const CHANNEL_MENTION_USER_MARKER = ':user:'
const CHANNEL_MENTION_DISPLAY_NAME_MARKER = ':displayName:'
const CHANNEL_MENTION_USER_ID_MARKER = ':user_id:'

const CHANNEL_TYPE_LABELS: Record<string, string> = {
  feishu: '飞书用户',
}

export interface ChannelMentionParseResult {
  raw: string
  channelType: string
  displayName: string
  userId: string
  endIndex: number
}

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export const formatChannelMentionLabel = (channelType: string, displayName: string): string => {
  const normalizedChannelType = channelType.trim()
  const typeLabel = CHANNEL_TYPE_LABELS[normalizedChannelType] || `${normalizedChannelType}用户`
  return `${typeLabel}:${displayName}`
}

export const parseChannelMentionAt = (
  src: string,
  startIndex = 0,
): ChannelMentionParseResult | undefined => {
  if (!src.startsWith(CHANNEL_MENTION_PREFIX, startIndex)) {
    return undefined
  }

  const channelTypeStart = startIndex + CHANNEL_MENTION_PREFIX.length
  const userMarkerIndex = src.indexOf(CHANNEL_MENTION_USER_MARKER, channelTypeStart)
  const displayNameMarkerIndex = src.indexOf(CHANNEL_MENTION_DISPLAY_NAME_MARKER, channelTypeStart)

  if (
    userMarkerIndex >= 0 &&
    (displayNameMarkerIndex < 0 || userMarkerIndex < displayNameMarkerIndex)
  ) {
    const endIndex = src.indexOf('}', userMarkerIndex + CHANNEL_MENTION_USER_MARKER.length)
    if (endIndex < 0) {
      return undefined
    }

    const userIdSeparatorIndex = src.lastIndexOf(':', endIndex)
    if (userIdSeparatorIndex < userMarkerIndex + CHANNEL_MENTION_USER_MARKER.length) {
      return undefined
    }

    const channelType = src.slice(channelTypeStart, userMarkerIndex)
    const displayName = src.slice(
      userMarkerIndex + CHANNEL_MENTION_USER_MARKER.length,
      userIdSeparatorIndex,
    )
    const userId = src.slice(userIdSeparatorIndex + 1, endIndex)

    if (channelType.length === 0 || displayName.length === 0 || userId.length === 0) {
      return undefined
    }

    return {
      raw: src.slice(startIndex, endIndex + 1),
      channelType,
      displayName,
      userId,
      endIndex: endIndex + 1,
    }
  }

  if (displayNameMarkerIndex < 0) {
    return undefined
  }

  const endIndex = src.indexOf(
    '}',
    displayNameMarkerIndex + CHANNEL_MENTION_DISPLAY_NAME_MARKER.length,
  )
  if (endIndex < 0) {
    return undefined
  }

  const userIdMarkerIndex = src.lastIndexOf(CHANNEL_MENTION_USER_ID_MARKER, endIndex)
  if (userIdMarkerIndex < displayNameMarkerIndex + CHANNEL_MENTION_DISPLAY_NAME_MARKER.length) {
    return undefined
  }

  const channelType = src.slice(channelTypeStart, displayNameMarkerIndex)
  const displayName = src.slice(
    displayNameMarkerIndex + CHANNEL_MENTION_DISPLAY_NAME_MARKER.length,
    userIdMarkerIndex,
  )
  const userId = src.slice(userIdMarkerIndex + CHANNEL_MENTION_USER_ID_MARKER.length, endIndex)

  if (channelType.length === 0 || displayName.length === 0 || userId.length === 0) {
    return undefined
  }

  return {
    raw: src.slice(startIndex, endIndex + 1),
    channelType,
    displayName,
    userId,
    endIndex: endIndex + 1,
  }
}

export const renderTextWithChannelMentions = (
  text: string,
  renderMention: (label: string, key: string) => React.ReactNode,
): React.ReactNode => {
  const nodes: React.ReactNode[] = []
  let cursor = 0

  while (cursor < text.length) {
    const start = text.indexOf(CHANNEL_MENTION_PREFIX, cursor)
    if (start < 0) {
      break
    }

    const mention = parseChannelMentionAt(text, start)
    if (!mention) {
      nodes.push(text.slice(cursor, start + CHANNEL_MENTION_PREFIX.length))
      cursor = start + CHANNEL_MENTION_PREFIX.length
      continue
    }

    if (start > cursor) {
      nodes.push(text.slice(cursor, start))
    }

    nodes.push(
      renderMention(
        formatChannelMentionLabel(mention.channelType, mention.displayName),
        `channel-mention-${start}-${mention.raw.length}`,
      ),
    )
    cursor = mention.endIndex
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return nodes.length > 0 ? nodes : text
}

export const replaceChannelMentionsWithDisplayNames = (text: string): string => {
  if (!text) return text

  let nextText = ''
  let cursor = 0

  while (cursor < text.length) {
    const start = text.indexOf(CHANNEL_MENTION_PREFIX, cursor)
    if (start < 0) {
      nextText += text.slice(cursor)
      break
    }

    const mention = parseChannelMentionAt(text, start)
    if (!mention) {
      nextText += text.slice(cursor, start + CHANNEL_MENTION_PREFIX.length)
      cursor = start + CHANNEL_MENTION_PREFIX.length
      continue
    }

    nextText += text.slice(cursor, start)
    nextText += mention.displayName
    cursor = mention.endIndex
  }

  return nextText
}

export const channelMentionMarkedExtension = {
  extensions: [
    {
      name: 'channelMention',
      level: 'inline' as const,
      start(src: string) {
        const index = src.indexOf('@{channel:')
        return index >= 0 ? index : undefined
      },
      tokenizer(src: string) {
        const mention = parseChannelMentionAt(src)
        if (!mention) return undefined

        return {
          type: 'channelMention',
          raw: mention.raw,
          text: formatChannelMentionLabel(mention.channelType, mention.displayName),
        }
      },
      renderer(token: { text?: string }) {
        return `<${CHANNEL_MENTION_TAG}>${escapeHtml(token.text || '')}</${CHANNEL_MENTION_TAG}>`
      },
    },
  ],
}
