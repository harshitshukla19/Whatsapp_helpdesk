import React, { useState, useRef, useEffect } from 'react';
import { c, s, chatWallpaper } from '../styles.js';

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function statusTick(status) {
  if (!status) return null;
  const norm = String(status).toLowerCase();
  const map = { sent: '✓', delivered: '✓✓', read: '✓✓', failed: '⚠' };
  const color = norm === 'read' ? c.readTick : norm === 'failed' ? c.danger : 'inherit';
  return <span style={{ color, marginLeft: 4 }}>{map[norm] || status}</span>;
}

// Field names match the actual TicketMessages columns:
// MessageID, SenderType, SenderName, MessageText, MessageType, MediaURL,
// WaMessageId, DeliveryStatus, CreatedAt
function MessageBody({ m }) {
  const type = m.MessageType || 'text';
  const text = m.MessageText || '';

  if (type === 'image' && m.MediaURL) {
    return (
      <div>
        <img src={m.MediaURL} alt="attachment" style={{ maxWidth: 240, borderRadius: 8, display: 'block' }} />
        {text && <div style={{ marginTop: 6 }}>{text}</div>}
      </div>
    );
  }

  if (type === 'video' && m.MediaURL) {
    return (
      <div>
        <video src={m.MediaURL} controls style={{ maxWidth: 240, borderRadius: 8, display: 'block' }} />
        {text && <div style={{ marginTop: 6 }}>{text}</div>}
      </div>
    );
  }

  if (type === 'audio' && m.MediaURL) {
    return <audio src={m.MediaURL} controls style={{ maxWidth: 240 }} />;
  }

  if (type === 'document' && m.MediaURL) {
    return (
      <a href={m.MediaURL} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'inherit' }}>
        📄 {text || 'View document'}
      </a>
    );
  }

  return <span>{text}</span>;
}

// A message bubble with a small directional tail, like a native chat app.
function Bubble({ m, isSelf, showTail }) {
  const bg = isSelf ? c.bubbleOutBg : c.bubbleInBg;
  const border = isSelf ? c.bubbleOutBorder : c.bubbleInBorder;

  return (
    <div style={{ position: 'relative', maxWidth: '62%' }}>
      <div
        style={{
          padding: '9px 13px',
          borderRadius: 14,
          [isSelf ? 'borderBottomRightRadius' : 'borderBottomLeftRadius']: showTail ? 3 : 14,
          fontSize: 14,
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
          background: bg,
          color: c.ink,
          border: `1px solid ${border}`,
          boxShadow: '0 1px 2px rgba(34,48,60,0.05)',
        }}
      >
        {!isSelf && m.SenderName && (
          <div style={{ fontSize: 11.5, fontWeight: 700, color: c.primaryLine, marginBottom: 2 }}>
            {m.SenderName}
          </div>
        )}
        <MessageBody m={m} />
      </div>

      {showTail && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            width: 8,
            height: 9,
            background: bg,
            borderRight: !isSelf ? `1px solid ${border}` : 'none',
            borderBottom: !isSelf ? `1px solid ${border}` : `1px solid ${border}`,
            borderLeft: isSelf ? `1px solid ${border}` : 'none',
            [isSelf ? 'right' : 'left']: -4,
            clipPath: isSelf
              ? 'polygon(0 0, 100% 0, 0 100%)'
              : 'polygon(100% 0, 0 0, 100% 100%)',
          }}
        />
      )}
    </div>
  );
}

export default function ChatWindow({ messages, onSend, selfSenderType, placeholder, sendError }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSend(text);
      setDraft('');
    } finally {
      setSending(false);
    }
  }

  // Group messages by calendar day, and mark the last message in each
  // same-sender run so only that bubble gets a tail (keeps consecutive
  // messages visually clustered, like WhatsApp/iMessage).
  const rows = [];
  if (messages) {
    let lastDay = null;
    messages.forEach((m, i) => {
      const day = dayLabel(m.CreatedAt);
      if (day && day !== lastDay) {
        rows.push({ kind: 'divider', key: `div-${i}`, label: day });
        lastDay = day;
      }
      const next = messages[i + 1];
      const sameNext = next && next.SenderType === m.SenderType && dayLabel(next.CreatedAt) === day;
      rows.push({ kind: 'message', key: m.MessageID || i, m, showTail: !sameNext });
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px', ...chatWallpaper }}>
        {(!messages || messages.length === 0) && (
          <div style={{ margin: 'auto', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.inkFaint, fontSize: 13 }}>
            No messages yet
          </div>
        )}

        {rows.map((row) => {
          if (row.kind === 'divider') {
            return (
              <div key={row.key} style={{ display: 'flex', justifyContent: 'center', margin: '14px 0' }}>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: c.inkMuted,
                    background: c.card,
                    border: `1px solid ${c.border}`,
                    padding: '3px 12px',
                    borderRadius: 999,
                  }}
                >
                  {row.label}
                </span>
              </div>
            );
          }

          const { m, showTail } = row;
          const isSelf = m.SenderType === selfSenderType;
          return (
            <div
              key={row.key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isSelf ? 'flex-end' : 'flex-start',
                marginTop: 2,
                marginBottom: showTail ? 10 : 2,
              }}
            >
              <Bubble m={m} isSelf={isSelf} showTail={showTail} />
              {showTail && (
                <div style={{ fontSize: 10.5, color: c.inkFaint, marginTop: 3, padding: '0 4px' }}>
                  {formatTime(m.CreatedAt)}
                  {isSelf && statusTick(m.DeliveryStatus)}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {sendError && (
        <div
          style={{
            margin: '0 20px',
            padding: '8px 12px',
            background: c.accentSoft,
            color: c.accentDark,
            border: `1px solid ${c.accent}55`,
            borderRadius: 8,
            fontSize: 12.5,
          }}
        >
          ⚠ {sendError}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 20px',
          borderTop: `1px solid ${c.border}`,
          background: c.card,
        }}
      >
        <input
          style={{ ...s.input, flex: 1, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 24 }}
          placeholder={placeholder || 'Write a message...'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          style={{
            ...s.buttonAccent,
            width: 42,
            height: 42,
            padding: 0,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: sending || !draft.trim() ? 0.6 : 1,
          }}
          aria-label="Send"
        >
          ➤
        </button>
      </form>
    </div>
  );
}