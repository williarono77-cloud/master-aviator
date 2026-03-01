/**
 * localStorage helpers for persisting UI toggles (sound, music, animation).
 */

const PREFIX = 'aviator_'

export function getToggle(key) {
  try {
    const val = localStorage.getItem(PREFIX + key)
    if (val === 'true' || val === 'false') {
      return val === 'true'
    }
    return val || false
  } catch {
    return false
  }
}

export function setToggle(key, value) {
  try {
    localStorage.setItem(PREFIX + key, String(value))
  } catch {
    // Ignore localStorage errors
  }
}

export function getStake(key) {
  try {
    const val = localStorage.getItem(PREFIX + 'stake_' + key)
    return val ? Number(val) : null
  } catch {
    return null
  }
}

export function setStake(key, value) {
  try {
    localStorage.setItem(PREFIX + 'stake_' + key, String(value))
  } catch {
    // Ignore localStorage errors
  }
}
