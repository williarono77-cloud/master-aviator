import React, { useEffect, useRef, useState } from "react";

/**
 * Game card with plane icon, rotating circles, and rest period countdown.
 * Driven entirely by the provided burstPoint; no local fallback simulation
 * is used when real round data is available.
 */
export default function GameCard({ burstPoint, onMultiplierUpdate, onBurst }) {
  const [multiplier, setMultiplier] = useState(1.0);
  const [roundState, setRoundState] = useState("live"); // 'live' | 'burst' | 'rest'
  const [restCountdown, setRestCountdown] = useState(5);
  const [restProgress, setRestProgress] = useState(0);

  const rafRef = useRef(null);
  const restTimerRef = useRef(null);
  const burstTimerRef = useRef(null);
  const roundStateRef = useRef("live");
  const hasBurstRef = useRef(false);

  // Start a new round animation whenever burstPoint changes
  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (restTimerRef.current) {
      clearInterval(restTimerRef.current);
      restTimerRef.current = null;
    }
    if (burstTimerRef.current) {
      clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
    }

    setMultiplier(1.0);
    setRoundState("live");
    roundStateRef.current = "live";
    setRestCountdown(5);
    setRestProgress(0);
    hasBurstRef.current = false;

    const numericBurst = Number(burstPoint);
    if (!numericBurst || numericBurst <= 1) {
      return;
    }

    const startTime = performance.now();
    const target = numericBurst;

    const animate = (now) => {
      if (roundStateRef.current !== "live") return;

      const elapsed = now - startTime;
      const t = elapsed / 1000;

      const k = 0.35;
      const raw = 1 + (Math.exp(k * t) - 1);
      const next = Math.min(raw, target);

      setMultiplier(next);
      if (onMultiplierUpdate) {
        onMultiplierUpdate(next);
      }

      if (!hasBurstRef.current && next >= target) {
        hasBurstRef.current = true;
        setRoundState("burst");
        roundStateRef.current = "burst";

        if (onBurst) {
          onBurst();
        }

        burstTimerRef.current = setTimeout(() => {
          setRoundState("rest");
          roundStateRef.current = "rest";
          setRestCountdown(5);
          setRestProgress(0);

          let remaining = 5;
          const interval = setInterval(() => {
            remaining -= 1;
            setRestCountdown(remaining);
            setRestProgress((5 - remaining) / 5);

            if (remaining <= 0) {
              clearInterval(interval);
              restTimerRef.current = null;
              setRoundState("live");
              roundStateRef.current = "live";
              setRestProgress(1);
            }
          }, 1000);

          restTimerRef.current = interval;
        }, 1500);

        return;
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (restTimerRef.current) {
        clearInterval(restTimerRef.current);
        restTimerRef.current = null;
      }
      if (burstTimerRef.current) {
        clearTimeout(burstTimerRef.current);
        burstTimerRef.current = null;
      }
    };
  }, [burstPoint, onMultiplierUpdate, onBurst]);

  const numMultiplier = multiplier === null || multiplier === undefined ? null : Number(multiplier);
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
