import { CodeHighlighter, Mermaid } from '@ant-design/x'
import XMarkdown, { type ComponentProps as MarkdownComponentProps } from '@ant-design/x-markdown'
import '@ant-design/x-markdown/dist/x-markdown.css'
import clsx from 'clsx'
import type React from 'react'
import { useMemo } from 'react'
import ChannelMention from '../ChannelMention'
import { CHANNEL_MENTION_TAG, channelMentionMarkedExtension } from '../ChannelMention/utils'
import ChartRenderer from '../ChartRenderer'
import { parseDipChatKitChartPayload } from '../ChartRenderer/utils'
import styles from './index.module.less'
import type { MarkdownRendererProps } from './types'

const normalizeText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

const normalizeLanguage = (lang?: string): string => {
  if (!lang) return 'text'
  return lang.trim().split(/\s+/)[0]?.toLowerCase() || 'text'
}

const ChannelMentionRenderer: React.FC<MarkdownComponentProps> = ({ children }) => {
  return <ChannelMention>{children}</ChannelMention>
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className,
  variant = 'answer',
  components,
  allowLenientChartParse = true,
}) => {
  const markdownComponents = useMemo(() => {
    const CodeRenderer: React.FC<MarkdownComponentProps> = ({
      children,
      lang,
      block,
      className,
    }) => {
      const codeText = normalizeText(children)
      const language = normalizeLanguage(lang)

      if (!block) {
        return <code className={clsx(styles.inlineCode, className)}>{codeText}</code>
      }

      if (language === 'mermaid') {
        return <Mermaid>{codeText}</Mermaid>
      }

      const chartPayload = parseDipChatKitChartPayload(codeText, {
        allowLenient: allowLenientChartParse,
        requireRenderable: true,
      })
      if (chartPayload) {
        return <ChartRenderer chart={chartPayload} />
      }

      return <CodeHighlighter lang={language}>{codeText}</CodeHighlighter>
    }

    return {
      code: CodeRenderer,
      [CHANNEL_MENTION_TAG]: ChannelMentionRenderer,
      ...(components || {}),
    }
  }, [allowLenientChartParse, components])

  return (
    <div className={clsx('MarkdownRenderer', styles.root, styles[variant], className)}>
      <XMarkdown components={markdownComponents} config={channelMentionMarkedExtension}>
        {content}
      </XMarkdown>
    </div>
  )
}

export default MarkdownRenderer
