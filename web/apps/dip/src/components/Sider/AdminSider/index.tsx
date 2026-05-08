import { Modal, message } from 'antd'
import clsx from 'classnames'
import { useCallback, useEffect, useMemo } from 'react'
import intl from 'react-intl-universal'
import { createSearchParams, useLocation, useNavigate } from 'react-router-dom'
import type { SiderType } from '@/routes/types'
import { getRouteByPath } from '@/routes/utils'
import { useLanguageStore } from '@/stores/languageStore'
import { useOEMConfigStore } from '@/stores/oemConfigStore'
import { useUserHistoryStore } from '@/stores/userHistoryStore'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { useUserWorkPlanStore } from '@/stores/userWorkPlanStore'
import { ExternalLinksSection } from '../components/ExternalLinksMenu'
import { HistorySection } from '../components/HistorySection'
import { SiderFooterUser } from '../components/SiderFooterUser'
import { StoreMenuSection } from '../components/StoreMenuSection'
import { StudioMenuSection } from '../components/StudioMenuSection'
import { WorkPlanSection } from '../components/WorkPlanSection'

interface AdminSiderProps {
  collapsed: boolean
  onCollapse: (collapsed: boolean) => void
  layout?: SiderType
}
const AdminSider = ({ collapsed, onCollapse, layout = 'entry' }: AdminSiderProps) => {
  const isHomeSider = layout === 'entry'
  const navigate = useNavigate()
  const location = useLocation()
  const [, messageContextHolder] = message.useMessage()
  const [modal, modalContextHolder] = Modal.useModal()
  const {
    plans,
    total,
    fetchPlans,
    refreshPlansOnFocus,
    pausePlan,
    resumePlan,
    deletePlan,
    selectedPlanId,
    setSelectedPlanId,
  } = useUserWorkPlanStore()
  const {
    sessions: historySessions,
    total: historyTotal,
    fetchSessions,
    refreshSessionsOnFocus,
    selectedSessionKey,
    setSelectedSessionKey,
    deleteHistorySession,
  } = useUserHistoryStore()
  const { language } = useLanguageStore()
  const { getOEMResourceConfig } = useOEMConfigStore()
  const oemResourceConfig = getOEMResourceConfig(language)
  const modules = useUserInfoStore((s) => s.modules)
  const roleIds = useMemo(() => new Set<string>([]), [])
  const hasStudio = modules.includes('studio')
  const hasStore = modules.includes('store')

  const selectedKey = useCallback(() => {
    const pathname = location.pathname
    if (pathname === '/') return 'home'
    const route = getRouteByPath(pathname)
    return route?.key || 'home'
  }, [location.pathname])()
  const topPlans = useMemo(() => plans.slice(0, 5), [plans])
  const hasPlanMore = total > 5
  const topHistorySessions = useMemo(() => historySessions.slice(0, 5), [historySessions])
  const hasHistoryMore = historyTotal > 5

  const handleOpenPlanDetail = useCallback(
    (planId: string, _agentId: string, sessionId: string) => {
      navigate({
        pathname: `/studio/work-plan/${planId}`,
        search: `?${createSearchParams({
          sessionKey: sessionId,
        })}`,
      })
    },
    [navigate],
  )

  useEffect(() => {
    if (!hasStudio) return
    void fetchPlans()
  }, [fetchPlans, hasStudio])

  useEffect(() => {
    if (!hasStudio) return
    void fetchSessions()
  }, [fetchSessions, hasStudio])

  useEffect(() => {
    const match = location.pathname.match(/^\/studio\/history\/([^/]+)$/)
    setSelectedSessionKey(match ? decodeURIComponent(match[1]) : undefined)
  }, [location.pathname, setSelectedSessionKey])

  useEffect(() => {
    const match = location.pathname.match(/^\/studio\/work-plan\/([^/]+)$/)
    setSelectedPlanId(match ? decodeURIComponent(match[1]) : undefined)
  }, [location.pathname, setSelectedPlanId])

  useEffect(() => {
    if (!hasStudio) return
    const handleWindowFocus = () => {
      void refreshPlansOnFocus()
      void refreshSessionsOnFocus()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshPlansOnFocus()
        void refreshSessionsOnFocus()
      }
    }
    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshPlansOnFocus, refreshSessionsOnFocus, hasStudio])

  const logoUrl = useMemo(() => {
    return oemResourceConfig?.['logo.png']
  }, [oemResourceConfig])

  return (
    <div className="flex flex-col h-full px-0 pt-4 pb-1 overflow-hidden">
      {messageContextHolder}
      {modalContextHolder}
      {isHomeSider ? (
        <div
          className={clsx(
            'flex items-center gap-2 pb-4',
            collapsed ? 'justify-center pl-1.5 pr-1.5' : 'justify-between pl-3 pr-2',
          )}
        >
          <img src={logoUrl} alt="logo" className={clsx('h-8 w-auto', collapsed && 'hidden')} />
        </div>
      ) : null}

      {/* 菜单内容 */}
      <div className="flex-1 flex flex-col dip-hideScrollbar">
        {hasStudio ? (
          <div className="flex-1">
            <StudioMenuSection
              collapsed={collapsed}
              selectedKey={selectedKey}
              roleIds={roleIds}
              navigate={navigate}
              allowedKeys={['digital-human', 'skills']}
            />

            {!collapsed && topPlans.length > 0 ? (
              <WorkPlanSection
                plans={topPlans}
                hasMore={hasPlanMore}
                total={plans.length}
                selectedPlanId={selectedPlanId}
                onMore={() => navigate('/studio/work-plan')}
                onOpenPlanDetail={(planId, agentId, sessionId) => {
                  setSelectedPlanId(planId)
                  handleOpenPlanDetail(planId, agentId, sessionId)
                }}
                onPausePlan={pausePlan}
                onResumePlan={resumePlan}
                onDeletePlan={deletePlan}
              />
            ) : null}

            {!collapsed && topHistorySessions.length > 0 ? (
              <HistorySection
                sessions={topHistorySessions}
                hasMore={hasHistoryMore}
                total={historySessions.length}
                selectedSessionKey={selectedSessionKey}
                onMore={() => navigate('/studio/history')}
                onOpenHistoryDetail={(sessionKey) => {
                  setSelectedSessionKey(sessionKey)
                  navigate(`/studio/history/${sessionKey}`)
                }}
                onDeleteHistory={(session) => {
                  modal.confirm({
                    title: intl.get('sider.confirmDelete'),
                    content: intl.get('sider.confirmDeleteCommon'),
                    okText: intl.get('global.ok'),
                    okType: 'primary',
                    okButtonProps: { danger: true },
                    cancelText: intl.get('global.cancel'),
                    onOk: async () => {
                      await deleteHistorySession(session.key)
                    },
                  })
                }}
              />
            ) : null}
          </div>
        ) : null}
        {hasStore ? (
          <div
            className={clsx(hasStudio ? 'mt-auto shrink-0' : 'flex-1 flex flex-col justify-start')}
          >
            <StoreMenuSection
              collapsed={collapsed}
              selectedKey={selectedKey}
              roleIds={roleIds}
              navigate={navigate}
            />
          </div>
        ) : null}
        <ExternalLinksSection collapsed={collapsed} roleIds={roleIds} />
      </div>

      {collapsed ? null : (
        <div className="mx-3 my-2 h-px shrink-0 bg-[var(--dip-border-color)]" aria-hidden />
      )}

      <SiderFooterUser collapsed={collapsed} onCollapse={onCollapse} />
    </div>
  )
}

export default AdminSider
