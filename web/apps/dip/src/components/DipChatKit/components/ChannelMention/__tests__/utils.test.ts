import { describe, expect, it } from 'vitest'

import {
  channelMentionMarkedExtension,
  parseChannelMentionAt,
  renderTextWithChannelMentions,
  replaceChannelMentionsWithDisplayNames,
} from '../utils'

describe('parseChannelMentionAt', () => {
  it('parses one channel mention payload in channel user format', () => {
    expect(parseChannelMentionAt('@{channel:feishu:user:Zak:66589dee}')).toEqual({
      raw: '@{channel:feishu:user:Zak:66589dee}',
      channelType: 'feishu',
      displayName: 'Zak',
      userId: '66589dee',
      endIndex: 35,
    })
  })

  it('keeps compatibility with displayName user_id format', () => {
    expect(parseChannelMentionAt('@{channel:feishu:displayName:Zak:user_id:66589dee}')).toEqual({
      raw: '@{channel:feishu:displayName:Zak:user_id:66589dee}',
      channelType: 'feishu',
      displayName: 'Zak',
      userId: '66589dee',
      endIndex: 50,
    })
  })

  it('uses the last colon as user id separator in channel user format', () => {
    expect(parseChannelMentionAt('@{channel:feishu:user:Team:Zak:66589dee}')).toMatchObject({
      channelType: 'feishu',
      displayName: 'Team:Zak',
      userId: '66589dee',
    })
  })

  it('uses the last user_id marker before the closing brace', () => {
    expect(
      parseChannelMentionAt('@{channel:feishu:displayName:Team:user_id:Zak:user_id:66589dee}'),
    ).toMatchObject({
      channelType: 'feishu',
      displayName: 'Team:user_id:Zak',
      userId: '66589dee',
    })
  })

  it('rejects malformed payloads', () => {
    expect(parseChannelMentionAt('@{channel:feishu:user:Zak}')).toBeUndefined()
    expect(parseChannelMentionAt('@{channel::user:Zak:66589dee}')).toBeUndefined()
    expect(parseChannelMentionAt('@{channel:feishu:user::66589dee}')).toBeUndefined()
    expect(parseChannelMentionAt('@{channel:feishu:user:Zak:}')).toBeUndefined()
    expect(parseChannelMentionAt('@{channel:feishu:displayName:Zak}')).toBeUndefined()
    expect(parseChannelMentionAt('@{channel::displayName:Zak:user_id:66589dee}')).toBeUndefined()
    expect(parseChannelMentionAt('@{channel:feishu:displayName::user_id:66589dee}')).toBeUndefined()
    expect(parseChannelMentionAt('@{channel:feishu:displayName:Zak:user_id:}')).toBeUndefined()
  })
})

describe('renderTextWithChannelMentions', () => {
  it('renders parsed mentions and keeps surrounding text', () => {
    expect(
      renderTextWithChannelMentions(
        '发送给 @{channel:feishu:user:Zak:66589dee} 和 @{channel:dingding:user:Alice:42}',
        (label, key) => `[${key}|${label}]`,
      ),
    ).toEqual([
      '发送给 ',
      '[channel-mention-4-35|飞书用户:Zak]',
      ' 和 ',
      '[channel-mention-42-33|dingding用户:Alice]',
    ])
  })

  it('keeps malformed mentions as plain text', () => {
    expect(
      renderTextWithChannelMentions('发送给 @{channel:feishu:displayName:Zak}', (label) => label),
    ).toEqual(['发送给 @{channel:', 'feishu:displayName:Zak}'])
  })
})

describe('replaceChannelMentionsWithDisplayNames', () => {
  it('replaces parsed mentions with display names', () => {
    expect(
      replaceChannelMentionsWithDisplayNames(
        '发送给 @{channel:feishu:user:Zak:66589dee} 和 @{channel:dingding:user:Alice:42}',
      ),
    ).toBe('发送给 Zak 和 Alice')
  })

  it('keeps malformed mentions as plain text', () => {
    expect(replaceChannelMentionsWithDisplayNames('发送给 @{channel:feishu:user:Zak}')).toBe(
      '发送给 @{channel:feishu:user:Zak}',
    )
  })
})

describe('channelMentionMarkedExtension', () => {
  it('tokenizes and escapes a valid leading mention', () => {
    const extension = channelMentionMarkedExtension.extensions[0]
    const token = extension.tokenizer('@{channel:feishu:user:<Zak>:66589dee}')

    expect(token).toEqual({
      type: 'channelMention',
      raw: '@{channel:feishu:user:<Zak>:66589dee}',
      text: '飞书用户:<Zak>',
    })
    expect(extension.renderer(token ?? {})).toBe(
      '<channel-mention>飞书用户:&lt;Zak&gt;</channel-mention>',
    )
  })
})
