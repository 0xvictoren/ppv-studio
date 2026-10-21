import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { privateKeyToAccount } from 'viem/accounts'
import { type Address } from 'viem'
import { toast } from 'sonner'
import { PPW_ADDRESS, PPW_ABI, CHAIN_ID, EIP712_DOMAIN, RECEIPT_TYPES } from '../lib/contract'
import { formatUsdc, shortAddr, nowSecs } from '../lib/utils'
import { loadSessionKey, loadReceipt, saveReceipt, type StoredReceipt } from '../lib/session'
import { Play, Pause, Radio } from 'lucide-react'

interface VideoItem {
  videoId: `0x${string}`
  title: string
  creator: Address
  pricePerHour: bigint
}

export default function WatchSimulator() {
  const { address } = useAccount()
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null)
  const [videoIdInput, setVideoIdInput] = useState('')
  const [playing, setPlaying] = useState(false)
  const [sessionSeconds, setSessionSeconds] = useState(0)  // ticks only while playing+visible
  const [latestReceipt, setLatestReceipt] = useState<StoredReceipt | null>(null)
  const [verifyResult, setVerifyResult] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tabVisibleRef = useRef(true)

  // Cumulative amount per (viewer, creator) kept in localStorage
  const cumulativeRef = useRef<bigint>(0n)

  // Load cumulative from localStorage when video selected
  useEffect(() => {
    if (!address || !selectedVideo) return
    const stored = loadReceipt(address, selectedVideo.creator)
    cumulativeRef.current = stored?.cumulativeAmount ?? 0n
  }, [address, selectedVideo])

  // Tab visibility
  useEffect(() => {
    const handler = () => { tabVisibleRef.current = !document.hidden }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  // Cost per second for selected video (bigint, USDC base units)
  const costPerSecond = selectedVideo ? selectedVideo.pricePerHour / 3600n : 0n

  // Session cost so far
  const sessionCost = costPerSecond * BigInt(sessionSeconds)

  // Sign a receipt with the session key
  const signReceipt = useCallback(async () => {
    if (!address || !selectedVideo) return
    const sk = loadSessionKey(address)
    if (!sk) { toast.error('No session key. Deposit first.'); return }

    const sessionAccount = privateKeyToAccount(sk.privateKey)
    const deadline = nowSecs() + 3600n  // 1 hour from now

    // cumulativeAmount only ever increases
    const newCumulative = cumulativeRef.current + sessionCost
    if (newCumulative === cumulativeRef.current) return  // nothing to sign

    const receipt = {
      viewer: address,
      creator: selectedVideo.creator,
      cumulativeAmount: newCumulative,
      deadline,
    }

    try {
      const sig = await sessionAccount.signTypedData({
        domain: {
          ...EIP712_DOMAIN,
          chainId: Number(EIP712_DOMAIN.chainId),
        },
        types: RECEIPT_TYPES,
        primaryType: 'Receipt',
        message: receipt,
      })

      const stored: StoredReceipt = {
        viewer: address,
        creator: selectedVideo.creator,
        cumulativeAmount: newCumulative,
        deadline,
        signature: sig,
      }
      saveReceipt(stored)
      setLatestReceipt(stored)
      cumulativeRef.current = newCumulative
      toast.success(`Receipt signed. Cumulative: ${formatUsdc(newCumulative)}`)
    } catch (err) {
      toast.error('Signing failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [address, selectedVideo, sessionCost])

  // Auto-sign every 60 seconds of play
  const secondsSinceSign = useRef(0)
  useEffect(() => {
    if (playing) {
      secondsSinceSign.current += 1
      if (secondsSinceSign.current >= 60) {
        secondsSinceSign.current = 0
        void signReceipt()
      }
    }
  }, [sessionSeconds, playing, signReceipt])

  // Tick every second while playing + tab visible
  useEffect(() => {
    if (playing) {
      timerRef.current = setInterval(() => {
        if (tabVisibleRef.current) {
          setSessionSeconds(s => s + 1)
        }
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [playing])

  // Sign on pause
  const handlePause = useCallback(() => {
    setPlaying(false)
    if (sessionSeconds > 0) void signReceipt()
  }, [sessionSeconds, signReceipt])

  // Read video from chain
  const { data: videoData, isLoading: loadingVideo } = useReadContract({
    address: PPW_ADDRESS,
    abi: PPW_ABI,
    functionName: 'getVideo',
    args: videoIdInput.length === 66 ? [videoIdInput as `0x${string}`] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: videoIdInput.length === 66 },
  })

  function selectVideo() {
    if (!videoData || videoData.creator === '0x0000000000000000000000000000000000000000') {
      toast.error('Video not found on chain.')
      return
    }
    setSelectedVideo({
      videoId: videoIdInput as `0x${string}`,
      title: `Video ${shortAddr(videoIdInput)}`,
      creator: videoData.creator,
      pricePerHour: videoData.pricePerHour,
    })
    setSessionSeconds(0)
    setPlaying(false)
    secondsSinceSign.current = 0
    setLatestReceipt(null)
    setVerifyResult(null)
  }

  // Verify receipt hash against contract
  const { data: contractHash, refetch: refetchHash } = useReadContract({
    address: PPW_ADDRESS,
    abi: PPW_ABI,
    functionName: 'hashReceipt',
    args: latestReceipt ? [{
      viewer: latestReceipt.viewer,
      creator: latestReceipt.creator,
      cumulativeAmount: latestReceipt.cumulativeAmount,
      deadline: latestReceipt.deadline,
    }] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!latestReceipt },
  })

  async function handleVerify() {
    const result = await refetchHash()
    if (result.data) {
      setVerifyResult(`Contract digest: ${result.data}`)
    }
  }

  const fmtTime = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return h > 0
      ? `${h}:${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`
      : `${m}:${sec.toString().padStart(2,'0')}`
  }

  return (
    <div className="space-y-4">
      {/* Video picker */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h3 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
          <Radio size={13} /> Select Video
        </h3>
        <div className="flex gap-2">
          <input
            value={videoIdInput}
            onChange={e => setVideoIdInput(e.target.value)}
            placeholder="0x… videoId (bytes32)"
            className="flex-1 rounded-lg px-3 py-2 text-xs mono"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)', outline: 'none' }}
          />
          <button
            onClick={selectVideo}
            disabled={videoIdInput.length !== 66 || loadingVideo}
            className="px-3 py-2 rounded-lg text-xs font-medium"
            style={{ background: 'var(--accent)', color: '#0d1b2f', opacity: videoIdInput.length !== 66 ? 0.4 : 1 }}
          >
            {loadingVideo ? '…' : 'Load'}
          </button>
        </div>
      </div>

      {/* Player */}
      {selectedVideo && (
        <>
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div>
              <div className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{selectedVideo.title}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
                Creator: <span className="mono">{shortAddr(selectedVideo.creator)}</span>
                {' · '}{formatUsdc(selectedVideo.pricePerHour)}/hr
              </div>
            </div>

            {/* Meter */}
            <div className="rounded-xl p-4 text-center" style={{ background: 'var(--surface-muted)' }}>
              <div className="display text-3xl font-bold tabular-nums" style={{ color: playing ? 'var(--accent)' : 'var(--ink)' }}>
                {fmtTime(sessionSeconds)}
              </div>
              <div className="text-sm mt-1 tabular-nums font-medium" style={{ color: 'var(--muted)' }}>
                {formatUsdc(sessionCost)} this session
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
                {formatUsdc(costPerSecond)}/sec
              </div>
            </div>

            {/* Play / Pause */}
            <button
              onClick={() => playing ? handlePause() : setPlaying(true)}
              disabled={!address}
              className="w-full py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
              style={{
                background: playing ? 'rgba(141,216,159,0.2)' : 'var(--accent)',
                color: playing ? 'var(--success)' : '#0d1b2f',
                border: playing ? '1px solid rgba(141,216,159,0.4)' : 'none',
              }}
            >
              {playing ? <><Pause size={14} /> Pause & Sign Receipt</> : <><Play size={14} /> Play</>}
            </button>

            <button
              onClick={() => void signReceipt()}
              disabled={sessionSeconds === 0}
              className="w-full py-2 rounded-xl text-xs font-medium"
              style={{ background: 'var(--surface-muted)', color: 'var(--subtle)', border: '1px solid var(--border)' }}
            >
              Sign Receipt Now
            </button>
          </div>

          {/* Latest receipt */}
          {latestReceipt && (
            <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>Latest Receipt</h4>
                <button
                  onClick={() => void handleVerify()}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: 'var(--surface-muted)', color: 'var(--accent)' }}
                >
                  Verify on-chain
                </button>
              </div>
              <pre className="text-xs mono overflow-auto p-2 rounded-lg" style={{ background: 'var(--surface-muted)', color: 'var(--muted)', maxHeight: 160 }}>
{JSON.stringify({
  viewer: latestReceipt.viewer,
  creator: latestReceipt.creator,
  cumulativeAmount: latestReceipt.cumulativeAmount.toString(),
  deadline: latestReceipt.deadline.toString(),
  signature: latestReceipt.signature,
}, null, 2)}
              </pre>
              {contractHash && (
                <div className="text-xs" style={{ color: 'var(--subtle)' }}>
                  Contract EIP-712 digest: <span className="mono" style={{ color: 'var(--muted)' }}>{contractHash}</span>
                </div>
              )}
              {verifyResult && !contractHash && (
                <div className="text-xs mono" style={{ color: 'var(--muted)' }}>{verifyResult}</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
