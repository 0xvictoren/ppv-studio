import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { parseAbiItem, type Log } from 'viem'
import { CHAIN_ID, PPW_ADDRESS, EXPLORER_BASE } from '../lib/contract'
import { formatUsdc, shortAddr } from '../lib/utils'
import { ExternalLink, Activity } from 'lucide-react'

interface ActivityItem {
  type: string
  description: string
  txHash: string
  blockNumber: bigint
  extra?: string
}

const DEPOSITED_EVENT = parseAbiItem('event Deposited(address indexed viewer, uint256 amount)')
const SETTLED_EVENT = parseAbiItem('event Settled(address indexed viewer, address indexed creator, uint256 delta, uint256 fee, uint256 cumulativeAmount)')
const WITHDRAWN_EVENT = parseAbiItem('event Withdrawn(address indexed viewer, uint256 amount)')
const VIDEO_REG_EVENT = parseAbiItem('event VideoRegistered(bytes32 indexed videoId, address indexed creator, uint128 pricePerHour)')
const SESSION_EVENT = parseAbiItem('event SessionKeyAuthorized(address indexed viewer, address indexed key, uint64 expiry, uint128 spendCap)')

export default function ActivityPanel() {
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const [items, setItems] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(false)
  const [totalSettled, setTotalSettled] = useState(0n)
  const [creatorsPaid, setCreatorsPaid] = useState(new Set<string>())

  async function loadActivity() {
    if (!publicClient) return
    setLoading(true)
    try {
      const blockNum = await publicClient.getBlockNumber()
      const fromBlock = blockNum > 5000n ? blockNum - 5000n : 0n

      const [deposited, settled, withdrawn, videoReg, sessions] = await Promise.all([
        publicClient.getLogs({ address: PPW_ADDRESS, event: DEPOSITED_EVENT, fromBlock }),
        publicClient.getLogs({ address: PPW_ADDRESS, event: SETTLED_EVENT, fromBlock }),
        publicClient.getLogs({ address: PPW_ADDRESS, event: WITHDRAWN_EVENT, fromBlock }),
        publicClient.getLogs({ address: PPW_ADDRESS, event: VIDEO_REG_EVENT, fromBlock }),
        publicClient.getLogs({ address: PPW_ADDRESS, event: SESSION_EVENT, fromBlock }),
      ])

      // Compute totals
      let tot = 0n
      const cSet = new Set<string>()
      for (const s of settled) {
        if (s.args.delta) tot += s.args.delta
        if (s.args.creator) cSet.add(s.args.creator)
      }
      setTotalSettled(tot)
      setCreatorsPaid(cSet)

      const all: ActivityItem[] = [
        ...deposited.map((l: Log<bigint, number, false, typeof DEPOSITED_EVENT>) => ({
          type: 'Deposit',
          description: `${shortAddr(l.args.viewer ?? '0x')} deposited ${formatUsdc(l.args.amount ?? 0n)}`,
          txHash: l.transactionHash ?? '',
          blockNumber: l.blockNumber ?? 0n,
        })),
        ...settled.map((l: Log<bigint, number, false, typeof SETTLED_EVENT>) => ({
          type: 'Settled',
          description: `${shortAddr(l.args.viewer ?? '0x')} → ${shortAddr(l.args.creator ?? '0x')}: ${formatUsdc(l.args.delta ?? 0n)}`,
          txHash: l.transactionHash ?? '',
          blockNumber: l.blockNumber ?? 0n,
          extra: `fee ${formatUsdc(l.args.fee ?? 0n)}`,
        })),
        ...withdrawn.map((l: Log<bigint, number, false, typeof WITHDRAWN_EVENT>) => ({
          type: 'Withdrawn',
          description: `${shortAddr(l.args.viewer ?? '0x')} withdrew ${formatUsdc(l.args.amount ?? 0n)}`,
          txHash: l.transactionHash ?? '',
          blockNumber: l.blockNumber ?? 0n,
        })),
        ...videoReg.map((l: Log<bigint, number, false, typeof VIDEO_REG_EVENT>) => ({
          type: 'Video',
          description: `${shortAddr(l.args.creator ?? '0x')} registered video at ${formatUsdc(l.args.pricePerHour ?? 0n)}/hr`,
          txHash: l.transactionHash ?? '',
          blockNumber: l.blockNumber ?? 0n,
        })),
        ...sessions.map((l: Log<bigint, number, false, typeof SESSION_EVENT>) => ({
          type: 'Session',
          description: `${shortAddr(l.args.viewer ?? '0x')} authorized session key ${shortAddr(l.args.key ?? '0x')}`,
          txHash: l.transactionHash ?? '',
          blockNumber: l.blockNumber ?? 0n,
        })),
      ]

      all.sort((a, b) => Number(b.blockNumber - a.blockNumber))
      setItems(all)
    } catch (err) {
      console.error('Activity load error:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadActivity()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient])

  const typeColor: Record<string, string> = {
    Deposit: '#acc6e9',
    Settled: '#8dd89f',
    Withdrawn: '#f9d86d',
    Video: '#c4a1e6',
    Session: '#94a3b8',
  }

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>USDC Settled (last 5k blocks)</div>
          <div className="display text-xl font-bold tabular-nums" style={{ color: 'var(--success)' }}>{formatUsdc(totalSettled)}</div>
        </div>
        <div className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>Creators Paid</div>
          <div className="display text-xl font-bold tabular-nums" style={{ color: 'var(--accent)' }}>{creatorsPaid.size}</div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
          <Activity size={13} /> Recent Events
        </h3>
        <button
          onClick={() => void loadActivity()}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--surface-muted)', color: 'var(--subtle)', border: '1px solid var(--border)' }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {items.length === 0 && !loading && (
        <div className="text-sm text-center py-6" style={{ color: 'var(--subtle)' }}>
          No events found in the last 5,000 blocks.
        </div>
      )}

      <div className="space-y-1.5">
        {items.slice(0, 40).map((item, i) => (
          <div key={i} className="rounded-lg px-3 py-2 flex items-center justify-between"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span
                className="text-xs font-semibold px-1.5 py-0.5 rounded"
                style={{ background: `${typeColor[item.type] ?? '#94a3b8'}20`, color: typeColor[item.type] ?? '#94a3b8' }}
              >
                {item.type}
              </span>
              <span className="text-xs truncate" style={{ color: 'var(--muted)' }}>{item.description}</span>
              {item.extra && <span className="text-xs" style={{ color: 'var(--subtle)' }}>{item.extra}</span>}
            </div>
            {item.txHash && (
              <a
                href={`${EXPLORER_BASE}/tx/${item.txHash}`}
                target="_blank"
                rel="noopener"
                className="ml-2 flex-shrink-0"
                style={{ color: 'var(--subtle)' }}
              >
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
