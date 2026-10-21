import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { toast } from 'sonner'
import { PPW_ADDRESS, PPW_ABI, USDC_ADDRESS, CHAIN_ID } from '../lib/contract'
import { parseUsdc, formatUsdc, parseContractError, explorerTx, shortAddr } from '../lib/utils'
import { getOrCreateSessionKey, loadSessionKey, clearSessionKey } from '../lib/session'
import TxButton from './TxButton'
import { Key, Trash2 } from 'lucide-react'

const DEPOSIT_PRESETS = [
  { label: '$1', value: '1' },
  { label: '$2', value: '2' },
  { label: '$5', value: '5' },
  { label: '$10', value: '10' },
]

export default function ViewerPanel() {
  const { address, chainId } = useAccount()
  const wrongChain = chainId !== CHAIN_ID

  const [amount, setAmount] = useState('2')
  const [step, setStep] = useState<'idle' | 'approving' | 'depositing'>('idle')

  // Allowance check
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, PPW_ADDRESS] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  })

  // Approve
  const { writeContract: approve, data: appHash, isPending: appPending, reset: appReset } = useWriteContract()
  const { isLoading: appConfirming } = useWaitForTransactionReceipt({ hash: appHash })

  // DepositAndAuthorize
  const { writeContract: deposit, data: depHash, isPending: depPending, reset: depReset } = useWriteContract()
  const { isLoading: depConfirming, isSuccess: depSuccess } = useWaitForTransactionReceipt({ hash: depHash })

  // Revoke session key
  const { writeContract: revoke, data: revokeHash, isPending: revokePending, reset: revokeReset } = useWriteContract()
  useWaitForTransactionReceipt({ hash: revokeHash })

  const amountRaw = parseUsdc(amount)

  function handleStart() {
    if (!address) return
    if (amountRaw === 0n) { toast.error('Enter an amount.'); return }
    if (allowance !== undefined && allowance >= amountRaw) {
      doDeposit()
    } else {
      setStep('approving')
      approve({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [PPW_ADDRESS, amountRaw],
        chainId: CHAIN_ID,
      }, {
        onSuccess: () => {
          void refetchAllowance().then(() => {
            toast.success('Allowance approved. Depositing…')
            setStep('depositing')
            doDeposit()
          })
          appReset()
        },
        onError: (err) => { toast.error(parseContractError(err)); setStep('idle'); appReset() },
      })
    }
  }

  function doDeposit() {
    if (!address) return
    setStep('depositing')
    const sk = getOrCreateSessionKey(address, amountRaw)
    const expiry = BigInt(sk.expiry)
    deposit({
      address: PPW_ADDRESS,
      abi: PPW_ABI,
      functionName: 'depositAndAuthorize',
      args: [amountRaw, sk.address, expiry, amountRaw],
      chainId: CHAIN_ID,
    }, {
      onSuccess: (txHash) => {
        toast.success(
          <span>Deposited {formatUsdc(amountRaw)} & authorized session key! <a href={explorerTx(txHash)} target="_blank" rel="noopener" className="underline">View tx</a></span>
        )
        setStep('idle')
        depReset()
      },
      onError: (err) => { toast.error(parseContractError(err)); setStep('idle'); depReset() },
    })
  }

  function handleRevoke() {
    if (!address) return
    const sk = loadSessionKey(address)
    if (!sk) { toast.error('No session key found.'); return }
    revoke({
      address: PPW_ADDRESS,
      abi: PPW_ABI,
      functionName: 'revokeSessionKey',
      args: [sk.address],
      chainId: CHAIN_ID,
    }, {
      onSuccess: (txHash) => {
        clearSessionKey(address)
        toast.success(<span>Session key revoked. <a href={explorerTx(txHash)} target="_blank" rel="noopener" className="underline">View tx</a></span>)
        revokeReset()
      },
      onError: (err) => { toast.error(parseContractError(err)); revokeReset() },
    })
  }

  if (!address) return <p className="text-sm" style={{ color: 'var(--subtle)' }}>Connect your wallet first.</p>

  const sessionKey = loadSessionKey(address)
  const busy = appPending || appConfirming || depPending || depConfirming

  return (
    <div className="space-y-4">
      {/* Deposit + authorize */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>Deposit & Authorize</h3>

        <div className="flex flex-wrap gap-2">
          {DEPOSIT_PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => setAmount(p.value)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{
                background: amount === p.value ? 'var(--accent)' : 'var(--surface-muted)',
                color: amount === p.value ? '#0d1b2f' : 'var(--muted)',
                border: '1px solid var(--border)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--subtle)', fontSize: 14 }}>$</span>
          <input
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="flex-1 rounded-lg px-3 py-2 text-sm"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)', outline: 'none' }}
          />
          <span style={{ color: 'var(--subtle)', fontSize: 13 }}>USDC</span>
        </div>

        {/* Allowance info */}
        {allowance !== undefined && (
          <div className="text-xs" style={{ color: 'var(--subtle)' }}>
            Current allowance: {formatUsdc(allowance)}
            {allowance >= amountRaw
              ? <span style={{ color: 'var(--success)' }}> (sufficient, approve will be skipped)</span>
              : <span style={{ color: 'var(--muted)' }}> — approve needed</span>}
          </div>
        )}

        <TxButton
          onClick={handleStart}
          isPending={step === 'approving' ? appPending : depPending}
          isConfirming={step === 'approving' ? appConfirming : depConfirming}
          isSuccess={depSuccess}
          disabled={wrongChain || busy || amountRaw === 0n}
          label={step === 'approving' ? 'Approving USDC…' : `Deposit ${formatUsdc(amountRaw)} & Start Watching`}
          hash={step === 'approving' ? appHash : depHash}
        />
      </div>

      {/* Session key status */}
      <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
            <Key size={13} /> Session Key
          </h3>
          {sessionKey && (
            <button
              onClick={handleRevoke}
              disabled={revokePending}
              className="text-xs flex items-center gap-1 px-2 py-1 rounded-lg"
              style={{ background: 'rgba(232,109,122,0.15)', color: 'var(--danger)' }}
            >
              <Trash2 size={11} />
              {revokePending ? 'Revoking…' : 'Revoke'}
            </button>
          )}
        </div>

        {sessionKey ? (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span style={{ color: 'var(--subtle)' }}>Address</span>
              <span className="mono" style={{ color: 'var(--muted)' }}>{shortAddr(sessionKey.address)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: 'var(--subtle)' }}>Expires</span>
              <span style={{ color: 'var(--muted)' }}>{new Date(sessionKey.expiry * 1000).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: 'var(--subtle)' }}>Spend cap</span>
              <span style={{ color: 'var(--muted)' }}>{formatUsdc(sessionKey.spendCap)}</span>
            </div>
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>No session key. Deposit to create one automatically.</p>
        )}
      </div>
    </div>
  )
}
