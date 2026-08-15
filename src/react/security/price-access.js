export const PRICE_EDITOR_SESSION_KEY = 'eft-price-editor-unlocked';

const PRICE_EDITOR_PASSCODE = '1455';

export function verifyPricePasscode(value) {
  return String(value ?? '').trim() === PRICE_EDITOR_PASSCODE;
}

export function isPriceEditorUnlocked() {
  try {
    return sessionStorage.getItem(PRICE_EDITOR_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPriceEditorUnlocked(unlocked) {
  try {
    if (unlocked) sessionStorage.setItem(PRICE_EDITOR_SESSION_KEY, '1');
    else sessionStorage.removeItem(PRICE_EDITOR_SESSION_KEY);
  } catch {
    // The editor stays locked when session storage is unavailable.
  }
}
