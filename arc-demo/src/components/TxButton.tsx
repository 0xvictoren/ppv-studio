import { ExternalLink, CheckCircle2, Loader2 } from 'lucide-react'
import { explorerTx } from '../lib/contract'

interface TxButtonProps {
  onClick: () => void
  isPending: boolean
  isConfirming: boolean
  isSuccess: boolean
  disabled?: boolean
  label: string
  hash?: string
  danger?: boolean
}

export default function TxButton({
  onClick, isPending, isConfirming, isSuccess, disabled, label, hash, danger
}: TxButtonProps) {
  const busy = isPending || isConfirming

  return (
    <div className="space-y-2">
      <button
        onClick={onClick}
        disabled={busy || disabled}
        className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity"
        style={{
          background: busy || disabled
            ? 'var(--surface-muted)'
            : danger ? 'rgba(232,109,122,0.2)' : 'var(--accent)',
          color: busy || disabled
            ? 'var(--subtle)'
            : danger ? 'var(--danger)' : '#0d1b2f',
          border: danger && !busy && !disabled ? '1px solid rgba(232,109,122,0.4)' : 'none',
          cursor: busy || disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {isPending
          ? <span className="flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" />Confirm in wallet…</span>
          : isConfirming
            ? <span className="flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" />Pending…</span>
            : label}
      </button>

      {isConfirming && hash && (
        <a
          href={explorerTx(hash)}
          target="_blank"
          rel="noopener"
          className="flex items-center justify-center gap-1.5 text-xs"
          style={{ color: 'var(--accent)' }}
        >
          <ExternalLink size={11} />
          View pending tx
        </a>
      )}

      {isSuccess && hash && (
        <a
          href={explorerTx(hash)}
          target="_blank"
          rel="noopener"
          className="flex items-center justify-center gap-1.5 text-xs"
          style={{ color: 'var(--success)' }}
        >
          <CheckCircle2 size={11} />
          Confirmed — view tx
        </a>
      )}
    </div>
  )
}
