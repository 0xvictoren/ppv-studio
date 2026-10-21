import { useAccount, useReadContract, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi } from 'viem'
import { CHAIN_ID, USDC_ADDRESS, PPW_ADDRESS, PPW_ABI, explorerAddr } from '../lib/contract'
import { formatUsdc, shortAddr } from '../lib/utils'
import { ExternalLink, Wifi } from 'lucide-react'

export default function WalletPanel() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const wrongChain = isConnected && chainId !== CHAIN_ID

  const { data: usdcBal } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 5000 },
  })

  const { data: escrowBal } = useReadContract({
    address: PPW_ADDRESS,
    abi: PPW_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 5000 },
  })

  const { data: pending } = useReadContract({
    address: PPW_ADDRESS,
    abi: PPW_ABI,
    functionName: 'pendingWithdrawal',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 5000 },
  })

  const { data: feeBps } = useReadContract({
    address: PPW_ADDRESS,
    abi: PPW_ABI,
    functionName: 'feeBps',
    chainId: CHAIN_ID,
    query: { refetchInterval: 30000 },
  })

  const { data: isPaused } = useReadContract({
    address: PPW_ADDRESS,
    abi: PPW_ABI,
    functionName: 'paused',
    chainId: CHAIN_ID,
    query: { refetchInterval: 15000 },
  })

  return (
    <div className="space-y-4">
      {/* Connect */}
      <div className="flex items-center justify-between">
        <div>
          {isConnected && address ? (
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--ink)' }}>
                <span className="mono">{shortAddr(address)}</span>
                <a href={explorerAddr(address)} target="_blank" rel="noopener" style={{ color: 'var(--subtle)' }}>
                  <ExternalLink size={12} />
                </a>
              </div>
              <div className="text-xs" style={{ color: 'var(--subtle)' }}>
                Arc Testnet · Chain {CHAIN_ID}
              </div>
            </div>
          ) : (
            <span className="text-sm" style={{ color: 'var(--muted)' }}>Not connected</span>
          )}
        </div>
        <ConnectKitButton />
      </div>

      {/* Wrong chain warning */}
      {wrongChain && (
        <div className="rounded-xl p-3 flex items-center justify-between" style={{ background: 'rgba(232,109,122,0.15)', border: '1px solid rgba(232,109,122,0.3)' }}>
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--danger)' }}>
            <Wifi size={14} />
            Wrong network (Chain {chainId})
          </div>
          <button
            onClick={() => switchChain({ chainId: CHAIN_ID })}
            disabled={isSwitching}
            className="text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: 'var(--danger)', color: '#fff' }}
          >
            {isSwitching ? 'Switching…' : 'Switch to Arc Testnet'}
          </button>
        </div>
      )}

      {/* Balances */}
      {isConnected && address && (
        <div className="grid grid-cols-2 gap-3">
          <BalanceCard label="Wallet USDC" value={usdcBal !== undefined ? formatUsdc(usdcBal) : '—'} />
          <BalanceCard label="Escrow Balance" value={escrowBal !== undefined ? formatUsdc(escrowBal) : '—'} accent />
          {pending && pending[0] > 0n && (
            <BalanceCard
              label="Pending Withdrawal"
              value={formatUsdc(pending[0])}
              sub={`Available at ${new Date(Number(pending[1]) * 1000).toLocaleTimeString()}`}
            />
          )}
          {feeBps !== undefined && (
            <BalanceCard label="Platform Fee" value={`${feeBps / 100}.${(feeBps % 100).toString().padStart(2,'0')}%`} />
          )}
        </div>
      )}

      {/* Contract info */}
      <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--subtle)' }}>Contract</span>
          <a href={explorerAddr(PPW_ADDRESS)} target="_blank" rel="noopener"
            className="mono flex items-center gap-1" style={{ color: 'var(--accent)' }}>
            {shortAddr(PPW_ADDRESS)} <ExternalLink size={10} />
          </a>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--subtle)' }}>Status</span>
          <span style={{ color: isPaused ? 'var(--danger)' : 'var(--success)' }}>
            {isPaused === undefined ? '…' : isPaused ? 'Paused' : 'Active'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--subtle)' }}>USDC</span>
          <span className="mono" style={{ color: 'var(--muted)' }}>{shortAddr(USDC_ADDRESS)}</span>
        </div>
      </div>
    </div>
  )
}

function BalanceCard({ label, value, sub, accent }: {
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>{label}</div>
      <div className="display text-lg font-semibold tabular-nums" style={{ color: accent ? 'var(--accent)' : 'var(--ink)' }}>
        {value}
      </div>
      {sub && <div className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{sub}</div>}
    </div>
  )
}
