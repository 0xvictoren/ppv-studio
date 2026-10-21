import { useState, useEffect } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { toast } from 'sonner'
import { PPW_ADDRESS, PPW_ABI, CHAIN_ID } from '../lib/contract'
import { formatUsdc, parseUsdc, parseContractError, explorerTx, fmtCountdown } from '../lib/utils'
import TxButton from './TxButton'
import { ArrowDownToLine } from 'lucide-react'

export default function WithdrawPanel() {
  const { address, chainId } = useAccount()
  const wrongChain = chainId !== CHAIN_ID

  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [countdown, setCountdown] = useState(0)

  const { data: escrowBal, refetch: refetchBal } = useReadContract({
    address: PPW_ADDRESS,
    abi: PPW_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 5000 },
  })

  const { data: pending, refetch: refetchPending } = useReadContract({
    address: PPW_ADDRESS,
    abi: PPW_ABI,
    functionName: 'pendingWithdrawal',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 5000 },
  })

  // Countdown timer
  useEffect(() => {
    if (!pending || pending[1] === 0n) return
    const tick = () => {
      const secs = Number(pending[1]) - Math.floor(Date.now() / 1000)
      setCountdown(Math.max(0, secs))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [pending])

  const { writeContract: writeRequest, data: reqHash, isPending: reqPending, reset: reqReset } = useWriteContract()
  const { isLoading: reqConfirming, isSuccess: reqSuccess } = useWaitForTransactionReceipt({ hash: reqHash })

  const { writeContract: writeWithdraw, data: wHash, isPending: wPending, reset: wReset } = useWriteContract()
  const { isLoading: wConfirming, isSuccess: wSuccess } = useWaitForTransactionReceipt({ hash: wHash })

  const { writeContract: writeCancel, data: cHash, isPending: cPending, reset: cReset } = useWriteContract()
  const { isLoading: cConfirming } = useWaitForTransactionReceipt({ hash: cHash })

  function handleRequest() {
    const raw = parseUsdc(withdrawAmount)
    if (raw === 0n) { toast.error('Enter an amount.'); return }
    if (escrowBal !== undefined && raw > escrowBal) {
      toast.error('Amount exceeds escrow balance.')
      return
    }
    writeRequest({
      address: PPW_ADDRESS,
      abi: PPW_ABI,
      functionName: 'requestWithdraw',
      args: [raw],
      chainId: CHAIN_ID,
    }, {
      onSuccess: (txHash) => {
        toast.success(<span>Withdrawal requested! <a href={explorerTx(txHash)} target="_blank" rel="noopener" className="underline">View tx</a></span>)
        void refetchPending()
        reqReset()
      },
      onError: (err) => { toast.error(parseContractError(err)); reqReset() },
    })
  }

  function handleWithdraw() {
    writeWithdraw({
      address: PPW_ADDRESS,
      abi: PPW_ABI,
      functionName: 'withdraw',
      chainId: CHAIN_ID,
    }, {
      onSuccess: (txHash) => {
        toast.success(<span>Withdrawn! <a href={explorerTx(txHash)} target="_blank" rel="noopener" className="underline">View tx</a></span>)
        void refetchBal()
        void refetchPending()
        wReset()
      },
      onError: (err) => { toast.error(parseContractError(err)); wReset() },
    })
  }

  function handleCancel() {
    writeCancel({
      address: PPW_ADDRESS,
      abi: PPW_ABI,
      functionName: 'cancelWithdraw',
      chainId: CHAIN_ID,
    }, {
      onSuccess: (txHash) => {
        toast.success(<span>Withdrawal cancelled. <a href={explorerTx(txHash)} target="_blank" rel="noopener" className="underline">View tx</a></span>)
        void refetchPending()
        cReset()
      },
      onError: (err) => { toast.error(parseContractError(err)); cReset() },
    })
  }

  if (!address) return <p className="text-sm" style={{ color: 'var(--subtle)' }}>Connect your wallet first.</p>

  const hasPending = pending && pending[0] > 0n
  const canWithdraw = hasPending && countdown === 0

  return (
    <div className="space-y-4">
      {/* Escrow balance */}
      <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>Escrow Balance</div>
        <div className="display text-2xl font-bold tabular-nums" style={{ color: 'var(--accent)' }}>
          {escrowBal !== undefined ? formatUsdc(escrowBal) : '—'}
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>1-hour delay after requesting — protects outstanding receipts</div>
      </div>

      {/* Pending withdrawal */}
      {hasPending && (
        <div className="rounded-xl p-4 space-y-3" style={{
          background: 'var(--surface)',
          border: `1px solid ${canWithdraw ? 'rgba(141,216,159,0.4)' : 'var(--border)'}`,
        }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold" style={{ color: canWithdraw ? 'var(--success)' : 'var(--ink-2)' }}>
                {canWithdraw ? 'Ready to Withdraw' : `Withdraw available in ${fmtCountdown(countdown)}`}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
                Amount: {formatUsdc(pending[0])}
              </div>
            </div>
          </div>

          {canWithdraw ? (
            <TxButton
              onClick={handleWithdraw}
              isPending={wPending}
              isConfirming={wConfirming}
              isSuccess={wSuccess}
              disabled={wrongChain}
              label={`Withdraw ${formatUsdc(pending[0])}`}
              hash={wHash}
            />
          ) : (
            <div className="rounded-xl py-2.5 text-center text-sm font-semibold" style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}>
              {fmtCountdown(countdown)} remaining
            </div>
          )}

          <button
            onClick={handleCancel}
            disabled={cPending || cConfirming}
            className="w-full py-2 rounded-xl text-xs font-medium"
            style={{ background: 'rgba(232,109,122,0.1)', color: 'var(--danger)', border: '1px solid rgba(232,109,122,0.2)' }}
          >
            {cPending ? 'Cancelling…' : 'Cancel Request'}
          </button>
        </div>
      )}

      {/* Request withdrawal */}
      {!hasPending && (
        <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
            <ArrowDownToLine size={13} /> Request Withdrawal
          </h3>

          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--subtle)', fontSize: 14 }}>$</span>
            <input
              value={withdrawAmount}
              onChange={e => setWithdrawAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)', outline: 'none' }}
            />
            <button
              onClick={() => escrowBal !== undefined && setWithdrawAmount(
                `${(escrowBal / 1_000_000n).toString()}.${(escrowBal % 1_000_000n).toString().padStart(6, '0').slice(0, 2)}`
              )}
              className="text-xs px-2 py-1 rounded-lg"
              style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}
            >
              Max
            </button>
          </div>

          <TxButton
            onClick={handleRequest}
            isPending={reqPending}
            isConfirming={reqConfirming}
            isSuccess={reqSuccess}
            disabled={wrongChain || !withdrawAmount || parseUsdc(withdrawAmount) === 0n}
            label="Request Withdrawal"
            hash={reqHash}
          />
        </div>
      )}
    </div>
  )
}
