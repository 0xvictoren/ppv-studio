import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'

import { toast } from 'sonner'
import { PPW_ADDRESS, PPW_ABI, CHAIN_ID } from '../lib/contract'
import { formatUsdc, parseContractError, explorerTx } from '../lib/utils'
import { allStoredReceipts } from '../lib/session'
import TxButton from './TxButton'
import { Send, AlertCircle } from 'lucide-react'

export default function SettlePanel() {
  const { address } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const [receipts, setReceipts] = useState(() => address ? allStoredReceipts(address) : [])
  const [filteredReceipts, setFilteredReceipts] = useState<typeof receipts>([])
  const [loadingFilter, setLoadingFilter] = useState(false)

  const { writeContract, data: hash, isPending, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  async function filterUnsettled() {
    if (!address || !publicClient) return
    setLoadingFilter(true)
    try {
      const fresh = allStoredReceipts(address)
      setReceipts(fresh)
      const filtered: typeof fresh = []
      for (const r of fresh) {
        try {
          const onchain = await publicClient.readContract({
            address: PPW_ADDRESS,
            abi: PPW_ABI,
            functionName: 'settled',
            args: [r.viewer, r.creator],
          })
          if (r.cumulativeAmount > onchain) filtered.push(r)
        } catch {
          filtered.push(r)
        }
      }
      setFilteredReceipts(filtered)
      toast.info(`${filtered.length} unsettled receipt(s) ready.`)
    } finally {
      setLoadingFilter(false)
    }
  }

  function handleSettle() {
    const toSettle = filteredReceipts.length > 0 ? filteredReceipts : receipts
    if (toSettle.length === 0) { toast.error('No receipts stored.'); return }

    const rs = toSettle.map(r => ({
      viewer: r.viewer,
      creator: r.creator,
      cumulativeAmount: r.cumulativeAmount,
      deadline: r.deadline,
    }))
    const sigs = toSettle.map(r => r.signature)

    writeContract({
      address: PPW_ADDRESS,
      abi: PPW_ABI,
      functionName: 'settleBatch',
      args: [rs, sigs],
      chainId: CHAIN_ID,
    }, {
      onSuccess: (txHash) => {
        toast.success(
          <span>Batch settled! <a href={explorerTx(txHash)} target="_blank" rel="noopener" className="underline">View tx</a></span>
        )
        setFilteredReceipts([])
        reset()
      },
      onError: (err) => { toast.error(parseContractError(err)); reset() },
    })
  }

  if (!address) return <p className="text-sm" style={{ color: 'var(--subtle)' }}>Connect your wallet to settle.</p>

  const toSettle = filteredReceipts.length > 0 ? filteredReceipts : receipts

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h3 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
          <Send size={13} /> Settlement
        </h3>

        <p className="text-xs" style={{ color: 'var(--subtle)' }}>
          Anyone can call settleBatch. It submits your stored signed receipts and pays creators their earned USDC.
        </p>

        <button
          onClick={() => void filterUnsettled()}
          disabled={loadingFilter}
          className="w-full py-2 rounded-xl text-xs font-medium"
          style={{ background: 'var(--surface-muted)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          {loadingFilter ? 'Checking on-chain…' : 'Check Unsettled Receipts'}
        </button>

        {receipts.length === 0 ? (
          <div className="flex items-center gap-2 text-xs p-3 rounded-xl" style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}>
            <AlertCircle size={13} />
            No receipts stored. Watch a video first.
          </div>
        ) : (
          <div className="space-y-2">
            {receipts.map((r, i) => {
              const isFiltered = filteredReceipts.some(f => f.viewer === r.viewer && f.creator === r.creator)
              return (
                <div key={i} className="rounded-lg p-2.5 text-xs"
                  style={{
                    background: 'var(--surface-muted)',
                    border: `1px solid ${isFiltered ? 'rgba(141,216,159,0.3)' : 'var(--border)'}`,
                  }}
                >
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--subtle)' }}>Creator</span>
                    <span className="mono" style={{ color: 'var(--muted)' }}>{r.creator.slice(0, 8)}…</span>
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span style={{ color: 'var(--subtle)' }}>Cumulative</span>
                    <span style={{ color: 'var(--ink)' }}>{formatUsdc(r.cumulativeAmount)}</span>
                  </div>
                  {isFiltered && <div className="mt-1" style={{ color: 'var(--success)' }}>Unsettled — will be submitted</div>}
                </div>
              )
            })}
          </div>
        )}

        <TxButton
          onClick={handleSettle}
          isPending={isPending}
          isConfirming={confirming}
          isSuccess={isSuccess}
          disabled={toSettle.length === 0}
          label={`Settle ${toSettle.length} Receipt(s)`}
          hash={hash}
        />
      </div>
    </div>
  )
}
