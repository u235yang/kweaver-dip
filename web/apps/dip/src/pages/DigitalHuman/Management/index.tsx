import { Button, message, Spin, Tooltip } from 'antd'
import clsx from 'clsx'
import { memo, useEffect, useRef, useState } from 'react'
import intl from 'react-intl-universal'
import { useNavigate } from 'react-router-dom'
import { type DigitalHuman, getDigitalHumanList } from '@/apis'
import DigitalHumanList from '@/components/DigitalHumanList'
import DeleteModal from '@/components/DigitalHumanSetting/ActionModal/DeleteModal'
import Empty from '@/components/Empty'
import IconFont from '@/components/IconFont'
import SearchInput from '@/components/SearchInput'
import { useListService } from '@/hooks/useListService'
import {
  MAX_PINNED_SIDEBAR_DIGITAL_HUMANS,
  usePinnedDigitalHumansStore,
} from '@/stores/pinnedDigitalHumansStore'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { DigitalHumanManagementActionEnum } from './types'
import { getDigitalHumanManagementMenuItems } from './utils'

const DigitalHumanListWithSidebarPin = memo(function DigitalHumanListWithSidebarPin({
  digitalHumans,
  onCardClick,
}: {
  digitalHumans: DigitalHuman[]
  onCardClick: (digitalHuman: DigitalHuman) => void
}) {
  const pinnedDigitalHumans = usePinnedDigitalHumansStore((s) => s.pinnedDigitalHumans)
  const pinSidebarDigitalHuman = usePinnedDigitalHumansStore((s) => s.pinSidebarDigitalHuman)
  const unpinSidebarDigitalHuman = usePinnedDigitalHumansStore((s) => s.unpinSidebarDigitalHuman)

  return (
    <DigitalHumanList
      digitalHumans={digitalHumans}
      onCardClick={onCardClick}
      cardTrailing={(digitalHuman, { cardHovered }) => {
        const pinned = pinnedDigitalHumans.some((row) => row.id === digitalHuman.id)
        const atLimit = pinnedDigitalHumans.length >= MAX_PINNED_SIDEBAR_DIGITAL_HUMANS
        const pinDisabled = !pinned && atLimit
        const pinTooltip = intl.get('digitalHuman.management.cardPinSidebarTooltip')
        const unpinTooltip = intl.get('digitalHuman.management.cardUnpinSidebarTooltip')
        const limitTooltip = intl.get('digitalHuman.management.cardPinSidebarLimitTooltip', {
          max: MAX_PINNED_SIDEBAR_DIGITAL_HUMANS,
        })

        const pinBtnClass = clsx(
          'w-8 h-8 inline-flex items-center justify-center rounded-md border-0 transition-colors shrink-0',
          'text-[rgba(0,0,0,0.45)]',
          'hover:bg-[#F5F5F5]',
          'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent',
        )

        if (pinned) {
          return (
            <Tooltip title={unpinTooltip} placement="bottom">
              <button
                type="button"
                aria-pressed
                aria-label={unpinTooltip}
                className={clsx(pinBtnClass, 'cursor-pointer')}
                onClick={() => {
                  void unpinSidebarDigitalHuman(digitalHuman.id)
                }}
              >
                <IconFont type="icon-solid-pin" className="text-sm" aria-hidden />
              </button>
            </Tooltip>
          )
        }

        if (!cardHovered) {
          return <div className="w-8 h-8 shrink-0" aria-hidden />
        }

        return (
          <Tooltip title={pinDisabled ? limitTooltip : pinTooltip} placement="bottom">
            <span className={clsx('inline-flex', pinDisabled && 'cursor-not-allowed')}>
              <button
                type="button"
                aria-pressed={false}
                aria-label={pinDisabled ? limitTooltip : pinTooltip}
                disabled={pinDisabled}
                className={clsx(pinBtnClass, !pinDisabled && 'cursor-pointer')}
                onClick={() => {
                  void pinSidebarDigitalHuman(digitalHuman.id)
                }}
              >
                <IconFont type="icon-pin" className="text-base" aria-hidden />
              </button>
            </span>
          </Tooltip>
        )
      }}
    />
  )
})

const Management = () => {
  const navigate = useNavigate()
  const isAdmin = useUserInfoStore((s) => s.isAdmin)
  const [, messageContextHolder] = message.useMessage()
  const [hasLoadedData, setHasLoadedData] = useState(false)
  const [deleteModalVisible, setDeleteModalVisible] = useState(false)
  const [selectedItem, setSelectedItem] = useState<DigitalHuman>()
  const hasEverHadDataRef = useRef(false)
  const prevSearchValueRef = useRef('')
  const {
    items: digitalHumans,
    loading,
    error,
    searchValue,
    handleSearch,
    handleRefresh,
  } = useListService<DigitalHuman>({
    fetchFn: getDigitalHumanList,
  })

  // 对齐项目列表页：根据是否曾经有过数据、是否是搜索态，控制头部和空态展示逻辑
  useEffect(() => {
    const wasSearching = prevSearchValueRef.current !== ''

    if (!loading) {
      if (digitalHumans.length > 0) {
        setHasLoadedData(true)
        hasEverHadDataRef.current = true
      } else if (!searchValue && hasEverHadDataRef.current) {
        if (!wasSearching) {
          setHasLoadedData(false)
          hasEverHadDataRef.current = false
        }
      }
    }

    prevSearchValueRef.current = searchValue
  }, [loading, digitalHumans.length, searchValue])

  /** 新建数字员工（仅管理员） */
  const handleCreate = () => {
    navigate(`/studio/digital-human/setting`)
  }

  const handleCardClick = (digitalHuman: DigitalHuman) => {
    if (isAdmin) {
      navigate(`/studio/digital-human/${digitalHuman.id}/setting`)
      return
    }
    navigate(`/studio/digital-human/${digitalHuman.id}`)
  }

  const handleMenuClick = (key: DigitalHumanManagementActionEnum, digitalHuman: DigitalHuman) => {
    setSelectedItem(digitalHuman)
    switch (key) {
      case DigitalHumanManagementActionEnum.Session:
        navigate(`/studio/digital-human/${digitalHuman.id}`)
        break
      case DigitalHumanManagementActionEnum.Edit:
        navigate(`/studio/digital-human/${digitalHuman.id}/setting?mode=edit`)
        break
      case DigitalHumanManagementActionEnum.Delete:
        setDeleteModalVisible(true)
        break
    }
  }

  const renderStateContent = () => {
    if (loading && !digitalHumans.length) {
      return <Spin />
    }

    if (error) {
      return (
        <Empty type="failed" title={intl.get('digitalHuman.management.loadFailedTitle')}>
          <Button type="primary" onClick={handleRefresh}>
            {intl.get('digitalHuman.management.retry')}
          </Button>
        </Empty>
      )
    }

    if (digitalHumans.length === 0) {
      if (searchValue) {
        return <Empty type="search" desc={intl.get('digitalHuman.management.emptySearchDesc')} />
      }
      return (
        <Empty
          title={intl.get('digitalHuman.management.emptyTitle')}
          subDesc={intl.get('digitalHuman.management.emptySubDesc')}
        >
          {isAdmin ? (
            <Button
              className="mt-2"
              type="primary"
              icon={<IconFont type="icon-add" />}
              onClick={() => {
                handleCreate()
              }}
            >
              {intl.get('digitalHuman.management.createDigitalHuman')}
            </Button>
          ) : undefined}
        </Empty>
      )
    }

    return null
  }

  const renderContent = () => {
    const stateContent = renderStateContent()

    if (stateContent) {
      return <div className="absolute inset-0 flex items-center justify-center">{stateContent}</div>
    }

    return isAdmin ? (
      <DigitalHumanList
        digitalHumans={digitalHumans}
        onCardClick={handleCardClick}
        menuItems={(digitalHuman) =>
          getDigitalHumanManagementMenuItems(digitalHuman, (key) =>
            handleMenuClick(key, digitalHuman),
          )
        }
      />
    ) : (
      <DigitalHumanListWithSidebarPin digitalHumans={digitalHumans} onCardClick={handleCardClick} />
    )
  }

  return (
    <div className="h-full p-6 pb-0 flex flex-col relative bg-[#F8FAFC]">
      {messageContextHolder}
      <div className="flex justify-between items-center mb-4 flex-shrink-0 z-20">
        <span className="font-bold text-lg text-[--dip-text-color]">
          {intl.get('digitalHuman.management.listSectionAll')}
        </span>
        {(hasLoadedData || searchValue) && (
          <div className="flex items-center gap-x-3">
            <SearchInput
              onSearch={handleSearch}
              placeholder={intl.get('digitalHuman.management.searchPlaceholder')}
            />
            {isAdmin && (
              <Button type="primary" icon={<IconFont type="icon-add" />} onClick={handleCreate}>
                {intl.get('digitalHuman.management.createShort')}
              </Button>
            )}
            <Tooltip title={intl.get('digitalHuman.management.refresh')}>
              <Button type="text" icon={<IconFont type="icon-refresh" />} onClick={handleRefresh} />
            </Tooltip>
          </div>
        )}
      </div>
      {renderContent()}

      <DeleteModal
        open={deleteModalVisible}
        onCancel={() => {
          setDeleteModalVisible(false)
          setSelectedItem(undefined)
        }}
        onOk={() => {
          handleRefresh()
        }}
        deleteData={selectedItem}
      />
    </div>
  )
}

export default memo(Management)
