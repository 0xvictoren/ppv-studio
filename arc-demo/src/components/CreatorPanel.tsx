import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { keccak256, encodePacked, type Address } from 'viem'
import { toast } from 'sonner'
import { PPW_ADDRESS, PPW_ABI, CHAIN_ID } from '../lib/contract'
import { parseUsdc, formatUsdc, parseContractError, explorerTx, shortAddr } from '../lib/utils'
import { Plus, Edit2, Eye, EyeOff } from 'lucide-react'
import TxButton from './TxButton'

const PRICE_PRESETS = [
  { label: '$0.25/hr', value: '0.25' },
  { label: '$0.50/hr', value: '0.50' },
  { label: '$1/hr',   value: '1.00' },
  { label: '$2/hr',   value: '2.00' },
]

interface RegisteredVideo {
  videoId: `0x${string}`
  title: string
  cid: string
  pricePerHour: bigint
  active: boolean
}

const VIDEO_STORE_KEY = (addr: string) => `ppw_videos_${addr.toLowerCase()}`

function loadVideos(addr: string): RegisteredVideo[] {
  try {
    const raw = localStorage.getItem(VIDEO_STORE_KEY(addr))
    if (!raw) return []
    const arr = JSON.parse(raw) as Array<{
      videoId: string
      title: string
      cid: string
      pricePerHour: string
      active: boolean
    }>
    return arr.map(v => ({ ...v, videoId: v.videoId as `0x${string}`, pricePerHour: BigInt(v.pricePerHour) }))
  } catch { return [] }
}

function saveVideos(addr: string, videos: RegisteredVideo[]) {
  localStorage.setItem(VIDEO_STORE_KEY(addr), JSON.stringify(
    videos.map(v => ({ ...v, pricePerHour: v.pricePerHour.toString() }))
  ))
}

export default function CreatorPanel() {
  const { address, chainId } = useAccount()
  const wrongChain = chainId !== CHAIN_ID

  const [title, setTitle] = useState('')
  const [cid, setCid] = useState('')
  const [priceInput, setPriceInput] = useState('0.50')
  const [customPrice, setCustomPrice] = useState(false)
  const [videos, setVideos] = useState<RegisteredVideo[]>(() => address ? loadVideos(address) : [])

  const [editVideoId, setEditVideoId] = useState<`0x${string}` | null>(null)
  const [editPrice, setEditPrice] = useState('')

  const { writeContract, data: hash, isPending, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const computeVideoId = (creator: Address, contentCid: string): `0x${string}` =>
    keccak256(encodePacked(['address', 'string'], [creator, contentCid]))

  function handleRegister() {
    if (!address) return
    const priceRaw = parseUsdc(priceInput)
    if (priceRaw === 0n || priceRaw > parseUsdc('100')) {
      toast.error('Price must be > $0 and ≤ $100/hr.')
      return
    }
    if (!title.trim()) { toast.error('Title required.'); return }
    if (!cid.trim()) { toast.error('Content CID required.'); return }
    const videoId = computeVideoId(address, cid.trim())

    writeContract({
      address: PPW_ADDRESS,
      abi: PPW_ABI,
      functionName: 'registerVideo',
      args: [videoId, priceRaw],
      chainId: CHAIN_ID,
    }, {
      onSuccess: (txHash) => {
        const newVid: RegisteredVideo = {
          videoId,
          title: title.trim(),
          cid: cid.trim(),
          pricePerHour: priceRaw,
          active: true,
        }
        const updated = [...videos, newVid]
        setVideos(updated)
        if (address) saveVideos(address, updated)
        toast.success(
          <span>Video registered! <a href={explorerTx(txHash)} target="_blank" rel="noopener" className="underline">View tx</a></span>
        )
        setTitle(''); setCid('')
        reset()
      },
      onError: (err) => { toast.error(parseContractError(err)); reset() },
    })
  }

  const { writeContract: writeUpdate, data: updateHash, isPending: updPending, reset: updReset } = useWriteContract()
  const { isLoading: updConfirming } = useWaitForTransactionReceipt({ hash: updateHash })

  function handleUpdatePrice(videoId: `0x${string}`) {
    const priceRaw = parseUsdc(editPrice)
    if (priceRaw === 0n || priceRaw > parseUsdc('100')) {
      toast.error('Price must be > $0 and ≤ $100/hr.')
      return
    }
    writeUpdate({
      address: PPW_ADDRESS,
      abi: PPW_ABI,
      functionName: 'updatePrice',
      args: [videoId, priceRaw],
      chainId: CHAIN_ID,
    }, {
      onSuccess: (txHash) => {
        const updated = videos.map(v => v.videoId === videoId ? { ...v, pricePerHour: priceRaw } : v)
        setVideos(updated)
        if (address) saveVideos(address, updated)
        toast.success(<span>Price updated! <a href={explorerTx(txHash)} target="_blank" rel="noopener" className="underline">View tx</a></span>)
        setEditVideoId(null)
        updReset()
      },
      onError: (err) => { toast.error(parseContractError(err)); updReset() },
    })
  }

  const { writeContract: writeActive, data: activeHash, isPending: actPending, reset: actReset } = useWriteContract()
  useWaitForTransactionReceipt({ hash: activeHash })

  function handleSetActive(videoId: `0x${string}`, active: boolean) {
    writeActive({
      address: PPW_ADDRESS,
      abi: PPW_ABI,
      functionName: 'setVideoActive',
      args: [videoId, active],
      chainId: CHAIN_ID,
    }, {
      onSuccess: (txHash) => {
        const updated = videos.map(v => v.videoId === videoId ? { ...v, active } : v)
        setVideos(updated)
        if (address) saveVideos(address, updated)
        toast.success(<span>{active ? 'Video activated' : 'Video paused'}! <a href={explorerTx(txHash)} target="_blank" rel="noopener" className="underline">View tx</a></span>)
        actReset()
      },
      onError: (err) => { toast.error(parseContractError(err)); actReset() },
    })
  }

  if (!address) return <p className="text-sm" style={{ color: 'var(--subtle)' }}>Connect your wallet to register videos.</p>

  return (
    <div className="space-y-5">
      {/* Register form */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>Register Video</h3>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)', outline: 'none' }}
        />
        <input
          value={cid}
          onChange={e => setCid(e.target.value)}
          placeholder="Content CID (e.g. bafybeig…)"
          className="w-full rounded-lg px-3 py-2 text-sm mono"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)', outline: 'none' }}
        />

        {/* Price presets */}
        <div>
          <div className="text-xs mb-2" style={{ color: 'var(--subtle)' }}>Price per hour</div>
          <div className="flex flex-wrap gap-2">
            {PRICE_PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => { setPriceInput(p.value); setCustomPrice(false) }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: !customPrice && priceInput === p.value ? 'var(--accent)' : 'var(--surface-muted)',
                  color: !customPrice && priceInput === p.value ? '#0d1b2f' : 'var(--muted)',
                  border: '1px solid var(--border)',
                }}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => setCustomPrice(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{
                background: customPrice ? 'var(--accent)' : 'var(--surface-muted)',
                color: customPrice ? '#0d1b2f' : 'var(--muted)',
                border: '1px solid var(--border)',
              }}
            >Custom</button>
          </div>
          {customPrice && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm" style={{ color: 'var(--subtle)' }}>$</span>
              <input
                value={priceInput}
                onChange={e => setPriceInput(e.target.value)}
                placeholder="0.50"
                className="w-28 rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)', outline: 'none' }}
              />
              <span className="text-sm" style={{ color: 'var(--subtle)' }}>/hr</span>
            </div>
          )}
          {/* Live preview */}
          {priceInput && (
            <div className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>
              ≈ {formatUsdc(parseUsdc(priceInput) / 60n)}/min · {formatUsdc(parseUsdc(priceInput) / 3600n)}/sec (raw: {parseUsdc(priceInput).toString()} base units)
            </div>
          )}
        </div>

        {title && cid && address && (
          <div className="text-xs mono p-2 rounded-lg" style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}>
            videoId = {computeVideoId(address, cid.trim())}
          </div>
        )}

        <TxButton
          onClick={handleRegister}
          isPending={isPending}
          isConfirming={confirming}
          isSuccess={isSuccess}
          disabled={wrongChain || !title || !cid}
          label="Register Video"
          hash={hash}
        />
      </div>

      {/* My videos */}
      {videos.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>My Videos</h3>
          {videos.map(v => (
            <div key={v.videoId} className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{v.title}</div>
                  <div className="text-xs mono truncate mt-0.5" style={{ color: 'var(--subtle)' }}>{shortAddr(v.videoId)}</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    {formatUsdc(v.pricePerHour)}/hr · {v.active ? <span style={{ color: 'var(--success)' }}>Active</span> : <span style={{ color: 'var(--danger)' }}>Inactive</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setEditVideoId(v.videoId); setEditPrice(formatUsdc(v.pricePerHour, '').replace('$', '').trim()) }}
                    className="p-1.5 rounded-lg"
                    style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={() => handleSetActive(v.videoId, !v.active)}
                    disabled={actPending}
                    className="p-1.5 rounded-lg"
                    style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}
                  >
                    {v.active ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
              </div>

              {/* Inline price edit */}
              {editVideoId === v.videoId && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--subtle)' }}>New price $</span>
                  <input
                    value={editPrice}
                    onChange={e => setEditPrice(e.target.value)}
                    className="w-20 rounded-lg px-2 py-1 text-xs"
                    style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)', outline: 'none' }}
                  />
                  <span className="text-xs" style={{ color: 'var(--subtle)' }}>/hr</span>
                  <button
                    onClick={() => handleUpdatePrice(v.videoId)}
                    disabled={updPending || updConfirming}
                    className="text-xs px-3 py-1 rounded-lg font-medium"
                    style={{ background: 'var(--accent)', color: '#0d1b2f' }}
                  >
                    {updPending ? '…' : 'Update'}
                  </button>
                  <button
                    onClick={() => setEditVideoId(null)}
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {videos.length === 0 && (
        <div className="text-center py-6 text-sm" style={{ color: 'var(--subtle)' }}>
          <Plus size={20} className="mx-auto mb-2 opacity-40" />
          No videos registered yet
        </div>
      )}
    </div>
  )
}
