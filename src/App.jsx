import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [currentRound, setCurrentRound] = useState(null);
  const [deposits, setDeposits] = useState([]);
  const [scheduledQueuePublic, setScheduledQueuePublic] = useState([]);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [currentLiveRoundId, setCurrentLiveRoundId] = useState(null);
  const [lastConsumedRoundId, setLastConsumedRoundId] = useState(null);
const [liveMultiplier, setLiveMultiplier] = useState(1.00);
  const [showDashboard, setShowDashboard] = useState(false);

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

  const refreshPublicData = useCallback(async () => {
    try {
      const roundRes = await supabase.from("current_round").select("*").maybeSingle();
      if (roundRes.error) {
        setCurrentRound(null);
        return;
      }
      setCurrentRound(roundRes.data ?? null);
    } catch {
      setCurrentRound(null);
    }
  }, []);

  const refreshPublicQueue = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase.rpc("get_next_rounds_public");
      if (error) throw error;
      setScheduledQueuePublic(data ?? []);
    } catch {
      setScheduledQueuePublic([]);
    } finally {
      setQueueLoaded(true);
    }
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

  // Public data: initial fetch + polling (faster during break so next round is fetched when tables update)
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    refreshPublicData();
    const isBreak = currentRound?.status === "ended" || currentRound?.state === "ended";
    const intervalMs = isBreak ? 1500 : 3000;
    const interval = setInterval(refreshPublicData, intervalMs);
    return () => clearInterval(interval);
  }, [refreshPublicData, currentRound?.status, currentRound?.state]);

  // Initial public queue fetch
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    refreshPublicQueue();
  }, [refreshPublicQueue]);

  // Realtime: game rounds
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const channel = supabase
      .channel("round-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "game_rounds" }, () => {
        refreshPublicData();
        refreshPublicQueue();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshPublicData, refreshPublicQueue]);

  // Track current live round id from public current_round view
  useEffect(() => {
    const roundId = currentRound?.id ?? null;
    const status = currentRound?.status ?? currentRound?.state ?? null;

    if (!roundId) {
      setCurrentLiveRoundId(null);
      return;
    }

    if (status === "live" || status === "active") {
      setCurrentLiveRoundId(roundId);
    }
  }, [currentRound?.id, currentRound?.status, currentRound?.state]);

  // Consume finished round via RPC without exposing future burst points
 // Auto consume + resolve round when server marks it as ended (full auto-progression)
useEffect(() => {
  if (!isSupabaseConfigured) return;

  const roundId = currentRound?.id ?? null;
  const status = currentRound?.status ?? currentRound?.state ?? null;

  if (!roundId || status !== "ended") return;
  if (roundId === lastConsumedRoundId || consumingRound) return;

  let cancelled = false;

     const processRoundEnd = async () => {
      setConsumingRound(true);
      try {
        // Step 1: Consume / close the round
        const { error: consumeError } = await supabase.rpc("consume_round", { p_round_id: roundId });
        if (consumeError) {
          throw new Error(`Consume RPC failed: ${consumeError.message}`);
        }
        console.log(`Round ${roundId} consumed successfully`);

        // Step 2: Resolve bets and pay winners
        const { error: resolveError } = await supabase.rpc("resolve_round_bets", { p_round_id: roundId });
        if (resolveError) {
          throw new Error(`Resolve RPC failed: ${resolveError.message}`);
        }
        console.log(`Round ${roundId} bets resolved successfully`);

        if (!cancelled) {
          setLastConsumedRoundId(roundId);
          refreshPublicQueue(); // triggers realtime for AdminDashboard
          setMessage({
            type: "success",
            text: `Round #${roundId} burst! Winners paid automatically. Next round starting soon.`
          });
        }
      } catch (error) {
        console.error("Round end processing failed:", error.message || error);
        let userMsg = "Error settling round (payout may be delayed) – check your balance or contact support.";
        
        if (error.message.includes("Consume")) {
          userMsg = "Failed to close round – game may be stuck. Please wait or refresh.";
        } else if (error.message.includes("Resolve")) {
          userMsg = "Failed to pay winners – bets resolved may be delayed. Check wallet soon.";
        }

        setMessage({ type: "error", text: userMsg });
      } finally {
        if (!cancelled) {
          setConsumingRound(false);
        }
      }
    };

  processRoundEnd();

  return () => {
    cancelled = true;
  };
}, [currentRound?.id, currentRound?.status, currentRound?.state, lastConsumedRoundId, consumingRound, refreshPublicQueue]);


  // Client-side safety net: force-end round if stuck in "live" too long
  useEffect(() => {
    if (!currentRound || currentRound.status !== "live") return;

    const MAX_ROUND_DURATION_MS = 2 * 60 * 1000; // 2 minutes (120000 ms) - adjustable
    const timeoutId = setTimeout(() => {
      if (currentRound?.status === "live") {
        console.warn(`Round ${currentRound.id} stuck in "live" state for >2 minutes → forcing end as safety`);
        supabase.rpc("force_end_round", { p_round_id: currentRound.id })
          .then(({ error }) => {
            if (error) {
              console.error("Safety force-end RPC failed:", error.message);
            } else {
              console.log(`Safety force-end triggered for round ${currentRound.id}`);
            }
          })
          .catch((err) => console.error("Safety force-end promise error:", err));
      }
    }, MAX_ROUND_DURATION_MS);

    return () => clearTimeout(timeoutId);
  }, [currentRound?.id, currentRound?.status]);

      // Watch live multiplier from GameCard → force burst when it hits server point
    useEffect(() => {
      if (!currentRound || currentRound.status !== 'live' || !currentRound.burst_point) return;
    
      if (liveMultiplier >= currentRound.burst_point) {
        console.log(`Client burst detected: ${liveMultiplier.toFixed(2)}x >= ${currentRound.burst_point}x`);
    
        // Force-end the round on server
        supabase.rpc('force_end_round', { p_round_id: currentRound.id })
          .then(({ error }) => {
            if (error) {
              console.error('Force end RPC failed:', error.message);
              setMessage?.({ type: 'error', text: 'Failed to end round (check console)' });
            } else {
              console.log('Client successfully forced round end');
              setMessage?.({ type: 'success', text: 'Burst detected – round ending!' });
            }
          })
          .catch(err => {
            console.error('Force end promise error:', err);
          });
      }
    }, [liveMultiplier, currentRound?.id, currentRound?.status, currentRound?.burst_point, setMessage]);
      
  const balance = useMemo(() => (wallet?.available_cents ?? 0) / 100, [wallet?.available_cents]);

  const lastDepositPhone = useMemo(() => (deposits.length > 0 ? deposits[0]?.phone ?? null : null), [deposits]);

  const currentState = useMemo(() => currentRound?.status ?? currentRound?.state ?? null, [currentRound]);

  const roundsReady = queueLoaded && scheduledQueuePublic.length > 0;

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

  const betRound = scheduledQueuePublic[0] ?? null;
  const canBet = roundsReady && betRound?.status === "scheduled";

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
              state={roundsReady ? currentState : null}
              onMultiplierUpdate={setLiveMultiplier}
            />
            {consumingRound && (
            <div className="message-banner message-banner--info" role="status" style={{ margin: "1rem", textAlign: "center" }}>
              Processing round end... Winners being paid. Please wait a moment.
            </div>
          )}
          
          <BetPanel panelId="1" side="top" session={session} onBetClick={handleBetClick} disabled={!canBet || consumingRound} />
          <BetPanel panelId="2" side="bottom" session={session} onBetClick={handleBetClick} disabled={!canBet || consumingRound} />

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



