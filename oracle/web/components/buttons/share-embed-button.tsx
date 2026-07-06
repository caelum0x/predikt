import { CodeIcon, PhotographIcon } from '@heroicons/react/outline'
import toast from 'react-hot-toast'

import { Contract, contractPath } from 'common/contract'
import { getContractOGProps } from 'common/contract-seo'
import { DOMAIN } from 'common/envs/constants'
import { buildOgUrl } from 'common/util/og'
import { removeUndefinedProps } from 'common/util/object'
import { copyToClipboard } from 'web/lib/util/copy'
import { track } from 'web/lib/service/analytics'
import { Button } from './button'
import { Col } from '../layout/col'
import { Modal } from '../layout/modal'
import { Row } from '../layout/row'
import clsx from 'clsx'

export function embedContractCode(contract: Contract) {
  const title = contract.question
  const src = `https://${DOMAIN}/embed${contractPath(contract)}`
  return `<iframe src="${src}" title="${title}" frameborder="0" style="position: relative; left:50%; transform: translateX(-50%); width:90%; height:18rem; max-width: 35rem;"></iframe>`
}

/** Real OG share image for this market (rendered by /api/og/market). */
export function contractOgImageUrl(contract: Contract) {
  return buildOgUrl(
    removeUndefinedProps(getContractOGProps(contract)) as Record<
      string,
      string
    >,
    'market'
  )
}

/**
 * Modal that surfaces the embeddable widget: a copyable <iframe> snippet plus
 * the OG share image. Plain copy, icon-first. No auth needed to view the embed.
 */
export function EmbedContractModal(props: {
  contract: Contract
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const { contract, open, setOpen } = props
  const iframeCode = embedContractCode(contract)
  const imageUrl = contractOgImageUrl(contract)

  return (
    <Modal open={open} setOpen={setOpen}>
      <Col className="bg-canvas-0 gap-4 rounded p-6">
        <Row className="text-ink-1000 items-center gap-2 text-lg font-semibold">
          <CodeIcon className="h-5 w-5" aria-hidden />
          <span>Embed this question</span>
        </Row>

        {/* Live preview of the actual widget inside a real iframe. */}
        <div className="border-ink-200 bg-canvas-50 overflow-hidden rounded-lg border">
          <iframe
            src={`https://${DOMAIN}/embed${contractPath(contract)}`}
            title={contract.question}
            className="h-72 w-full"
            frameBorder={0}
          />
        </div>

        <Col className="gap-1.5">
          <span className="text-ink-700 text-sm font-medium">
            Paste this anywhere
          </span>
          <textarea
            readOnly
            value={iframeCode}
            onClick={(e) => e.currentTarget.select()}
            className="bg-canvas-50 border-ink-300 text-ink-800 h-24 w-full resize-none rounded-md p-2 font-mono text-xs"
          />
          <Row className="gap-2">
            <Button
              // "indigo" is the historical alias for the primary color in
              // ColorType — it renders bg-primary-500 (see buttonClass), so it
              // follows the theme primary hue, not a literal indigo.
              color="indigo"
              size="sm"
              className="gap-1"
              onClick={() => {
                copyToClipboard(iframeCode)
                toast.success('Embed code copied!', {
                  icon: <CodeIcon className="h-4 w-4" />,
                })
                track('copy embed code')
              }}
            >
              <CodeIcon className="h-4 w-4" aria-hidden />
              Copy code
            </Button>
            <Button
              color="gray-outline"
              size="sm"
              className="gap-1"
              onClick={() => {
                copyToClipboard(imageUrl)
                toast.success('Image link copied!', {
                  icon: <PhotographIcon className="h-4 w-4" />,
                })
                track('copy embed image')
              }}
            >
              <PhotographIcon className="h-4 w-4" aria-hidden />
              Copy image link
            </Button>
          </Row>
        </Col>
      </Col>
    </Modal>
  )
}

export function ShareEmbedButton(props: {
  contract: Contract
  className?: string
}) {
  const { contract, className } = props
  return (
    <Button
      color="gray-outline"
      size="sm"
      className={clsx('gap-1', className)}
      onClick={() => {
        copyToClipboard(embedContractCode(contract))
        toast.success('Embed code copied!', {
          icon: <CodeIcon className="h-4 w-4" />,
        })
        track('copy embed code')
      }}
    >
      Embed
    </Button>
  )
}

export function ShareIRLButton(props: {
  contract: Contract
  className?: string
}) {
  const { contract, className } = props

  return (
    <Button
      color="gray-outline"
      size="sm"
      className={clsx('gap-1', className)}
      onClick={() => {
        copyToClipboard(`https://${DOMAIN}/embed${contractPath(contract)}?qr`)
        toast.success('Url to IRL-mode market copied!', {
          icon: <CodeIcon className="h-4 w-4" />,
        })
        track('copy irl url')
      }}
    >
      IRL
    </Button>
  )
}
