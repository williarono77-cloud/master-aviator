import React, { useEffect, useRef, useState } from "react";

/**
 * Simulation engine for generating rounds locally
 * TODO: Replace multiplier calculation with database rules injection
 */
function useRoundSimulation(enabled) {
  const [simMultiplier, setSimMultiplier] = useState(0.0);
  const [simState, setSimState] = useState("live");
  const rafRef = useRef(null);
  const startTimeRef = useRef(null);
  const crashAtRef = useRef(null);
  const roundDurationRef = useRef(null);
  const stateRef = useRef("live");

  useEffect(() => {
    if (!enabled) return;

    const startNewRound = () => {
      startTimeRef.current = performance.now();
      setSimMultiplier(0.0);
      setSimState("live");
      stateRef.current = "live";
      
      // TODO: Get crash point from database rules
      // For now: random crash between 1.5x and 10x
      crashAtRef.current = 1.5 + Math.random() * 8.5;
      
      // TODO: Get round duration from database rules
      // For now: random duration between 5-20 seconds
      roundDurationRef.current = 5000 + Math.random() * 15000;
    };

    startNewRound();

    const animate = () => {
      if (!startTimeRef.current) {
        startNewRound();
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      const elapsed = performance.now() - startTimeRef.current;
      const progress = Math.min(elapsed / roundDurationRef.current, 1);

      if (stateRef.current === "live") {
        // TODO: Replace with database rules for multiplier calculation
        // For now: exponential growth formula starting from 0.0
        const k = 0.4;
        const timeSeconds = elapsed / 1000;
        // Start at 0, grow exponentially: 0 -> 1.0 -> crash point
        // Formula: multiplier = (exp(k*t) - 1) * scale_factor
        // At t=0: multiplier = 0
        // At t=small: multiplier grows quickly to 1.0+
        const multiplier = (Math.exp(k * timeSeconds) - 1) * 0.8;
        const cappedMultiplier = Math.min(multiplier, crashAtRef.current);

        setSimMultiplier(cappedMultiplier);

        // Check if we've reached crash point
        if (cappedMultiplier >= crashAtRef.current - 0.001 || progress >= 1) {
          setSimState("ended");
          stateRef.current = "ended";
          
          // After showing ended, start new round after rest period
          setTimeout(() => {
            startNewRound();
          }, 6500); // 1.5s burst + 5s rest
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [enabled]);

  return { multiplier: simMultiplier, state: simState };
}

/**
 * Game card with plane icon, rotating circles, and rest period countdown.
 * - Plane icon with spinning propeller (no movement)
 * - Multiplier displayed inside two counter-rotating circles
 * - 5-second rest period after each round with blue countdown circumference
 */
export default function GameCard({ multiplier, state }) {
  // Use simulation if no external data provided
  const useSim = multiplier === null || multiplier === undefined || state === null || state === undefined;
  const sim = useRoundSimulation(useSim);
  
  const actualMultiplier = useSim ? sim.multiplier : multiplier;
  const actualState = useSim ? sim.state : state;

  const [roundState, setRoundState] = useState("live"); // 'live' | 'burst' | 'rest'
  const [restCountdown, setRestCountdown] = useState(5);
  const [restProgress, setRestProgress] = useState(0);
  const restTimerRef = useRef(null);
  const burstTimerRef = useRef(null);
  const prevStateRef = useRef(actualState);
  const roundStateRef = useRef("live");

  // Sync ref with state
  useEffect(() => {
    roundStateRef.current = roundState;
  }, [roundState]);

  // Determine round state from props
  useEffect(() => {
    const isEnded = actualState === "ended" || actualState === "flew_away";
    const isLive = actualState === "live" || actualState === "active";
    const currentRoundState = roundStateRef.current;

    // Clean up any existing timers
    if (restTimerRef.current) {
      clearInterval(restTimerRef.current);
      restTimerRef.current = null;
    }
    if (burstTimerRef.current) {
      clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
    }

    // If state changed from live to ended, show BURSTED then start rest period
    if (prevStateRef.current !== "ended" && isEnded && (currentRoundState === "live" || currentRoundState === "burst")) {
      // First show BURSTED for 1.5 seconds
      setRoundState("burst");
      roundStateRef.current = "burst";

      burstTimerRef.current = setTimeout(() => {
        // Then start rest period
        setRoundState("rest");
        roundStateRef.current = "rest";
        setRestCountdown(5);
        setRestProgress(0);

        // Start countdown timer
        let countdown = 5;
        const interval = setInterval(() => {
          countdown -= 1;
          setRestCountdown(countdown);
          setRestProgress((5 - countdown) / 5);

          if (countdown <= 0) {
            clearInterval(interval);
            restTimerRef.current = null;
            setRoundState("live");
            roundStateRef.current = "live";
            setRestProgress(1);
          }
        }, 1000);

        restTimerRef.current = interval;
      }, 1500);
    } else if (isLive && currentRoundState === "rest") {
      // If state becomes live during rest, cancel rest
      if (restTimerRef.current) {
        clearInterval(restTimerRef.current);
        restTimerRef.current = null;
      }
      setRoundState("live");
      roundStateRef.current = "live";
      setRestCountdown(5);
      setRestProgress(0);
    } else if (isLive && currentRoundState !== "live" && currentRoundState !== "rest" && currentRoundState !== "burst") {
      setRoundState("live");
      roundStateRef.current = "live";
      setRestCountdown(5);
      setRestProgress(0);
    }

    prevStateRef.current = actualState;

    return () => {
      if (restTimerRef.current) {
        clearInterval(restTimerRef.current);
        restTimerRef.current = null;
      }
      if (burstTimerRef.current) {
        clearTimeout(burstTimerRef.current);
        burstTimerRef.current = null;
      }
    };
  }, [actualState]);

  // Display multiplier: show 0.0x if null/undefined/0, otherwise show actual value
  const numMultiplier = actualMultiplier === null || actualMultiplier === undefined ? null : Number(actualMultiplier);
  const displayMultiplier = numMultiplier === null || numMultiplier === undefined || numMultiplier === 0
    ? "0.00" 
    : numMultiplier.toFixed(2);

  return (
    <div className="game-card">
      <div className="game-card__content">
        {/* Plane Icon with Spinning Propeller */}
        <div className="game-card__plane-container">
          <div className="game-card__plane-wrapper">
            <svg className="game-card__plane" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              {/* Plane Body */}
              <path d="M 20 50 L 60 50 L 70 45 L 75 50 L 70 55 L 60 50 Z" fill="#ef4444" />
              {/* Fuselage */}
              <ellipse cx="50" cy="50" rx="8" ry="5" fill="#ef4444" />
              {/* Wings */}
              <path d="M 45 50 L 35 40 L 30 45 L 45 50 Z" fill="#ef4444" />
              <path d="M 45 50 L 35 60 L 30 55 L 45 50 Z" fill="#ef4444" />
              {/* Tail */}
              <path d="M 20 50 L 15 45 L 10 50 L 15 55 Z" fill="#ef4444" />
              {/* White X Mark */}
              <path d="M 50 45 L 48 47 L 50 49 L 52 47 Z" fill="white" />
              <path d="M 50 51 L 48 53 L 50 55 L 52 53 Z" fill="white" />
              <path d="M 48 49 L 46 47 L 48 45 L 50 47 Z" fill="white" />
              <path d="M 52 49 L 54 47 L 52 45 L 50 47 Z" fill="white" />
            </svg>
            <div className="game-card__propeller"></div>
          </div>
        </div>

        {/* Rotating Circles with Multiplier */}
        <div className="game-card__circles-container">
          <div className="game-card__circle game-card__circle--outer">
            <div className="game-card__circle-markers">
              <div className="game-card__marker game-card__marker--square"></div>
              <div className="game-card__marker game-card__marker--x"></div>
              <div className="game-card__marker game-card__marker--target"></div>
              <div className="game-card__marker game-card__marker--dots"></div>
            </div>
          </div>
          <div className="game-card__circle game-card__circle--inner"></div>
          
          {/* Blue Countdown Circumference (only during rest period) */}
          {roundState === "rest" && (
            <svg className="game-card__countdown-circle" viewBox="0 0 200 200">
              <circle
                className="game-card__countdown-path"
                cx="100"
                cy="100"
                r="90"
                fill="none"
                stroke="#3b82f6"
                strokeWidth="4"
                strokeDasharray={2 * Math.PI * 90}
                strokeDashoffset={2 * Math.PI * 90 * (1 - restProgress)}
                strokeLinecap="round"
                transform="rotate(-90 100 100)"
                style={{
                  transition: 'stroke-dashoffset 1s linear'
                }}
              />
            </svg>
          )}

          {/* Multiplier Display */}
          <div className="game-card__multiplier-display">
            {roundState === "rest" ? (
              <>
                <div className="game-card__rest-label">Next Round In</div>
                <div className="game-card__countdown">{restCountdown}s</div>
              </>
            ) : roundState === "burst" ? (
              <div className="game-card__burst">BURSTED</div>
            ) : (
              <div className="game-card__multiplier game-card__multiplier--live">
                {displayMultiplier}x
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
