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

  const roundChannelRef = useRef(null);
  const lastNeedRoundsRequestRef = useRef(0);

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
    if (!roundChannelRef.current || !round) return;
    try {
      roundChannelRef.current.send({
        type: "broadcast",
        event: "round_state",
        payload: {
          state,
          round_number: round.round_number ?? null,
          burst_point: round.burst_point ?? null,
        },
      });
    } catch {
      // best-effort only; ignore broadcast failures
    }
  }, []);

  const refreshRoundsQueue = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase.rpc("get_next_rounds_public");
      if (error) throw error;
      setRoundsQueue(data ?? []);
      setCurrentIndex(0);
    } catch {
      setRoundsQueue([]);
    } finally {
      setQueueLoaded(true);
    }
  }, []);

  const topUpRoundsIfLow = useCallback(
    async (currentQueue) => {
      if (!isSupabaseConfigured) return;
      const queue = currentQueue ?? roundsQueue;
      const remaining = queue.length - currentIndex;
      if (remaining > 3) return;

      const maxNumber = queue.reduce(
        (max, r) => (r.round_number != null && r.round_number > max ? r.round_number : max),
        0
      );

      try {
        const { error: genError } = await supabase.rpc("generate_next_rounds", { p_target: 12 });
        if (genError) throw genError;

        const { data, error } = await supabase
          .from("game_rounds")
          .select("id, round_number, burst_point")
          .gt("round_number", maxNumber)
          .order("round_number", { ascending: true });
        if (error) throw error;
        const newOnes = data ?? [];

        setRoundsQueue((prev) => [...prev, ...newOnes]);
      } catch (e) {
        console.error("Top-up rounds failed", e);
      }
    },
    [isSupabaseConfigured, roundsQueue, currentIndex]
  );

  const requestFreshRoundsFromAdmin = useCallback(() => {
    if (!roundChannelRef.current) return;
    try {
      roundChannelRef.current.send({
        type: "broadcast",
        event: "need_new_rounds",
        payload: {
          requested_at: new Date().toISOString(),
        },
      });
    } catch {
      // best-effort only; ignore broadcast failures
    }
  }, []);

  const ensureRoundsAvailable = useCallback(() => {
    if (!isSupabaseConfigured) return;

    const noRounds = roundsQueue.length === 0;
    const finished = roundsQueue.length > 0 && currentIndex >= roundsQueue.length;

    if (!noRounds && !finished) return;

    const now = Date.now();
    if (now - lastNeedRoundsRequestRef.current < 2500) return;
    lastNeedRoundsRequestRef.current = now;

    requestFreshRoundsFromAdmin();
  }, [isSupabaseConfigured, roundsQueue, currentIndex, requestFreshRoundsFromAdmin]);

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

  // Round sync channel (broadcast to admin dashboard)
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const channel = supabase
      .channel("round-sync")
      .on("broadcast", { event: "rounds_update" }, (payload) => {
        const list = payload?.payload?.rounds;
        if (!Array.isArray(list) || list.length === 0) return;
        setRoundsQueue(list);
        setCurrentIndex(0);
        setQueueLoaded(true);
      });
    roundChannelRef.current = channel;
    channel.subscribe();
    return () => {
      if (roundChannelRef.current) {
        supabase.removeChannel(roundChannelRef.current);
        roundChannelRef.current = null;
      }
    };
  }, []);

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

  // Initial rounds queue fetch
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    refreshRoundsQueue();
  }, [refreshRoundsQueue]);

  // Ensure we always have rounds on mount and whenever queue/index changes.
  // ROUNDS NEVER STOP – FORCED REFRESH IMPLEMENTED
  useEffect(() => {
    if (!queueLoaded) return;
    ensureRoundsAvailable();
  }, [queueLoaded, ensureRoundsAvailable]);

  // Fallback polling when no rounds are present on the user page
  useEffect(() => {
    if (!queueLoaded || roundsQueue.length > 0) return;
    const id = setInterval(() => {
      ensureRoundsAvailable();
    }, 3000);
    return () => clearInterval(id);
  }, [queueLoaded, roundsQueue.length, ensureRoundsAvailable]);

  const balance = useMemo(() => (wallet?.available_cents ?? 0) / 100, [wallet?.available_cents]);

  const lastDepositPhone = useMemo(() => (deposits.length > 0 ? deposits[0]?.phone ?? null : null), [deposits]);

  const roundsReady = queueLoaded && roundsQueue.length > 0;
  const currentRound = roundsReady ? roundsQueue[currentIndex] ?? null : null;

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

  const handleRoundBurst = useCallback(async (finishedRound) => {
    if (!roundsReady || !finishedRound) return;

    // Notify admin that this round bursted
    broadcastRoundState("bursted", finishedRound);

    const nextIndex = currentIndex + 1;
    const hasMoreInBuffer = nextIndex < roundsQueue.length;

    if (hasMoreInBuffer) {
      const nextRound = roundsQueue[nextIndex];
      setCurrentIndex(nextIndex);
      // Notify admin which round is now live
      if (nextRound) {
        broadcastRoundState("live", nextRound);
      }
      topUpRoundsIfLow(roundsQueue);
      return;
    }

    // No more rounds in the local buffer – request fresh rounds from admin.
    setCurrentIndex(nextIndex);
    ensureRoundsAvailable();
  }, [roundsReady, currentIndex, roundsQueue, broadcastRoundState, topUpRoundsIfLow, ensureRoundsAvailable]);

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

      const roundIdText = betRound?.round_id;
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
            onMultiplierUpdate={() => {}}
            onBurst={() => handleRoundBurst(currentRound)}
          />
          
          <BetPanel panelId="1" side="top" session={session} onBetClick={handleBetClick} disabled={!canBet} />
          <BetPanel panelId="2" side="bottom" session={session} onBetClick={handleBetClick} disabled={!canBet} />

          <FeedTabs activeTab={feedTab} onTabChange={setFeedTab} />
          {feedTab === "all" && <AllBetsTable />}
          {feedTab === "previous" && <PreviousRound />}
          {feedTab === "top" && <TopBetsList />}
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



