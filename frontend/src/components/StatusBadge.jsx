import React from 'react';
import { c } from '../styles.js';

const STATUS_STYLES = {
  Open: { fg: c.statusOpen, dot: c.statusOpen },
  InProgress: { fg: c.statusInProgress, dot: c.statusInProgress },
  Resolved: { fg: c.statusResolved, dot: c.statusResolved },
  Closed: { fg: c.statusClosed, dot: c.statusClosed },
};

export default function StatusBadge({ status }) {
  const st = STATUS_STYLES[status] || STATUS_STYLES.Closed;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        background: c.card,
        border: `1px solid ${st.fg}33`,
        color: st.fg,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: st.dot,
        }}
      />
      {status}
    </span>
  );
}