import type React from 'react'
import styles from './index.module.less'

interface ChannelMentionProps {
  children?: React.ReactNode
}

const ChannelMention: React.FC<ChannelMentionProps> = ({ children }) => {
  return <span className={styles.mention}>{children}</span>
}

export default ChannelMention
