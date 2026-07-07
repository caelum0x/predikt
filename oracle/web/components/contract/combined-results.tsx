import { Answer } from 'common/answer'
import { Contract } from 'common/contract'
import { TopLevelPost } from 'common/top-level-post'
import { buildArray } from 'common/util/array'
import { sortBy } from 'lodash'
import { Key, ReactNode, useEffect, useRef, useState } from 'react'
import { PostRow } from '../posts/post-row'
import {
  SearchParams,
  SORT_KEY,
  SORTS_MIXING_POSTS_AND_MARKETS,
  TOPIC_FILTER_KEY,
} from '../search'
import {
  actionColumn,
  boostedColumn,
  liquidityColumn,
  probColumn,
  traderColumn,
} from './contract-table-col-formats'
import { ContractRow } from './contracts-table'

type CombinedResultsProps = {
  contracts: Contract[]
  posts: TopLevelPost[]
  searchParams: SearchParams
  onContractClick?: (contract: Contract) => void
  highlightContractIds?: string[]
  answersByContractId?: { [contractId: string]: Answer[] }
  hideAvatars?: boolean
  hideActions?: boolean
  hasBets?: boolean
}

// Type guard to check if an item is a Contract
function isContract(item: Contract | TopLevelPost): item is Contract {
  return 'mechanism' in item
}

// Type guard to check if an item is a Post
function isPost(item: Contract | TopLevelPost): item is TopLevelPost {
  return 'title' in item && !('mechanism' in item) // Ensure it's not also a contract like object
}

// Approximate rendered height of a collapsed row, used to reserve space for
// off-screen rows so scroll position and the page scrollbar stay stable while
// their real (hook-heavy) content is unmounted.
const ROW_PLACEHOLDER_MIN_HEIGHT = 68

/**
 * List-windowing wrapper. Renders a lightweight placeholder until the row
 * scrolls near the viewport, then mounts the real content and keeps it mounted.
 *
 * This mounts the expensive per-row content (ContractRow subscribes live to its
 * contract and loads saved metrics via hooks) only for rows the user can
 * actually reach, instead of mounting every row in a long, infinitely-growing
 * feed at once. Uses the same IntersectionObserver approach as the app's other
 * visibility utilities (see widgets/visibility-observer, hooks/use-is-visible),
 * so no new dependency is introduced.
 */
function WindowedRow(props: { children: ReactNode }) {
  const { children } = props
  const [isMounted, setIsMounted] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = ref.current
    // Once mounted we keep the row mounted (preserves its state and avoids
    // remount flicker while scrolling back and forth), so stop observing.
    if (!element || isMounted) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsMounted(true)
          observer.unobserve(element)
        }
      },
      // Pre-mount rows roughly one-and-a-half screens ahead of the viewport so
      // content is ready before it scrolls into view (mirrors the buffer used
      // by LoadMoreUntilNotVisible).
      { rootMargin: '150% 0px' }
    )
    observer.observe(element)
    return () => observer.unobserve(element)
  }, [isMounted])

  return (
    <div
      ref={ref}
      style={isMounted ? undefined : { minHeight: ROW_PLACEHOLDER_MIN_HEIGHT }}
    >
      {isMounted ? children : null}
    </div>
  )
}

export function CombinedResults(props: CombinedResultsProps) {
  const {
    contracts,
    posts,
    searchParams,
    onContractClick,
    highlightContractIds,
    answersByContractId,
    hideAvatars,
    hideActions,
    hasBets,
  } = props

  const sort =
    searchParams[TOPIC_FILTER_KEY] === 'recent'
      ? undefined
      : searchParams[SORT_KEY]
  let combinedItems: (Contract | TopLevelPost)[] = []
  combinedItems =
    sort && SORTS_MIXING_POSTS_AND_MARKETS.includes(sort)
      ? sortBy([...contracts, ...posts], (item) => {
          if (sort === 'newest') return -item.createdTime
          if (sort === 'score') return -item.importanceScore
          return 0
        })
      : [...contracts, ...posts]
  if (!combinedItems.length) return null

  // Define columns for ContractRow, similar to how ContractsTable did
  const contractDisplayColumns = buildArray([
    !hasBets && boostedColumn,
    traderColumn,
    liquidityColumn,
    probColumn,
    !hideActions && actionColumn,
  ])

  return (
    <>
      {combinedItems.map((item) => {
        if (isContract(item)) {
          return (
            <WindowedRow key={item.id as Key}>
              <ContractRow
                contract={item}
                onClick={
                  onContractClick ? () => onContractClick(item) : undefined
                }
                highlighted={highlightContractIds?.includes(item.id)}
                answers={answersByContractId?.[item.id]}
                hideAvatar={hideAvatars}
                columns={contractDisplayColumns} // Pass the defined columns
                showPosition={hasBets}
              />
            </WindowedRow>
          )
        } else if (isPost(item)) {
          return (
            <WindowedRow key={item.id as Key}>
              <PostRow
                post={item}
                highlighted={highlightContractIds?.includes(item.id)} // Assuming posts can also be highlighted by ID
                hideAvatar={hideAvatars}
              />
            </WindowedRow>
          )
        }
        return null // Should not be reached if type guards are exhaustive
      })}
    </>
  )
}
