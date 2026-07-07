import { useEffect, useState } from 'react'
import { Button } from 'web/components/buttons/button'
import { ConfirmationButton } from 'web/components/buttons/confirmation-button'
import { Page } from 'web/components/layout/page'
import { Row } from 'web/components/layout/row'
import { NoSEO } from 'web/components/NoSEO'
import ShortToggle from 'web/components/widgets/short-toggle'
import { Title } from 'web/components/widgets/title'
import { useAdmin } from 'web/hooks/use-admin'
import { useRedirectIfSignedOut } from 'web/hooks/use-redirect-if-signed-out'
import { handleCreateSportsMarkets } from 'web/lib/admin/create-sports-markets'
import { api } from 'web/lib/api/api'
import { db } from 'web/lib/supabase/db'
import { LabCard } from 'web/components/widgets/lab-card'
import {
  TbReceipt,
  TbTicket,
  TbUserPlus,
  TbGift,
  TbFish,
  TbChartLine,
  TbChartBar,
  TbActivity,
  TbDatabase,
  TbBallFootball,
  TbFlag,
  TbShirt,
  TbPalette,
  TbMoon,
  TbUser,
  TbUsers,
  TbCircleCheck,
} from 'react-icons/tb'

export default function AdminPage() {
  useRedirectIfSignedOut()
  const isAdmin = useAdmin()
  const [manaStatus, setManaStatus] = useState(true)
  const [loanStatus, setLoanStatus] = useState(true)
  const [togglesEnabled, setTogglesEnabled] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [isFinished, setIsFinished] = useState(false)

  useEffect(() => {
    db.from('system_trading_status')
      .select('*')
      .then((result) => {
        const statuses = result.data ?? []
        setManaStatus(statuses.find((s) => s.token === 'MANA')?.status ?? true)
        setLoanStatus(statuses.find((s) => s.token === 'LOAN')?.status ?? true)
      })
  }, [])

  const toggleStatus = async (token: 'MANA' | 'LOAN') => {
    if (!togglesEnabled) return
    const result = await api('toggle-system-trading-status', { token })
    if (token === 'MANA') {
      setManaStatus(result.status)
    } else {
      setLoanStatus(result.status)
    }
  }

  if (!isAdmin) return <></>

  return (
    <Page trackPageView={'admin page'}>
      <NoSEO />
      <div className="mx-8">
        <Title>Admin</Title>
        <Row className="mb-4 flex items-center justify-around gap-2 p-2">
          <span> Toggles: {togglesEnabled ? 'Unlocked' : 'Locked'} </span>
          <ShortToggle
            on={togglesEnabled}
            setOn={setTogglesEnabled}
            disabled={false}
          />
          <span>Coins trading: {manaStatus ? 'Enabled' : 'Disabled'}</span>
          <ShortToggle
            on={manaStatus}
            setOn={() => toggleStatus('MANA')}
            disabled={!togglesEnabled}
          />
          <span>Loans: {loanStatus ? 'Enabled' : 'Disabled'}</span>
          <ShortToggle
            on={loanStatus}
            setOn={() => toggleStatus('LOAN')}
            disabled={!togglesEnabled}
          />
        </Row>

        <LabCard
          title="sales"
          href="/admin/sales"
          icon={<TbReceipt className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="manifest tickets"
          href="/admin/tickets"
          icon={<TbTicket className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="new users"
          href="/admin/new-users"
          icon={<TbUserPlus className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="prize payouts"
          href="/admin/prize"
          icon={<TbGift className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="whales"
          href="/admin/whales"
          icon={<TbFish className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="stats"
          href="/stats"
          icon={<TbChartLine className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="umami"
          href="https://analytics.eu.umami.is/websites/ee5d6afd-5009-405b-a69f-04e3e4e3a685"
          icon={<TbChartBar className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="grafana"
          description="db performance"
          href="https://oracle.grafana.net/d/TFZtEJh4k/supabase"
          icon={<TbActivity className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="postgres logs"
          href="https://app.supabase.com/project/pxidrgkatumlvfqaxcll/logs/postgres-logs"
          icon={<TbDatabase className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="sports markets"
          href="/admin/sports"
          icon={<TbBallFootball className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="reports"
          href="/admin/reports"
          icon={<TbFlag className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="merch management"
          href="/admin/merch"
          icon={<TbShirt className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="design system"
          href="/styles"
          icon={<TbPalette className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="test new user"
          href="/admin/test-user"
          icon={<TbMoon className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="update user"
          href="/admin/update-user"
          icon={<TbUser className="h-5 w-5" aria-hidden />}
        />
        <LabCard
          title="user info & account management"
          href="/admin/user-info"
          icon={<TbUsers className="h-5 w-5" aria-hidden />}
        />
        <Row className="gap-2">
          <Button onClick={() => api('refresh-all-clients', {})}>
            Refresh all clients
          </Button>
          <ConfirmationButton
            openModalBtn={{
              label: isLoading ? 'Creating...' : 'Create Sports Markets',
              disabled: isLoading,
            }}
            submitBtn={{
              label: 'Create',
              isSubmitting: isLoading,
              color: 'green',
            }}
            onSubmit={() =>
              handleCreateSportsMarkets(setIsLoading, setIsFinished)
            }
          >
            <p>Are you sure you want to create new sports markets?</p>
            <p>
              Make sure you are logged into the Predikt account and have
              ~50,000 coins.
            </p>
          </ConfirmationButton>
          {isFinished && (
            <div className="mt-4 inline-flex items-center gap-1 text-green-600">
              <TbCircleCheck className="h-5 w-5 shrink-0" aria-hidden />
              Sports markets created successfully!
            </div>
          )}
        </Row>
      </div>
    </Page>
  )
}

const Badge = (props: { src: string; href: string }) => {
  return (
    <a href={props.href}>
      <img src={props.src} alt="" />
    </a>
  )
}
