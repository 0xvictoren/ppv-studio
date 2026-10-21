import { useState } from 'react'
import WalletPanel from './components/WalletPanel'
import CreatorPanel from './components/CreatorPanel'
import ViewerPanel from './components/ViewerPanel'
import WatchSimulator from './components/WatchSimulator'
import SettlePanel from './components/SettlePanel'
import WithdrawPanel from './components/WithdrawPanel'
import ActivityPanel from './components/ActivityPanel'

const TABS = [
  { id: 'wallet',   label: 'Wallet' },
  { id: 'creator',  label: 'Creator' },
  { id: 'viewer',   label: 'Viewer' },
  { id: 'watch',    label: 'Watch' },
  { id: 'settle',   label: 'Settle' },
  { id: 'withdraw', label: 'Withdraw' },
  { id: 'activity', label: 'Activity' },
] as const

type TabId = typeof TABS[number]['id']

export default function App() {
  const [active, setActive] = useState<TabId>('wallet')

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg)', backgroundImage: 'var(--bg-gradient)' }}>
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur-md" style={{ borderBottom: '1px solid var(--border)', background: 'rgba(13,27,47,0.8)' }}>
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
              <span className="display font-bold text-xs" style={{ color: '#0d1b2f' }}>P</span>
            </div>
            <div>
              <div className="display font-semibold text-sm leading-none" style={{ color: 'var(--ink)' }}>
                PayPerWatch
              </div>
              <div className="text-xs leading-none mt-0.5" style={{ color: 'var(--subtle)' }}>
                Arc Testnet Demo Console
              </div>
            </div>
          </div>
          <div className="text-xs mono px-2 py-1 rounded-lg" style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}>
            Chain 5042002
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-3xl mx-auto px-4 flex gap-0.5 overflow-x-auto pb-0" style={{ borderTop: '1px solid var(--border)' }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className="px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors relative"
              style={{
                color: active === tab.id ? 'var(--accent)' : 'var(--subtle)',
                background: 'transparent',
                borderBottom: active === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Panel */}
      <main className="max-w-3xl mx-auto px-4 py-5">
        {active === 'wallet'   && <WalletPanel />}
        {active === 'creator'  && <CreatorPanel />}
        {active === 'viewer'   && <ViewerPanel />}
        {active === 'watch'    && <WatchSimulator />}
        {active === 'settle'   && <SettlePanel />}
        {active === 'withdraw' && <WithdrawPanel />}
        {active === 'activity' && <ActivityPanel />}
      </main>
    </div>
  )
}
