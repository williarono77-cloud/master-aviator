import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getAuthRole, setAuthRole, clearAuthRole } from "./utils/storage.js";

import TopBar from "./components/TopBar.jsx";
import HeaderRow from "./components/HeaderRow.jsx";
import Drawer from "./components/Drawer.jsx";
import GameHeader from "./components/GameHeader.jsx";
import GameCard from "./components/GameCard.jsx";
import BetPanel from "./components/BetPanel.jsx";
import FeedTabs from "./components/FeedTabs.jsx";
import AllBetsTable from "./components/AllBetsTable.jsx";
import PreviousRound from "./components/PreviousRound.jsx";
import TopBetsList from "./components/TopBetsList.jsx";
import AuthModal from "./components/AuthModal.jsx";
import DepositModal from "./components/DepositModal.jsx";
import WithdrawModal from "./components/WithdrawModal.jsx";
import Toast from "./components/Toast.jsx";
import LoadingOverlay from "./components/LoadingOverlay.jsx";
import Dashboard from "./components/Dashboard.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); // 'admin' | 'user' from profiles; null when logged out
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  // UI state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [feedTab, setFeedTab] = useState("all"); // 'all' | 'previous' | 'top'

  // Data state
  const [wallet, setWallet] = useState(null);
  const [deposits, setDeposits] = useState([]);
  const [roundsQueue, setRoundsQueue] = useState([]);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDashboard, setShowDashboard] = useState(false);
  const [demoAllBets, setDemoAllBets] = useState([]);
  const [demoPreviousRound, setDemoPreviousRound] = useState(null);
  const [demoTopBets, setDemoTopBets] = useState([]);

  const roundChannelRef = useRef(null);
  const roundsQueueLengthRef = useRef({ len: 0, currentRound: null, handleRoundBurst: null, onBurst: null });
  const localRoundBusRef = useRef(null);
  const demoRef = useRef({ seed: Math.floor(Math.random() * 1e9), seq: 0 });

  const userId = session?.user?.id ?? null;

  const clearMessage = useCallback(() => setMessage(null), []);

  const refreshPrivateData = useCallback(async () => {
    if (!userId) {
      setWallet(null);
      setDeposits([]);
      return;
    }

    try {
      const [walletRes, depositsRes] = await Promise.all([
        supabase.from("wallets").select("available_cents, locked_cents").eq("user_id", userId).maybeSingle(),
        supabase.from("deposits").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
      ]);

      if (walletRes.error || depositsRes.error) {
        setWallet(null);
        setDeposits([]);
        return;
      }
      setWallet(walletRes.data ?? null);
      setDeposits(depositsRes.data ?? []);
    } catch {
      setWallet(null);
      setDeposits([]);
    }
  }, [userId]);

  const broadcastRoundState = useCallback((state, round) => {
    if (!round) return;
    const payload = {
      state,
      round_number: round.round_number ?? null,
      burst_point: round.burst_point ?? null,
    };

    // Supabase transport
    if (roundChannelRef.current) {
      try {
        roundChannelRef.current.send({
          type: "broadcast",
          event: "round_state",
          payload,
        });
      } catch {
        // best-effort only
      }
    }

    // Local transport (no Supabase)
    if (!isSupabaseConfigured && localRoundBusRef.current) {
      try {
        localRoundBusRef.current.postMessage({ event: "round_state", payload });
      } catch {
        // best-effort only
      }
    }
  }, []);

  const generateDemoBetsForRound = useCallback((round, opts = {}) => {
    const burst = Number(round?.burst_point ?? 0);
    const roundNumber = round?.round_number ?? null;
    if (!Number.isFinite(burst) || burst <= 1 || roundNumber == null) return [];

    const count = opts.count ?? 10;
    const nowIso = new Date().toISOString();
    const bets = [];
    for (let i = 0; i < count; i += 1) {
      demoRef.current.seq += 1;
      const stake = Math.round((100 + Math.random() * 4900) / 10) * 10; // KES 100..5000
      const cashout = Number((1 + Math.random() * Math.max(0.01, burst - 0.05)).toFixed(2));
      const didWin = cashout < burst;
      const win = didWin ? Math.round(stake * cashout) : 0;
      bets.push({
        id: `demo-bet-${roundNumber}-${demoRef.current.seq}`,
        player: `Player ${((demoRef.current.seq + demoRef.current.seed) % 99) + 1}`,
        bet_kes: stake,
        multiplier: cashout.toFixed(2),
        win_kes: win,
        created_at: nowIso,
        round_number: roundNumber,
        result_x: burst,
        round_max_x: burst,
      });
    }
    return bets;
  }, []);

  function fetchAndSetRole(uid, cancelledRef) {
    if (!uid) return;
    setRole(getAuthRole(uid) ?? null);
    supabase
      .from("profiles")
      .select("role")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelledRef?.current) return;
        if (error) {
          console.error("Profile role fetch failed", error);
          setRole((prev) => prev ?? "user");
          return;
        }
        const r = data?.role === "admin" ? "admin" : "user";
        setRole(r);
        setAuthRole(uid, r);
      });
  }

  // Initialize session and role
  useEffect(() => {
    const cancelled = { current: false };

    if (!isSupabaseConfigured) {
      setSession(null);
      setUser(null);
      setRole(null);
      setLoading(false);
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled.current) return;
        const s = data?.session ?? null;
        setSession(s);
        setUser(s?.user ?? null);
        setLoading(false);
        if (!s?.user?.id) {
          setRole(null);
          clearAuthRole();
        } else {
          fetchAndSetRole(s.user.id, cancelled);
        }
      })
      .catch(() => {
        if (cancelled.current) return;
        setSession(null);
        setUser(null);
        setRole(null);
        setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (!s?.user?.id) {
        setRole(null);
        clearAuthRole();
      } else {
        fetchAndSetRole(s.user.id, cancelled);
      }
    });

    return () => {
      cancelled.current = true;
      data?.subscription?.unsubscribe?.();
    };
  }, []);

    // Round sync channel
  // === IMPROVED BOOTSTRAP (replace the old useEffect that starts at line ~85) ===
  useEffect(() => {
    const handleRoundsUpdate = (list) => {
      if (!Array.isArray(list) || list.length === 0) return;
      setRoundsQueue(list);
      setCurrentIndex(0);
      setQueueLoaded(true);
    };
  
    let supabaseChannel = null;
  
    // === REAL SUPABASE PATH ===
    if (isSupabaseConfigured) {
      // Subscribe to broadcast (keep existing behaviour)
      supabaseChannel = supabase
        .channel("round-sync")
        .on("broadcast", { event: "rounds_update" }, (payload) =>
          handleRoundsUpdate(payload?.payload?.rounds)
        )
        .subscribe();
  
      // <<< NEW: Bootstrap if DB is empty >>>
      const bootstrapReal = async () => {
        // Try to load existing live round
        const { data } = await supabase
          .from('game_rounds')
          .select('*')
          .eq('status', 'live')
          .order('created_at', { ascending: false })
          .limit(5);
  
        if (data && data.length > 0) {
          handleRoundsUpdate(data);
          supabase.channel("round-sync").send({
            type: 'broadcast',
            event: 'rounds_update',
            payload: { rounds: data }
          });
        } else {
          // No live round → create one automatically (graceful fallback)
          console.log("No live round found – auto-creating demo live round");
          const tempRound = {
            id: "auto-" + Date.now(),
            round_id: "R1001",
            round_number: 1001,
            burst_point: 5.67,
            status: "live",
            starts_at: new Date().toISOString()
          };
          handleRoundsUpdate([tempRound]);
          // Optional: also insert to DB for persistence
          await supabase.from('game_rounds').insert(tempRound).ignore();
        }
      };
      bootstrapReal();
    }
  
    // === DEMO PATH (unchanged, still works perfectly) ===
    else {
      const base = Math.floor(Date.now() / 1000) % 100000;
      const demoRounds = Array.from({ length: 12 }, (_, i) => ({
        id: `demo-${base + i + 1}`,
        round_id: `demo-${base + i + 1}`,
        round_number: base + i + 1,
        burst_point: Number((1.3 + Math.random() * 8.7).toFixed(2)),
        status: "live"
      }));
      handleRoundsUpdate(demoRounds);
      // ... rest of your existing demo BroadcastChannel code stays the same
    }
  
    return () => {
      if (supabaseChannel) supabase.removeChannel(supabaseChannel);
    };
  }, []);   // keep empty dependency

  // Load private data when session changes
  useEffect(() => {
    if (!userId) {
      setWallet(null);
      setDeposits([]);
      return;
    }
    refreshPrivateData();
  }, [userId, refreshPrivateData]);

  // Realtime: wallets
  useEffect(() => {
    if (!userId || !isSupabaseConfigured) return;

    const channel = supabase
      .channel(`wallet-updates:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload?.new) setWallet(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const balance = useMemo(() => (wallet?.available_cents ?? 0) / 100, [wallet?.available_cents]);

  const lastDepositPhone = useMemo(() => (deposits.length > 0 ? deposits[0]?.phone ?? null : null), [deposits]);

  const roundsReady = queueLoaded && roundsQueue.length > 0;
  const currentRound = roundsReady ? roundsQueue[currentIndex] ?? null : null;
  roundsQueueLengthRef.current.currentRound = currentRound;

  const handleAuthSuccess = useCallback(() => {
    refreshPrivateData();
    setMessage({ type: "success", text: "Welcome! You are now logged in." });
  }, [refreshPrivateData]);

  const handleDepositSuccess = useCallback(() => {
    // Refresh wallet / transactions, then show dashboard so the user can wait for approval there
    refreshPrivateData();
    setShowDashboard(true);
    setDepositModalOpen(false);
  }, [refreshPrivateData]);

  const handleLogout = useCallback(async () => {
    try {
      clearAuthRole();
      await supabase.auth.signOut();
    } finally {
      setDrawerOpen(false);
      setMessage({ type: "info", text: "Logged out" });
    }
  }, []);

  const betRound = currentRound ?? null;
  const canBet = roundsReady && !!betRound;

  const handleRoundBurst = useCallback(
    async (finishedRound) => {
      if (!roundsReady || !finishedRound) return;
      // Mark burst immediately so admin tables can update during the break.
      broadcastRoundState("bursted", finishedRound);
      // Do NOT advance index here; we advance after the 5s rest completes (from GameCard).

      if (!isSupabaseConfigured) {
        const roundBets = generateDemoBetsForRound(finishedRound, { count: 10 });
        setDemoPreviousRound({
          result: Number(finishedRound?.burst_point ?? 0),
          bets: roundBets.map((b) => ({
            id: b.id,
            player: b.player,
            bet_kes: b.bet_kes,
            multiplier: b.multiplier,
            win_kes: b.win_kes,
          })),
        });
        setDemoAllBets((prev) => {
          const next = [...roundBets, ...(Array.isArray(prev) ? prev : [])].slice(0, 50);
          return next;
        });
        setDemoTopBets((prev) => {
          const merged = [...roundBets, ...(Array.isArray(prev) ? prev : [])];
          merged.sort((a, b) => (b.win_kes ?? 0) - (a.win_kes ?? 0));
          return merged.slice(0, 20);
        });
      }
    },
    [roundsReady, broadcastRoundState, generateDemoBetsForRound]
  );

  const handleRestComplete = useCallback(() => {
    if (!roundsReady) return;
    setCurrentIndex((prev) => prev + 1);
  }, [roundsReady]);
  roundsQueueLengthRef.current.handleRoundBurst = handleRoundBurst;
  if (!roundsQueueLengthRef.current.onBurst) {
    roundsQueueLengthRef.current.onBurst = () => {
      roundsQueueLengthRef.current.handleRoundBurst?.(roundsQueueLengthRef.current.currentRound);
    };
  }

  // Whenever the current index or queue changes, broadcast the live round
  useEffect(() => {
    if (!roundsReady) return;
    const round = roundsQueue[currentIndex] ?? null;
    if (round) {
      broadcastRoundState("live", round);
    }
  }, [roundsReady, roundsQueue, currentIndex, broadcastRoundState]);

  const handleBetClick = useCallback(
    async (action, stake, side) => {
      if (action === "auth") {
        setAuthModalOpen(true);
        return;
      }

      if (action !== "bet" || !userId) return;
      if (!roundsReady) {
        setMessage({ type: "error", text: "Waiting for rounds. Admin must generate rounds." });
        return;
      }
      if (!canBet) {
        setMessage({ type: "error", text: "Betting is closed. Round is not in scheduled state." });
        return;
      }

      const stakeNumber = Number(stake);

      if (!Number.isFinite(stakeNumber)) {
        setMessage({ type: "error", text: "Invalid stake amount." });
        return;
      }
      if (stakeNumber < 100) {
        setMessage({ type: "error", text: "Minimum bet amount is KSh 100." });
        return;
      }

      const available = (wallet?.available_cents ?? 0) / 100;
      if (stakeNumber > available) {
        setMessage({ type: "error", text: "Insufficient balance." });
        return;
      }

      const roundIdText = betRound?.round_id ?? (betRound?.id != null ? String(betRound.id) : "");
      if (!roundIdText) {
        setMessage({ type: "error", text: "No bettable round. Waiting for rounds." });
        return;
      }

      const validSide = side === "top" || side === "bottom" ? side : "top";
      try {
        const stakeCents = Math.round(stakeNumber * 100);
        const { error } = await supabase.rpc("game_place_bet", {
          p_round_id: String(roundIdText),
          p_side: validSide,
          p_stake_cents: stakeCents,
        });

        if (error) throw error;

        setMessage({ type: "success", text: `Bet placed (${validSide}): KSh ${stakeNumber.toFixed(2)}` });
        refreshPrivateData();
      } catch (e) {
        const msg = e?.message ?? "";
        if (msg.includes("INSUFFICIENT_FUNDS")) {
          setMessage({ type: "error", text: "Insufficient balance." });
        } else if (msg.includes("BETTING_CLOSED")) {
          setMessage({ type: "error", text: "Betting closed for this round." });
        } else {
          setMessage({ type: "error", text: msg || "Failed to place bet." });
        }
      }
    },
    [userId, wallet?.available_cents, betRound, roundsReady, canBet, refreshPrivateData]
  );

  if (loading) {
    return <LoadingOverlay />;
  }

  return (
    <div className={`app ${fullscreen ? "app--fullscreen" : ""}`}>
     <Toast message={message} onDismiss={clearMessage} />
      <TopBar onBack={() => {}} fullscreen={fullscreen} onToggleFullscreen={() => setFullscreen((v) => !v)} />

      <HeaderRow
        balance={userId ? balance : null}
        onMenuClick={() => setDrawerOpen(true)}
        onChatClick={() => setMessage({ type: "info", text: "Chat coming soon" })}
        onAuthClick={() => setAuthModalOpen(true)}
      />

      {showDashboard ? (
        <Dashboard user={user} setMessage={setMessage} onBackToGame={() => setShowDashboard(false)} />
      ) : (
        <>
          <GameHeader />

          {!roundsReady && queueLoaded && (
            <div className="message-banner message-banner--error" role="status" style={{ margin: "0 1rem 1rem" }}>
              Waiting for rounds. Admin must generate rounds in the Admin Dashboard.
            </div>
          )}
          <GameCard
            burstPoint={currentRound?.burst_point ?? null}
            onMultiplierUpdate={null}
            onBurst={roundsQueueLengthRef.current.onBurst}
            onRestComplete={handleRestComplete}
          />
          
          <BetPanel panelId="1" side="top" session={session} onBetClick={handleBetClick} disabled={!canBet} />
          <BetPanel panelId="2" side="bottom" session={session} onBetClick={handleBetClick} disabled={!canBet} />

          <FeedTabs activeTab={feedTab} onTabChange={setFeedTab} />
          {feedTab === "all" && <AllBetsTable bets={!isSupabaseConfigured ? demoAllBets : null} />}
          {feedTab === "previous" && <PreviousRound data={!isSupabaseConfigured ? demoPreviousRound : null} />}
          {feedTab === "top" && <TopBetsList data={!isSupabaseConfigured ? demoTopBets : null} />}
        </>
      )}

      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        session={session}
        user={user}
        role={role}
        onDepositClick={() => setDepositModalOpen(true)}
        onWithdrawClick={() => setWithdrawModalOpen(true)}
        onAuthClick={() => setAuthModalOpen(true)}
        onLogout={handleLogout}
      />

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} onSuccess={handleAuthSuccess} />

      <DepositModal
        isOpen={depositModalOpen}
        onClose={() => setDepositModalOpen(false)}
        onSuccess={handleDepositSuccess}
      />

      <WithdrawModal
        isOpen={withdrawModalOpen}
        onClose={() => setWithdrawModalOpen(false)}
        userId={user?.id}
        balance={balance}
        lastDepositPhone={lastDepositPhone}
        onWithdrawSuccess={refreshPrivateData}
        setMessage={setMessage}
      />
    </div>
  );
}



