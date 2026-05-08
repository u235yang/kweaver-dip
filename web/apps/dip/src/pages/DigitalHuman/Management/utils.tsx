import type { MenuProps } from 'antd'
import intl from 'react-intl-universal'
import type { DigitalHuman } from '@/apis'
import IconFont from '@/components/IconFont'
import { BKN_CREATOR_ID } from '../type'
import { DigitalHumanManagementActionEnum } from './types'

/** 应用商店操作菜单项 */
export const getDigitalHumanManagementMenuItems = (
  digitalHuman: DigitalHuman,
  onMenuClick: (key: DigitalHumanManagementActionEnum) => void,
): MenuProps['items'] => {
  const items = [
    {
      key: DigitalHumanManagementActionEnum.Edit,
      icon: <IconFont type="icon-edit" />,
      label: intl.get('digitalHuman.management.menuEdit'),
      onClick: (e: { domEvent: { stopPropagation: () => void } }) => {
        e.domEvent.stopPropagation()
        onMenuClick(DigitalHumanManagementActionEnum.Edit)
      },
    },
    {
      key: DigitalHumanManagementActionEnum.Delete,
      icon: <IconFont type="icon-trash" />,
      label: intl.get('digitalHuman.management.menuDelete'),
      danger: true,
      onClick: (e: { domEvent: { stopPropagation: () => void } }) => {
        e.domEvent.stopPropagation()
        onMenuClick(DigitalHumanManagementActionEnum.Delete)
      },
    },
  ]

  if (digitalHuman.id === BKN_CREATOR_ID) {
    items.unshift({
      key: DigitalHumanManagementActionEnum.Session,
      icon: <IconFont type="icon-dialog" />,
      label: intl.get('digitalHuman.management.menuSession'),
      onClick: (e: { domEvent: { stopPropagation: () => void } }) => {
        e.domEvent.stopPropagation()
        onMenuClick(DigitalHumanManagementActionEnum.Session)
      },
    })
  }

  return items
}
