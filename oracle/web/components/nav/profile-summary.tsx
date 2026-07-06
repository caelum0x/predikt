import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  mergeEntitlements,
  useOptimisticEntitlements,
} from 'web/hooks/use-optimistic-entitlements'
import { User } from 'web/lib/firebase/users'
import { trackCallback } from 'web/lib/service/analytics'
import { useEmbeddedWallet } from 'web/hooks/use-embedded-wallet'
import { Avatar } from '../widgets/avatar'
import { TokenNumber } from '../widgets/token-number'

export function ProfileSummary(props: { user: User; className?: string }) {
  const { user, className } = props
  const optimisticContext = useOptimisticEntitlements()

  // On-chain cash balance. When the crypto path is off (the default), this stays
  // inert (ready with no address) and nothing extra renders — so the play-money
  // display is unchanged. When on, we show the real USDC balance in plain words.
  const wallet = useEmbeddedWallet()
  const showCash = wallet.ready && !!wallet.address

  // Merge server entitlements with optimistic updates from shop
  const effectiveEntitlements = mergeEntitlements(
    user.entitlements,
    optimisticContext?.optimisticEntitlements ?? []
  )

  const currentPage = usePathname() ?? ''
  const url = `/${user.username}`
  return (
    <Link
      href={url}
      onClick={trackCallback('sidebar: profile')}
      className={clsx(
        'text-ink-700 hover:bg-primary-100 hover:text-ink-900 group flex w-full shrink-0 flex-row items-center truncate rounded-md py-3',
        className,
        currentPage === url && 'bg-ink-100 text-primary-700'
      )}
    >
      <div className="w-2 shrink" />
      <Avatar
        avatarUrl={user.avatarUrl}
        username={user.username}
        noLink
        size="md"
        entitlements={effectiveEntitlements}
        displayContext="profile_sidebar"
      />
      <div className="mr-1 w-2 shrink-[2]" />
      <div className="shrink-0 grow">
        {user.cashBalance < 1 && <div className="text-sm">{user.name}</div>}
        <div className="flex items-center text-sm">
          <TokenNumber
            amount={user?.balance}
            numberType="animated"
            className="mr-2 text-primary-600 dark:text-primary-400"
          />
        </div>
        {/* remove this after deprecating sweeps */}
        {user.cashBalance >= 1 && (
          <TokenNumber
            className="text-sm text-amber-600 dark:text-amber-400"
            amount={user.cashBalance}
            coinType="sweepies"
          />
        )}
        {/* Real cash balance (on-chain path only). Plain words, no hex. */}
        {showCash && (
          <div className="text-teal-600 dark:text-teal-400 flex items-center text-sm">
            <span className="font-semibold">
              {wallet.usdcFormatted ?? '—'}
            </span>
            <span className="text-ink-500 ml-1">cash</span>
          </div>
        )}
      </div>
      <div className="w-2 shrink" />
    </Link>
  )
}
