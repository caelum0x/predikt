import { ExternalLinkIcon } from '@heroicons/react/solid'
import Link from 'next/link'
import Masonry from 'react-masonry-css'
import { Row } from 'web/components/layout/row'
import { Card } from 'web/components/widgets/card'

export const LabCard = (props: {
  title: string
  description?: string
  href: string
  onClick?: () => void
  target?: string
  icon?: React.ReactNode
}) => {
  const { title, description, href, onClick, target, icon } = props

  return (
    <Link href={href} onClick={onClick} target={target} className="mb-4 block">
      <Card className="hover:text-primary-800 hover:bg-primary-100 flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center justify-between">
          <Row className="items-center gap-2 text-lg font-semibold">
            {icon}
            {title}
          </Row>
          {target && (
            <ExternalLinkIcon className="ml-auto inline-block h-4 w-4" />
          )}
        </div>
        {description && <p className="text-ink-600">{description}</p>}
      </Card>
    </Link>
  )
}

export const LabSection = (props: { children: React.ReactNode }) => (
  <Masonry
    breakpointCols={{ default: 2, 768: 1 }}
    className="-ml-4 flex w-auto"
    columnClassName="pl-4 bg-clip-padding"
  >
    {props.children}
  </Masonry>
)
