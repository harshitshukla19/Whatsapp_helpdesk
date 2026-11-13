import React from 'react';
import { c, avatarColor } from '../styles.js';

function initials(label = '') {
  return (
    label
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '#'
  );
}

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function TicketList({ tickets, activeTicketId, onSelect }) {
  if (!tickets || tickets.length === 0) {
    return (
      <div style={{ padding: 24, color: c.inkFaint, fontSize: 13, textAlign: 'center' }}>
        No tickets to show.
      </div>
    );
  }

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <style>{`
        .ticket-row { transition: background 0.12s ease; }
        .ticket-row:hover { background: #F3F6F8; }
        .ticket-row.active:hover { background: ${c.primarySoft}; }
      `}</style>

      {tickets.map((t) => {
        const isActive = t.TicketID === activeTicketId;
        const label = t.CustomerName || t.MobileNumber || t.TicketID;
        const avatarBg = avatarColor(label);

        return (
          <div
            key={t.TicketID}
            className={`ticket-row${isActive ? ' active' : ''}`}
            onClick={() => onSelect(t.TicketID)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              cursor: 'pointer',
              background: isActive ? c.primarySoft : 'transparent',
              borderLeft: isActive ? `3px solid ${c.accent}` : '3px solid transparent',
              borderBottom: `1px solid ${c.border}`,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                minWidth: 42,
                borderRadius: '50%',
                background: avatarBg,
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {initials(label)}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <div
                  style={{
                    fontWeight: isActive ? 700 : 600,
                    fontSize: 14,
                    color: c.ink,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </div>
                <div style={{ fontSize: 11, color: c.inkFaint, whiteSpace: 'nowrap' }}>
                  {formatTime(t.UpdatedAt || t.LastMessageAt)}
                </div>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: c.inkMuted,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.TicketID} · {t.Subject || 'No subject'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}