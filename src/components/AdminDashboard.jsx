import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, isSupabaseConfigured } from '../supabaseClient.js'
import ThemeToggle from './ThemeToggle.jsx'

const LEDGER_LIMIT = 50
const DEMO_ROUNDS = 12

function formatKes(cents) {
  return ((cents ?? 0) / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' KES'
}

function formatDate(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' })
}

export default function AdminDashboard({ user, setMessage, onNotAdmin }) {


//test lines, to be deleted. 

  const isLocalDemo = !isSupabaseConfigured
  if (isLocalDemo) {
  }

//test lines, to be deleted. 
  
  const [profileRole, setProfileRole] = useState(null)
  const [guardLoading, setGuardLoading] = useState(true)
  const [withdrawals, setWithdrawals] = useState([])
  const [withdrawalsError, setWithdrawalsError] = useState(null)
  const [deposits, setDeposits] = useState([])
  const [depositsError, setDepositsError] = useState(null)
  const [ledger, setLedger] = useState([])
  const [ledgerError, setLedgerError] = useState(null)
  const [ledgerUserId, setLedgerUserId] = useState('')
  const [processingId, setProcessingId] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmConfig, setConfirmConfig] = useState(null)
  const [stats, setStats] = useState({ totalUsers: null, totalBalanceCents: null })
  const [roundsQueueAdmin, setRoundsQueueAdmin] = useState([])
  const [roundsQueueError, setRoundsQueueError] = useState(null)
  const [roundsQueueLoading, setRoundsQueueLoading] = useState(false)
  const [liveRoundNumber, setLiveRoundNumber] = useState(null)
  const [recentBursted, setRecentBursted] = useState([])
  const roundChannelRef = useRef(null)
  const roundChannelReadyRef = useRef(null)
  const localBusRef = useRef(null)
  const [generatedCount, setGeneratedCount] = useState(0)
// ...


const generateDemoRounds = useCallback(() => {
  // ... rest of the file continues normally
    const base = Math.floor(Date.now() / 1000) % 100000
    return Array.from({ length: DEMO_ROUNDS }).map((_, i) => {
      const round_number = base + i + 1
      const burst_point = Number((1.3 + Math.random() * 8.7).toFixed(2)) // 1.30x - 10.00x
      return { id: `demo-${round_number}`, round_id: `demo-${round_number}`, round_number, burst_point }
    })
  }, [])

  const ensureRoundChannel = useCallback(async () => {
    if (!isSupabaseConfigured) return null
    if (roundChannelRef.current) return roundChannelRef.current

    const ch = supabase.channel('round-sync')
    roundChannelRef.current = ch

    // Subscribe once and share the promise so callers can await readiness.
    roundChannelReadyRef.current =
      roundChannelReadyRef.current ||
      new Promise((resolve) => {
        try {
          ch.subscribe((status) => {
            if (status === 'SUBSCRIBED' || status === 'TIMED_OUT' || status === 'CLOSED') {
              resolve(status)
            }
          })
        } catch {
          resolve('ERROR')
        }
      })

    await roundChannelReadyRef.current
    return ch
  }, [])

const generateAndBroadcastRounds = useCallback(async (count = 12) => {
  const newRounds = []
  const baseNumber = Math.floor(Date.now() / 1000) + 1000

  for (let i = 0; i < count; i++) {
    const roundNum = baseNumber + i
    const burst = Number((1.8 + Math.random() * 13.2).toFixed(2))

    const round = {
      round_id: `R${roundNum}`,
      round_number: roundNum,
      burst_point: burst,
      status: i === 0 ? 'live' : 'pending',
      starts_at: new Date(Date.now() + i * 60000).toISOString(),
      created_at: new Date().toISOString(),
    }

    newRounds.push(round)
  }

  try {
    const { error: insertError } = await supabase
      .from('game_rounds')
      .insert(newRounds)

    if (insertError) {
      console.error('Insert failed:', insertError)
      setMessage?.({ type: 'error', text: 'Failed to generate rounds: ' + insertError.message })
      return
    }

    const ch = await ensureRoundChannel()
    if (ch) {
      ch.send({
        type: 'broadcast',
        event: 'rounds_update',
        payload: { rounds: newRounds },
      })
    }

    setGeneratedCount((prev) => {
      const next = prev + count
      console.log(`Admin generated & broadcasted ${count} rounds (total generated: ${next})`)
      return next
    })

    setRoundsQueueAdmin((prev) => {
      const updated = [...prev, ...newRounds]
      return updated.slice(-36)
    })

    setLiveRoundNumber(newRounds[0]?.round_number ?? null)
  } catch (err) {
    console.error('Generator crashed:', err)
    setMessage?.({ type: 'error', text: 'Round generation error' })
  }
}, [ensureRoundChannel, setMessage])

    // Auto-generate on mount + refill when low
    useEffect(() => {
      if (profileRole !== 'admin') return
  
      generateAndBroadcastRounds(12)
  
      const interval = setInterval(async () => {
        const { data, error } = await supabase
          .from('game_rounds')
          .select('round_number, status')
          .in('status', ['live', 'pending'])
          .order('round_number', { ascending: true })
          .limit(8)
  
        if (error) return
  
        const remaining = data?.length ?? 0
        if (remaining <= 3) {
          console.log(`Low rounds (${remaining}) → generating 12 more`)
          generateAndBroadcastRounds(12)
        }
      }, 10000)
  
      return () => clearInterval(interval)
    }, [profileRole, generateAndBroadcastRounds])

  
  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut()
    window.location.replace('/')
  }, [])

  // Admin guard: only profile.role === 'admin'
  useEffect(() => {
    if (isLocalDemo) {
      setProfileRole('admin')
      setGuardLoading(false)
      return
    }
    if (!user?.id) {
      setGuardLoading(false)
      setProfileRole(null)
      return
    }
    let cancelled = false
    if (!isSupabaseConfigured) {
      setGuardLoading(false)
      setProfileRole(null)
      return () => { cancelled = true }
    }
    try {
      supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (cancelled) return
          if (error) {
            console.error('AdminDashboard: profile role fetch failed', error)
            setMessage?.({ type: 'error', text: 'Could not verify access.' })
            setProfileRole(null)
            return
          }
          setProfileRole(data?.role ?? null)
        })
        .catch((err) => {
          if (cancelled) return
          console.error('AdminDashboard: profile role fetch threw', err)
          setMessage?.({ type: 'error', text: 'Could not verify access.' })
          setProfileRole(null)
        })
        .finally(() => {
          if (!cancelled) setGuardLoading(false)
        })
    } catch (err) {
      console.error('AdminDashboard: profile role fetch threw synchronously', err)
      if (!cancelled) {
        setMessage?.({ type: 'error', text: 'Could not verify access.' })
        setProfileRole(null)
        setGuardLoading(false)
      }
    }
    return () => { cancelled = true }
  }, [user?.id])

  // Redirect non-admin
  useEffect(() => {
    if (isLocalDemo) return
    if (!isSupabaseConfigured) return
    if (guardLoading) return
    if (!user) {
      if (onNotAdmin) onNotAdmin()
      else window.location.replace('/')
      return
    }
    if (profileRole !== 'admin') {
      if (onNotAdmin) onNotAdmin()
      else window.location.replace('/')
    }
  }, [guardLoading, user, profileRole, onNotAdmin])

  const fetchWithdrawals = useCallback(async () => {
    setWithdrawalsError(null)
    const { data, error } = await supabase
      .from('withdrawal_requests')
      .select('id, amount_cents, phone, created_at')
      .eq('status', 'requested')
      .order('created_at', { ascending: true })
    if (error) {
      setWithdrawalsError(error.message)
      setWithdrawals([])
      return
    }
    setWithdrawals(data ?? [])
  }, [])

  const fetchDeposits = useCallback(async () => {
    setDepositsError(null)
    const { data, error } = await supabase
      .from('deposits')
      .select('id, user_id, amount_cents, external_ref, phone, created_at, status')
      .in('status', ['submitted', 'pending_submit'])
      .order('created_at', { ascending: true })
    if (error) {
      setDepositsError(error.message)
      setDeposits([])
      return
    }
    setDeposits(data ?? [])
  }, [])

const fetchLedger = useCallback(async () => {
  setLedgerError(null)

  let q = supabase
    .from('ledger')
    .select('id, user_id, type, amount_cents, before_available_cents, after_available_cents, before_locked_cents, after_locked_cents, created_at, reference_table, reference_id')
    .order('created_at', { ascending: false })
    .limit(LEDGER_LIMIT)

  if (ledgerUserId?.trim()) {
    q = q.eq('user_id', ledgerUserId.trim())
  }

  const { data, error } = await q

  if (error) {
    setLedgerError(error.message)
    setLedger([])
    return
  }

  setLedger(data ?? [])
}, [ledgerUserId])
  
  const fetchStats = useCallback(async () => {
  try {
    const [profilesRes, walletsRes] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('wallets').select('available_cents, locked_cents'),
    ])

    if (profilesRes?.error || walletsRes?.error) {
      setStats({ totalUsers: null, totalBalanceCents: null })
      return
    }

    const totalUsers = profilesRes?.count ?? 0
    let totalBalanceCents = 0

    if (walletsRes?.data && Array.isArray(walletsRes.data)) {
      totalBalanceCents = walletsRes.data.reduce(
        (sum, wallet) => sum + (wallet.available_cents ?? 0) + (wallet.locked_cents ?? 0),
        0
      )
    }

    setStats({ totalUsers, totalBalanceCents })
  } catch {
    setStats({ totalUsers: null, totalBalanceCents: null })
  }
}, [])

  const fetchAdminRoundsQueue = useCallback(async () => {
    setRoundsQueueError(null)
    setRoundsQueueLoading(true)
    try {
      if (isLocalDemo) {
        const queue = generateDemoRounds()
        setRoundsQueueAdmin(queue)
        if (typeof BroadcastChannel !== 'undefined') {
          localBusRef.current = localBusRef.current || new BroadcastChannel('round-sync')
          localBusRef.current.postMessage({ event: 'rounds_update', payload: { rounds: queue } })
        }
        return
      }
      const { data, error } = await supabase
        .from('next_rounds_admin')
        .select('id, round_id, round_number, burst_point')
        .order('round_number', { ascending: true })
        .limit(12)
      console.log('AdminDashboard: next_rounds_admin response', { data, error })
      if (error) throw error

      const queue = data ?? []
      console.log('AdminDashboard: rounds queue parsed', queue)
      setRoundsQueueAdmin(queue)
      try {
        const ch = await ensureRoundChannel()
        if (ch) {
          ch.send({
            type: 'broadcast',
            event: 'rounds_update',
            payload: {
              rounds: queue,
            },
          })
        }
      } catch {
        // best-effort only
      }
    } catch (e) {
      setRoundsQueueError(e?.message || 'Failed to load rounds queue')
      setRoundsQueueAdmin([])
    } finally {
      setRoundsQueueLoading(false)
    }
  }, [ensureRoundChannel])

  const applyRoundState = useCallback((state, rn) => {
    if (state === 'live') {
      setLiveRoundNumber(rn)
      return
    }
    if (state === 'bursted' && rn != null) {
      setRecentBursted((prev) => {
        const next = [...prev, rn]
        return next.slice(-12)
      })
      setRoundsQueueAdmin((prev) => prev.filter((r) => (r?.round_number ?? null) !== rn))
    }
  }, [])

  // Auto-refill scheduled queue when it drops below 3

  const handleRefreshAll = useCallback(() => {
    fetchWithdrawals()
    fetchDeposits()
    fetchLedger()
    fetchStats()
  }, [fetchWithdrawals, fetchDeposits])

    
 useEffect(() => {
  if (isLocalDemo) return
  if (!isSupabaseConfigured || profileRole !== 'admin') return

  fetchWithdrawals()
  fetchDeposits()
  fetchLedger()
  fetchStats()
  fetchAdminRoundsQueue()
}, [
  isLocalDemo,
  isSupabaseConfigured,
  profileRole,
  fetchWithdrawals,
  fetchDeposits,
  fetchLedger,
  fetchStats,
  fetchAdminRoundsQueue,
])
  
  // Realtime: withdrawal_requests and deposits
 useEffect(() => {
  if (isLocalDemo) return
  if (!isSupabaseConfigured || profileRole !== 'admin') return

  const channel = supabase
    .channel('admin-updates')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'withdrawal_requests' },
      () => fetchWithdrawals()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'deposits' },
      () => fetchDeposits()
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [isLocalDemo, isSupabaseConfigured, profileRole, fetchWithdrawals, fetchDeposits])

  // Realtime: round sync from user page (live / bursted events)
useEffect(() => {
  if (isLocalDemo) return
  if (!isSupabaseConfigured || profileRole !== 'admin') return

  let cancelled = false
  let activeChannel = null

  ;(async () => {
    const channel = await ensureRoundChannel()
    if (!channel || cancelled) return

    activeChannel = channel

    channel.on('broadcast', { event: 'round_state' }, (payload) => {
      const p = payload?.payload
      if (!p) return

      const rn = p.round_number ?? null
      const state = p.state

      if (import.meta.env?.DEV) {
        console.log('[AdminDashboard] round_state:', state, 'round_number:', rn)
      }

      applyRoundState(state, rn)
    })
  })()

  return () => {
    cancelled = true
    if (activeChannel) {
      supabase.removeChannel(activeChannel)
      if (roundChannelRef.current === activeChannel) {
        roundChannelRef.current = null
      }
      roundChannelReadyRef.current = null
    }
  }
}, [isLocalDemo, isSupabaseConfigured, profileRole, ensureRoundChannel, applyRoundState])
 
  // Local realtime: receive round_state when no Supabase
  useEffect(() => {
    if (!isLocalDemo) return
    if (typeof BroadcastChannel === 'undefined') return
    const bc = new BroadcastChannel('round-sync')
    localBusRef.current = bc
    bc.onmessage = (evt) => {
      const msg = evt?.data
      if (msg?.event !== 'round_state') return
      const p = msg?.payload
      const rn = p?.round_number ?? null
      const state = p?.state

      
      applyRoundState(state, rn)
    }
    return () => {
      try { bc.close() } catch {}
      if (localBusRef.current === bc) localBusRef.current = null
    }
  }, [isLocalDemo, applyRoundState, roundsQueueAdmin.length])

  // Local demo: auto-generate + broadcast rounds on mount
  useEffect(() => {
    if (!isLocalDemo) return
    fetchAdminRoundsQueue()
  }, [isLocalDemo, fetchAdminRoundsQueue])

  const openConfirm = (action, requestId, label, inputLabel, placeholder, submitLabel, type = 'withdrawal', amount = null) => {
    setConfirmConfig({
      action,
      requestId,
      label,
      inputLabel,
      placeholder: placeholder ?? '',
      submitLabel,
      value: '',
      type,
      amount,
    })
    setConfirmOpen(true)
  }

  const closeConfirm = () => {
    setConfirmOpen(false)
    setConfirmConfig(null)
  }

  const handleConfirmSubmit = async () => {
    if (!confirmConfig) return
    const { action, requestId, value } = confirmConfig
    setProcessingId(requestId)
    try {
      let error
      if (action === 'reject') {
        if (confirmConfig.type === 'deposit') {
          const res = await supabase.rpc('admin_deposit_reject', {
            p_deposit_id: requestId,
            p_admin_note: value?.trim() || null,
          })
          error = res.error
        } else {
          const res = await supabase.rpc('admin_withdraw_reject', {
            p_request_id: requestId,
            p_admin_note: value.trim(),
          })
          error = res.error
        }
      } else if (action === 'approve') {
        const res = await supabase.rpc('admin_deposit_approve', {
          p_deposit_id: requestId,
        })
        error = res.error
      } else {
        const res = await supabase.rpc('admin_withdraw_mark_paid', {
          p_request_id: requestId,
          p_paid_ref: value.trim(),
        })
        error = res.error
      }
      if (error) {
        setMessage?.({ type: 'error', text: error.message })
      } else {
        if (action === 'approve') {
          setMessage?.({ type: 'success', text: 'Deposit approved.' })
        } else if (action === 'reject') {
          setMessage?.({ type: 'success', text: confirmConfig.type === 'deposit' ? 'Deposit rejected.' : 'Withdrawal rejected.' })
        } else {
          setMessage?.({ type: 'success', text: 'Marked as paid.' })
        }
        closeConfirm()
        if (confirmConfig.type === 'deposit') {
          fetchDeposits()
        } else {
          fetchWithdrawals()
        }
      }
    } catch (e) {
      setMessage?.({ type: 'error', text: e?.message || 'Action failed' })
    } finally {
      setProcessingId(null)
    }
  }

  if (guardLoading || profileRole !== 'admin') {
    return (
      <div className="admin-dashboard">
        <div className="admin-dashboard__header">
          <h1 className="admin-dashboard__title">Admin Dashboard</h1>
        </div>
        <div className="admin-dashboard__loading">Checking access…</div>
      </div>
    )
  }

  return (
    <div className="admin-dashboard">
      <header className="admin-dashboard__header">
        <h1 className="admin-dashboard__title">Admin Dashboard</h1>
        <nav className="admin-dashboard__nav" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <a href="/" className="admin-dashboard__nav-link" style={{ color: 'var(--accent-green)', textDecoration: 'none', fontWeight: 600 }}>Back to app</a>
          <button type="button" className="admin-dashboard__btn admin-dashboard__btn--secondary" onClick={handleRefreshAll}>
            Refresh All
          </button>
          <ThemeToggle />
          <button type="button" className="admin-dashboard__btn admin-dashboard__btn--secondary" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </header>

      <div style={{ margin: '1rem 0', display: 'flex', gap: '1rem' }}>
          <button 
            type="button" 
            className="admin-dashboard__btn admin-dashboard__btn--primary"
            onClick={() => generateAndBroadcastRounds(12)}
          >
            Generate 12 Rounds Now
          </button>
          <button 
            type="button" 
            className="admin-dashboard__btn admin-dashboard__btn--secondary"
            onClick={() => generateAndBroadcastRounds(1)}
          >
            Force Next Round
          </button>
        </div>


      
      {/* Analytics */}
      <section className="admin-dashboard__grid" aria-label="Analytics">
        <div className="admin-dashboard__card">
          <div className="admin-dashboard__stat-value">{stats.totalUsers ?? '—'}</div>
          <div className="admin-dashboard__stat-label">Total users</div>
        </div>
        <div className="admin-dashboard__card">
          <div className="admin-dashboard__stat-value">{stats.totalBalanceCents != null ? formatKes(stats.totalBalanceCents) : '—'}</div>
          <div className="admin-dashboard__stat-label">Platform balance</div>
        </div>
        <div className="admin-dashboard__card">
          <div className="admin-dashboard__stat-value">{deposits.length}</div>
          <div className="admin-dashboard__stat-label">Pending deposits</div>
        </div>
        <div className="admin-dashboard__card">
          <div className="admin-dashboard__stat-value">{withdrawals.length}</div>
          <div className="admin-dashboard__stat-label">Pending withdrawals</div>
        </div>
      </section>

      {/* Live round from user page */}
      <section className="admin-dashboard__card admin-dashboard__card--wide" style={{ marginBottom: '1.5rem' }}>
        <h3 className="admin-dashboard__card-title">Live round (from user page)</h3>
        <div className="admin-dashboard__next-round">
          <div
            className="admin-dashboard__preview-card"
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
              background: 'var(--surface-subtle, rgba(15,23,42,0.9))',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              fontSize: '0.8rem',
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {liveRoundNumber != null ? `Round #${liveRoundNumber}` : 'No live round'}
            </div>
            {liveRoundNumber != null && (
              <div style={{ opacity: 0.8 }}>
                Tracking via realtime from user page. Bursted rounds will drop from the queue automatically.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Scheduled rounds queue */}
      <section className="admin-dashboard__card admin-dashboard__card--wide" style={{ marginBottom: '1.5rem' }}>
        <h3 className="admin-dashboard__card-title">Scheduled rounds queue</h3>
        {roundsQueueError && <p className="text-error admin-dashboard__error">{roundsQueueError}</p>}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '0.75rem',
            flexWrap: 'wrap',
          }}
        >

          <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
            Live / scheduled queue from admin source. Auto-refills when fewer than 3 scheduled rounds remain.
          </span>
        </div>
        <div style={{ overflowX: 'auto', paddingBottom: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', minHeight: '4.5rem' }}>
            {roundsQueueAdmin.length === 0 ? (
              <div className="admin-dashboard__empty">No scheduled rounds.</div>
            ) : (
              roundsQueueAdmin.slice(0, 12).map((r) => {
                const rn = r?.round_number ?? null
                const isLive = liveRoundNumber != null && rn === liveRoundNumber
                const status = isLive ? 'LIVE' : 'SCHEDULED'
                const accent = isLive ? 'var(--accent-green)' : 'var(--accent-blue, #3b82f6)'
                return (
                <div
                  key={r?.id ?? rn}
                  style={{
                    minWidth: '140px',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.5rem',
                    border: `1px solid ${accent}`,
                    background: 'var(--surface-subtle, rgba(15,23,42,0.85))',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    fontSize: '0.75rem',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>Round #{rn ?? '—'}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ opacity: 0.7 }}>Burst</span>
                    <span>{r?.burst_point != null ? `${Number(r.burst_point).toFixed(2)}x` : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ opacity: 0.7 }}>Status</span>
                    <span style={{ color: accent, fontWeight: 700 }}>{status}</span>
                  </div>
                </div>
                )
              })
            )}
          </div>
        </div>
      </section>

      {/* Recent bursted */}
      <section className="admin-dashboard__card admin-dashboard__card--wide" style={{ marginBottom: '1.5rem' }}>
        <h3 className="admin-dashboard__card-title">Recent bursted</h3>
        <div style={{ overflowX: 'auto', paddingBottom: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', minHeight: '4.5rem' }}>
            {recentBursted.length === 0 ? (
              <div className="admin-dashboard__empty">No bursted rounds yet.</div>
            ) : (
              [...recentBursted].reverse().slice(0, 12).map((rn) => (
                <div
                  key={rn}
                  style={{
                    minWidth: '140px',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--accent-red, #ef4444)',
                    background: 'var(--surface-subtle, rgba(15,23,42,0.85))',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    fontSize: '0.75rem',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>Round #{rn ?? '—'}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ opacity: 0.7 }}>Status</span>
                    <span style={{ color: 'var(--accent-red, #ef4444)', fontWeight: 700 }}>BURSTED</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Deposit queue */}
      <div className="admin-dashboard__card admin-dashboard__card--wide" style={{ marginBottom: '1.5rem' }}>
        <h3 className="admin-dashboard__card-title">Deposit Queue</h3>
        {depositsError && <p className="text-error admin-dashboard__error">{depositsError}</p>}
        {deposits.length === 0 && !depositsError && (
          <div className="admin-dashboard__empty">No pending deposits</div>
        )}
        {deposits.length > 0 && (
          <div className="admin-dashboard__table-wrap">
            <table className="admin-dashboard__table">
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>M-Pesa Ref</th>
                  <th>Phone</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((d) => (
                  <tr key={d.id}>
                    <td>{formatKes(d.amount_cents)}</td>
                    <td>{d.external_ref || '-'}</td>
                    <td>{d.phone ?? '-'}</td>
                    <td>{formatDate(d.created_at)}</td>
                    <td>
                      <div className="admin-dashboard__actions">
                        <button
                          type="button"
                          className="admin-dashboard__btn admin-dashboard__btn--reject"
                          disabled={!!processingId}
                          onClick={() => openConfirm('reject', d.id, 'Reject deposit', 'Admin note (optional)', 'Reason for rejection', 'Reject', 'deposit')}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          className="admin-dashboard__btn admin-dashboard__btn--pay"
                          disabled={!!processingId}
                          onClick={() => openConfirm('approve', d.id, 'Approve deposit', 'Confirm approval', '', 'Approve', 'deposit', d.amount_cents)}
                        >
                          Approve
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Withdrawal queue */}
      <div className="admin-dashboard__card admin-dashboard__card--wide" style={{ marginBottom: '1.5rem' }}>
        <h3 className="admin-dashboard__card-title">Withdrawal Queue</h3>
        {withdrawalsError && <p className="text-error admin-dashboard__error">{withdrawalsError}</p>}
        {withdrawals.length === 0 && !withdrawalsError && (
          <div className="admin-dashboard__empty">No pending withdrawals</div>
        )}
        {withdrawals.length > 0 && (
          <div className="admin-dashboard__table-wrap">
            <table className="admin-dashboard__table">
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Phone</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((r) => (
                  <tr key={r.id}>
                    <td>{formatKes(r.amount_cents)}</td>
                    <td>{r.phone ?? '-'}</td>
                    <td>{formatDate(r.created_at)}</td>
                    <td>
                      <div className="admin-dashboard__actions">
                        <button
                          type="button"
                          className="admin-dashboard__btn admin-dashboard__btn--reject"
                          disabled={!!processingId}
                          onClick={() => openConfirm('reject', r.id, 'Reject withdrawal', 'Admin note', 'Reason for rejection', 'Reject')}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          className="admin-dashboard__btn admin-dashboard__btn--pay"
                          disabled={!!processingId}
                          onClick={() => openConfirm('pay', r.id, 'Mark as paid', 'Payment reference (e.g. M-Pesa code)', 'e.g. ABC123XYZ', 'Mark Paid')}
                        >
                          Mark Paid
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ledger view */}
      <div className="admin-dashboard__card admin-dashboard__card--wide">
        <h3 className="admin-dashboard__card-title">Ledger (last {LEDGER_LIMIT})</h3>
        <div className="admin-dashboard__ledger-filter">
          <label>
            <span className="admin-dashboard__filter-label">Filter by user_id:</span>
            <input
              type="text"
              className="admin-dashboard__input"
              placeholder="UUID or empty for all"
              value={ledgerUserId}
              onChange={(e) => setLedgerUserId(e.target.value)}
              onBlur={fetchLedger}
            />
          </label>
          <button type="button" className="admin-dashboard__btn admin-dashboard__btn--secondary" onClick={fetchLedger}>
            Refresh
          </button>
        </div>
        {ledgerError && <p className="text-error admin-dashboard__error">{ledgerError}</p>}
        <div className="admin-dashboard__table-wrap">
          <table className="admin-dashboard__table admin-dashboard__table--ledger">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Before (avail / locked)</th>
                <th>After (avail / locked)</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.created_at)}</td>
                  <td>{row.type ?? '-'}</td>
                  <td>{formatKes(row.amount_cents)}</td>
                  <td>{row.before_available_cents != null ? `${formatKes(row.before_available_cents)} / ${formatKes(row.before_locked_cents)}` : '-'}</td>
                  <td>{row.after_available_cents != null ? `${formatKes(row.after_available_cents)} / ${formatKes(row.after_locked_cents)}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm dialog */}
      {confirmOpen && confirmConfig && (
        <div className="modal-overlay" onClick={closeConfirm}>
          <div className="modal admin-dashboard__confirm" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title">{confirmConfig.label}</h3>
            <p className="admin-dashboard__confirm-label">{confirmConfig.inputLabel}</p>
            {confirmConfig.action !== 'approve' && (
              <input
                type="text"
                className="modal__input"
                placeholder={confirmConfig.placeholder}
                value={confirmConfig.value}
                onChange={(e) => setConfirmConfig((c) => (c ? { ...c, value: e.target.value } : c))}
              />
            )}
            {confirmConfig.action === 'approve' && (
              <p className="admin-dashboard__confirm-label" style={{ marginTop: '0.5rem' }}>
                This will add {confirmConfig.amount ? formatKes(confirmConfig.amount) : 'funds'} to the user's wallet.
              </p>
            )}
            <div className="admin-dashboard__confirm-actions">
              <button type="button" className="admin-dashboard__btn admin-dashboard__btn--secondary" onClick={closeConfirm}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-dashboard__btn admin-dashboard__btn--pay"
                disabled={(confirmConfig.action !== 'approve' && !confirmConfig.value?.trim()) || !!processingId}
                onClick={handleConfirmSubmit}
              >
                {processingId ? 'Processing…' : confirmConfig.submitLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
// DEBUG TELEMETRY REMOVED - no more 127.0.0.1:7736 calls










