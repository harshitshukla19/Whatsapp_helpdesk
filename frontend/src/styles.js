// styles.js
// Design direction: professional support console. Chrome is a deep, quiet
// blue-grey (slate, not "SaaS light-blue") so it reads as tooling rather than
// a marketing page. Warmth is spent in one place — a copper accent — for the
// moments that need a human touch: unread counts, active/selected states,
// the send action. The chat surface borrows WhatsApp's core legibility ideas
// (grouped-by-day bubbles, a textured wallpaper instead of flat white,
// recognizable read-ticks) without borrowing its green.

export const c = {
  // ---- ink (text) ----
  ink: '#222E38',          // primary text — warm-leaning charcoal, not pure black
  inkMuted: '#647486',      // secondary text, timestamps
  inkFaint: '#9AABB8',      // placeholders, disabled, faint icons
  inkOnPrimary: '#F3F6F8',

  // ---- surfaces ----
  bg: '#EEF2F5',            // app shell / sidebar background — cool slate-grey
  card: '#FFFFFF',
  chatBg: '#F4F1EB',        // chat canvas — warm parchment, WhatsApp-wallpaper cousin
  border: '#DEE6EC',
  borderStrong: '#C7D3DC',

  // ---- brand: deep blue-grey slate ----
  primary: '#33475A',
  primaryDark: '#22303C',
  primarySoft: '#E2E9EE',
  primaryLine: '#3E5772',   // mid-tone, used for gradients/hovers

  // ---- accent: warm copper (spend sparingly) ----
  accent: '#BE7B44',
  accentDark: '#9C6236',
  accentSoft: '#F3E5D4',

  // ---- semantic ----
  success: '#3FA66B',
  danger: '#C8503F',
  warning: '#C1793F',
  readTick: '#4FADE0',      // recognizable "read" blue, WhatsApp-style signal

  // ---- status badges ----
  statusOpen: '#3B72A6',
  statusInProgress: '#C1793F',
  statusResolved: '#3FA66B',
  statusClosed: '#8CA0AF',

  // ---- chat bubbles ----
  bubbleOutBg: '#FBEEDD',   // agent / self — warm cream, echoes the copper accent
  bubbleOutBorder: '#F0DCBC',
  bubbleInBg: '#FFFFFF',
  bubbleInBorder: '#E4EAEE',

  // ---- avatar palette (rotated by name hash, WhatsApp-style variety) ----
  avatarPalette: [
    '#33475A', '#BE7B44', '#3FA66B', '#4FADE0',
    '#8B5FBF', '#C8503F', '#5C7A99', '#A98A4E',
  ],
};

// Back-compat aliases for files not touched in this pass (e.g. AgentDashboard.jsx)
c.text = c.ink;
c.textMuted = c.inkMuted;
c.textOnPrimary = c.inkOnPrimary;
c.primaryLight = c.primarySoft;

// Subtle repeating texture for the chat canvas — reads as a wallpaper, not
// decoration. Kept at low opacity so it never competes with message content.
export const chatWallpaper = {
  backgroundColor: c.chatBg,
  backgroundImage: `radial-gradient(${c.borderStrong}55 1px, transparent 1px)`,
  backgroundSize: '18px 18px',
};

export const s = {
  page: {
    minHeight: '100vh',
    background: c.bg,
    color: c.ink,
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },

  card: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 14,
    boxShadow: '0 4px 18px rgba(34, 48, 60, 0.06)',
  },

  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 14px',
    borderRadius: 10,
    border: `1px solid ${c.border}`,
    background: c.card,
    color: c.ink,
    fontSize: 14,
    outline: 'none',
  },

  button: {
    padding: '10px 16px',
    borderRadius: 10,
    border: 'none',
    background: c.primary,
    color: c.inkOnPrimary,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },

  buttonAccent: {
    padding: '10px 16px',
    borderRadius: 10,
    border: 'none',
    background: c.accent,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },

  buttonGhost: {
    padding: '10px 16px',
    borderRadius: 10,
    border: `1px solid ${c.border}`,
    background: c.card,
    color: c.primary,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },

  headerGradient: {
    background: `linear-gradient(135deg, ${c.primaryLine} 0%, ${c.primaryDark} 100%)`,
  },
};

// Deterministic avatar color from a name/mobile string, so the same person
// always gets the same color (WhatsApp does this too — it aids recognition).
export function avatarColor(label = '') {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return c.avatarPalette[hash % c.avatarPalette.length];
}