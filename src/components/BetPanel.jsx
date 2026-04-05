import { useMemo, useState } from "react";
import { formatMoney } from "../utils/formatMoney.js";
import { getStake, setStake } from "../utils/storage.js";

const QUICK_CHIPS = [100, 250, 1000, 25000];

export default function BetPanel({
  panelId = "1",
  side = "top",
  session,
  onBetClick,
  disabled = false,
  roundPhase = "break",
  activeBet = null,
  currentMultiplier = 1,
}) {
  const [stake, setStakeState] = useState(() => getStake(panelId) || 100);
  const [activeTab, setActiveTab] = useState("bet");

  function updateStake(delta) {
    const newStake = Math.max(100, stake + delta);
    setStakeState(newStake);
    setStake(panelId, newStake);
  }

  function setQuickChip(value) {
    setStakeState(value);
    setStake(panelId, value);
  }

  const hasOpenBet = activeBet?.status === "placed";
  const isBreak = roundPhase === "break";
  const isRising = roundPhase === "rising";
  const canPlaceBet = isBreak && !hasOpenBet && !disabled;
  const canCashout = isRising && hasOpenBet;

  const actionLabel = canCashout ? "Cashout" : "Bet";

  const actionAmount = useMemo(() => {
    if (canCashout) {
      const live = Number(currentMultiplier);
      const safe = Number.isFinite(live) && live > 1 ? live : 1;
      return formatMoney((activeBet?.stake ?? 0) * safe);
    }

    if (hasOpenBet) {
      return formatMoney(activeBet?.stake ?? 0);
    }

    return formatMoney(stake);
  }, [canCashout, currentMultiplier, activeBet, hasOpenBet, stake]);

  function handlePrimaryAction() {
    if (!session) {
      onBetClick?.("auth");
      return;
    }

    if (canCashout) {
      onBetClick?.("cashout", activeBet?.stake, side);
      return;
    }

    if (canPlaceBet) {
      onBetClick?.("bet", stake, side);
    }
  }

  return (
    <div className="bet-panel" data-side={side}>
      <div className="bet-panel__header">
        {side === "top" ? "Top (≥1.0x)" : "Bottom (<1.0x)"}
      </div>

      <div className="bet-panel__tabs">
        <button
          type="button"
          className={`bet-panel__tab ${activeTab === "bet" ? "bet-panel__tab--active" : ""}`}
          onClick={() => setActiveTab("bet")}
        >
          Bet
        </button>

        <button
          type="button"
          className={`bet-panel__tab ${activeTab === "auto" ? "bet-panel__tab--active" : ""}`}
          onClick={() => setActiveTab("auto")}
        >
          Auto
        </button>
      </div>

      <div className="bet-panel__stake-row">
        <button
          type="button"
          className="bet-panel__stake-btn"
          onClick={() => updateStake(-10)}
          disabled={hasOpenBet || isRising}
        >
          −
        </button>

        <div className="bet-panel__stake-display">{stake.toFixed(2)}</div>

        <button
          type="button"
          className="bet-panel__stake-btn"
          onClick={() => updateStake(10)}
          disabled={hasOpenBet || isRising}
        >
          +
        </button>
      </div>

      <div className="bet-panel__chips">
        {QUICK_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            className="bet-panel__chip"
            onClick={() => setQuickChip(chip)}
            disabled={hasOpenBet || isRising}
          >
            {chip.toLocaleString()}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`bet-panel__bet-btn ${canCashout ? "bet-panel__bet-btn--cashout" : ""}`}
        onClick={handlePrimaryAction}
        disabled={!canCashout && !canPlaceBet && !!session}
        aria-disabled={!canCashout && !canPlaceBet && !!session}
      >
        <span>{actionLabel}</span>
        <span>{actionAmount}</span>
      </button>
    </div>
  );
}
