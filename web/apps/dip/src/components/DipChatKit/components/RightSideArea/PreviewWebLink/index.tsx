import clsx from 'clsx'
import type React from 'react'
import styles from './index.module.less'
import type { PreviewWebLinkProps } from './types'

const PreviewWebLink: React.FC<PreviewWebLinkProps> = ({ content, title }) => {
  const url = content.trim()
  const frameTitle = title?.trim() || url || 'web-preview'

  return (
    <div className={clsx('PreviewWebLink', styles.root)}>
      {url ? (
        <iframe
          className={styles.frame}
          title={frameTitle}
          src={url}
          referrerPolicy="no-referrer"
        />
      ) : null}
    </div>
  )
}

export default PreviewWebLink
