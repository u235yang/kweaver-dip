import {
  CloseOutlined,
  ExportOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
} from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import clsx from 'clsx'
import type React from 'react'
import intl from 'react-intl-universal'
import type { DipChatKitPreviewPayload } from '../../types'
import ScrollContainer from '../ScrollContainer'
import styles from './index.module.less'
import PreviewArtifact from './PreviewArtifact'
import PreviewCode from './PreviewCode'
import PreviewMarkdown from './PreviewMarkdown'
import PreviewMermaid from './PreviewMermaid'
import PreviewPlaceholder from './PreviewPlaceholder'
import PreviewWebLink from './PreviewWebLink'
import type { RightSideAreaProps } from './types'

const NATIVE_SCROLL_PREVIEW_TYPES = new Set<DipChatKitPreviewPayload['sourceType']>(['web'])

const shouldUseNativeScroll = (payload: DipChatKitPreviewPayload): boolean => {
  return NATIVE_SCROLL_PREVIEW_TYPES.has(payload.sourceType)
}

const RightSideArea: React.FC<RightSideAreaProps> = ({
  visible,
  payload,
  onClose,
  fullscreen,
  onToggleFullscreen,
}) => {
  const isWebPreview = payload?.sourceType === 'web'

  const renderGenericPreviewBody = () => {
    if (!payload) {
      return <PreviewPlaceholder />
    }

    if (!payload.content) {
      return <PreviewPlaceholder />
    }

    if (payload.sourceType === 'code') {
      return <PreviewCode content={payload.content} />
    }

    if (payload.sourceType === 'mermaid') {
      return <PreviewMermaid content={payload.content} />
    }

    if (payload.sourceType === 'web') {
      return <PreviewWebLink content={payload.content} title={payload.title} />
    }

    return <PreviewMarkdown content={payload.content} />
  }

  const renderHeaderExtra = () => {
    if (!(payload && isWebPreview)) return null

    const url = payload.content.trim()
    if (!url) return null

    const openTitle = intl.get('dipChatKit.openWebLinkInNewTab').d('新标签页打开') as string
    return (
      <Tooltip title={openTitle}>
        <Button
          type="text"
          aria-label={openTitle}
          icon={<ExportOutlined />}
          onClick={() => {
            window.open(url, '_blank', 'noopener,noreferrer')
          }}
        />
      </Tooltip>
    )
  }

  const renderPreviewContent = () => {
    if (!payload) {
      return <PreviewPlaceholder />
    }

    if (payload.sourceType === 'artifact') {
      return (
        <PreviewArtifact
          payload={payload}
          onClose={onClose}
          fullscreen={fullscreen}
          onToggleFullscreen={onToggleFullscreen}
        />
      )
    }

    const previewTitle =
      payload.title.trim() || (intl.get('dipChatKit.previewAreaTitle').d('预览') as string)
    const closeTitle = intl.get('dipChatKit.closePreview').d('关闭预览') as string
    const fullscreenTitle = fullscreen
      ? (intl.get('dipChatKit.exitFullscreenPreview').d('退出全屏') as string)
      : (intl.get('dipChatKit.fullscreenPreview').d('全屏预览') as string)
    const previewBody = renderGenericPreviewBody()

    return (
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelHeaderLeft}>
            <Tooltip title={previewTitle}>
              <span className={styles.panelTitle}>{previewTitle}</span>
            </Tooltip>
          </div>
          <div className={styles.panelHeaderRight}>
            {renderHeaderExtra()}
            <Tooltip title={fullscreenTitle}>
              <Button
                type="text"
                aria-label={fullscreenTitle}
                icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                onClick={onToggleFullscreen}
              />
            </Tooltip>
            <Tooltip title={closeTitle}>
              <Button
                type="text"
                aria-label={closeTitle}
                icon={<CloseOutlined />}
                onClick={onClose}
              />
            </Tooltip>
          </div>
        </div>
        <div className={styles.panelBody}>
          {shouldUseNativeScroll(payload) ? (
            previewBody
          ) : (
            <ScrollContainer className={styles.panelBodyScroll}>{previewBody}</ScrollContainer>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('RightSideArea', styles.root)}>
      <div className={styles.content}>
        {!visible ? <PreviewPlaceholder /> : renderPreviewContent()}
      </div>
    </div>
  )
}

export default RightSideArea
