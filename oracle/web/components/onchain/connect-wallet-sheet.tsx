import { CubeIcon, ShieldExclamationIcon } from '@heroicons/react/solid'
import clsx from 'clsx'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { Button } from 'web/components/buttons/button'
import { Modal } from 'web/components/layout/modal'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import { OnchainWalletState } from 'web/hooks/use-onchain-wallet'

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/**
 * Self-custodial wallet sheet: create a fresh wallet or import an existing one,
 * then view the address + live USDC balance. Purely for the on-chain (crypto)
 * path — off-chain markets never touch this. The recovery phrase is encrypted
 * on this device and never leaves it.
 */
export function ConnectWalletSheet(props: {
  open: boolean
  setOpen: (open: boolean) => void
  wallet: OnchainWalletState
}) {
  const { open, setOpen, wallet } = props
  const [mode, setMode] = useState<'choose' | 'import'>('choose')
  const [phrase, setPhrase] = useState('')

  const connected = !!wallet.address

  const onImport = async () => {
    try {
      await wallet.importPhrase(phrase)
      setPhrase('')
      setMode('choose')
      toast.success('Wallet connected')
    } catch {
      // error surfaced via wallet.error
    }
  }

  const onCreate = async () => {
    await wallet.create()
    if (!wallet.error) toast.success('Wallet created')
  }

  return (
    <Modal open={open} setOpen={setOpen} size="sm">
      <Col className="bg-canvas-0 gap-4 rounded-lg p-6">
        <Row className="items-center gap-2">
          <CubeIcon className="text-primary-600 h-6 w-6" />
          <span className="text-ink-900 text-lg font-semibold">Crypto wallet</span>
        </Row>

        {connected ? (
          <Col className="gap-3">
            <Col className="bg-canvas-50 gap-1 rounded-md p-3">
              <span className="text-ink-500 text-xs">Address</span>
              <span className="text-ink-900 font-mono text-sm">
                {shortAddress(wallet.address as string)}
              </span>
            </Col>
            <Col className="bg-canvas-50 gap-1 rounded-md p-3">
              <span className="text-ink-500 text-xs">USDC balance</span>
              <span className="text-ink-900 text-xl font-semibold">
                {wallet.usdcFormatted ?? '—'}{' '}
                <span className="text-ink-500 text-sm font-normal">USDC</span>
              </span>
            </Col>
            <Row className="gap-2">
              <Button
                color="gray-outline"
                size="sm"
                className="flex-1"
                onClick={() => wallet.refresh({ force: true })}
              >
                Refresh
              </Button>
              <Button
                color="red-outline"
                size="sm"
                className="flex-1"
                onClick={wallet.disconnect}
              >
                Disconnect
              </Button>
            </Row>
          </Col>
        ) : mode === 'choose' ? (
          <Col className="gap-3">
            <p className="text-ink-600 text-sm">
              Trade crypto markets with USDC on Polygon. Your keys stay on this
              device.
            </p>
            <Row className="bg-canvas-50 items-start gap-2 rounded-md p-3">
              <ShieldExclamationIcon className="text-primary-600 mt-0.5 h-5 w-5 shrink-0" />
              <span className="text-ink-600 text-xs">
                On the web, this wallet is only as safe as this site — if the site
                is compromised, your keys could be too. Approving a market lets
                the exchange move your prediction tokens for that trade.
              </span>
            </Row>
            <Button
              color="blue"
              size="lg"
              loading={wallet.loading}
              onClick={onCreate}
            >
              Create wallet
            </Button>
            <Button
              color="gray-outline"
              size="lg"
              onClick={() => setMode('import')}
            >
              Import wallet
            </Button>
            {wallet.error && (
              <span className="text-scarlet-600 text-sm">{wallet.error}</span>
            )}
          </Col>
        ) : (
          <Col className="gap-3">
            <p className="text-ink-600 text-sm">
              Enter your recovery phrase or private key.
            </p>
            <textarea
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              rows={3}
              placeholder="word1 word2 … or 0x…"
              className={clsx(
                'bg-canvas-0 border-ink-300 text-ink-900 w-full rounded-md border p-3',
                'focus:border-primary-500 focus:outline-none focus:ring-1'
              )}
            />
            {wallet.error && (
              <span className="text-scarlet-600 text-sm">{wallet.error}</span>
            )}
            <Row className="gap-2">
              <Button
                color="gray-outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  setMode('choose')
                  setPhrase('')
                }}
              >
                Back
              </Button>
              <Button
                color="blue"
                size="sm"
                className="flex-1"
                loading={wallet.loading}
                disabled={!phrase.trim()}
                onClick={onImport}
              >
                Connect
              </Button>
            </Row>
          </Col>
        )}
      </Col>
    </Modal>
  )
}

/** Small pill button that opens the wallet sheet and shows connection state. */
export function ConnectWalletButton(props: {
  wallet: OnchainWalletState
  onOpen: () => void
}) {
  const { wallet, onOpen } = props
  return (
    <Button color="blue" size="sm" onClick={onOpen}>
      <Row className="items-center gap-1.5">
        <CubeIcon className="h-4 w-4" />
        {wallet.address
          ? `${wallet.usdcFormatted ?? '—'} USDC`
          : 'Connect wallet'}
      </Row>
    </Button>
  )
}
