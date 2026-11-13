import React, { useState, useEffect, useCallback, useRef } from 'react';
import { c, s, chatWallpaper, avatarColor } from '../styles.js';
import {
  getWhatsAppConversations,
  getWhatsAppMessages,
  sendWhatsAppMessage
} from '../api/api.js';

const POLL_MS = 6000;

function sessionStorage_getToken() {
  try { return sessionStorage.getItem('agentToken') || ''; } catch { return ''; }
}

function genTempId() {
  return `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

function statusLabel(status) {
  const norm = String(status || '').toLowerCase();
  if (norm === 'read' || norm === 'delivered') return <span style={{ color: c.readTick }}>{norm}</span>;
  if (norm === 'failed') return <span style={{ color: c.danger }}>failed</span>;
  return <span>{status}</span>;
}

export default function WhatsAppConversation() {
  const [token] = useState(sessionStorage_getToken());

  const [conversations, setConversations] = useState([]);
  const [search, setSearch] = useState('');
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef(null);
  const pendingTempIds = useRef(new Set()); // guards against a poll re-adding a message we already show optimistically

  const refreshConversations = useCallback(async () => {
    try {
      const res = await getWhatsAppConversations(token);
      setConversations(res.data);
    } catch (err) {
      // silent poll fail, same as AgentDashboard
    }
  }, [token]);

  useEffect(() => {
    refreshConversations();
    const interval = setInterval(refreshConversations, POLL_MS);
    return () => clearInterval(interval);
  }, [refreshConversations]);

  const refreshActiveMessages = useCallback(async () => {
    if (!activeConversationId) return;
    try {
      const res = await getWhatsAppMessages(token, activeConversationId);
      // don't stomp on messages still pending optimistic confirmation
      setMessages((prev) => {
        const stillPending = prev.filter(
          (m) => m.clientTempId && pendingTempIds.current.has(m.clientTempId)
        );
        return [...res.data, ...stillPending];
      });
    } catch (err) {
      // silent poll fail
    }
  }, [token, activeConversationId]);

  useEffect(() => {
    refreshActiveMessages();
    if (!activeConversationId) return;
    const interval = setInterval(refreshActiveMessages, POLL_MS);
    return () => clearInterval(interval);
  }, [activeConversationId, refreshActiveMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || !activeConversationId || sending) return;

    const clientTempId = genTempId();
    pendingTempIds.current.add(clientTempId);
    setSending(true);
    setDraft('');

    setMessages((prev) => [
      ...prev,
      {
        messageId: `optimistic_${clientTempId}`,
        conversationId: activeConversationId,
        direction: 'OUT',
        messageType: 'text',
        content: text,
        deliveryStatus: 'sending',
        clientTempId,
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      await sendWhatsAppMessage(token, activeConversationId, text, clientTempId);
      pendingTempIds.current.delete(clientTempId);
      refreshActiveMessages();
      refreshConversations();
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => (m.clientTempId === clientTempId ? { ...m, deliveryStatus: 'failed' } : m))
      );
    } finally {
      setSending(false);
    }
  }

  const visibleConversations = conversations.filter((cv) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (cv.CustomerMobile || '').toLowerCase().includes(q) ||
      (cv.CustomerName || '').toLowerCase().includes(q)
    );
  });

  const activeConversation = conversations.find((cv) => cv.ConversationId === activeConversationId);

  // Build rows with day dividers, same pattern as ChatWindow.
  const rows = [];
  let lastDay = null;
  messages.forEach((m, i) => {
    const day = dayLabel(m.createdAt);
    if (day && day !== lastDay) {
      rows.push({ kind: 'divider', key: `div-${i}`, label: day });
      lastDay = day;
    }
    rows.push({ kind: 'message', key: m.messageId || i, m });
  });

  return (
    <div style={{ display: 'flex', height: '100vh', background: c.bg }}>
      <style>{`
        .conv-row { transition: background 0.12s ease; }
        .conv-row:hover { background: #F3F6F8; }
        .conv-row.active:hover { background: ${c.primarySoft}; }
      `}</style>

      {/* Sidebar */}
      <div
        style={{
          width: 340,
          minWidth: 340,
          display: 'flex',
          flexDirection: 'column',
          background: c.card,
          borderRight: `1px solid ${c.border}`,
        }}
      >
        <div style={{ padding: '18px 18px 22px', ...s.headerGradient, color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'rgba(255,255,255,0.16)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
              }}
            >
              W
            </div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>WhatsApp Inbox</div>
          </div>

          <input
            style={{ ...s.input, marginTop: 14, background: 'rgba(255,255,255,0.94)', border: 'none' }}
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {visibleConversations.map((cv) => {
            const label = cv.CustomerName || cv.CustomerMobile;
            const isActive = cv.ConversationId === activeConversationId;
            return (
              <div
                key={cv.ConversationId}
                className={`conv-row${isActive ? ' active' : ''}`}
                onClick={() => setActiveConversationId(cv.ConversationId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  cursor: 'pointer',
                  borderLeft: isActive ? `3px solid ${c.accent}` : '3px solid transparent',
                  borderBottom: `1px solid ${c.border}`,
                  background: isActive ? c.primarySoft : 'transparent',
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    minWidth: 38,
                    borderRadius: '50%',
                    background: avatarColor(label),
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {(label || '#').slice(0, 1).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: c.ink, fontSize: 14 }}>{label}</div>
                  <div style={{ fontSize: 12, color: c.inkMuted, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {truncate(cv.LastMessageText, 30)}
                    </span>
                    {cv.UnreadCount > 0 && (
                      <span
                        style={{
                          background: c.accent,
                          color: '#fff',
                          borderRadius: 10,
                          padding: '0 6px',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {cv.UnreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: c.bg }}>
        {activeConversation ? (
          <>
            <div
              style={{
                padding: '14px 24px',
                borderBottom: `1px solid ${c.border}`,
                background: c.card,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: avatarColor(activeConversation.CustomerName || activeConversation.CustomerMobile),
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                }}
              >
                {(activeConversation.CustomerMobile || '#').slice(-2)}
              </div>
              <div>
                <div style={{ fontWeight: 700, color: c.ink }}>
                  {activeConversation.CustomerName || activeConversation.CustomerMobile}
                </div>
                <div style={{ fontSize: 12, color: c.inkMuted }}>{activeConversation.CustomerMobile}</div>
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 20px', ...chatWallpaper }}>
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

                const m = row.m;
                const isOut = m.direction === 'OUT';
                return (
                  <div
                    key={row.key}
                    style={{
                      display: 'flex',
                      justifyContent: isOut ? 'flex-end' : 'flex-start',
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        maxWidth: '65%',
                        padding: '9px 13px',
                        borderRadius: 14,
                        [isOut ? 'borderBottomRightRadius' : 'borderBottomLeftRadius']: 4,
                        fontSize: 14,
                        lineHeight: 1.4,
                        wordBreak: 'break-word',
                        background: isOut ? c.bubbleOutBg : c.bubbleInBg,
                        border: `1px solid ${isOut ? c.bubbleOutBorder : c.bubbleInBorder}`,
                        color: c.ink,
                        boxShadow: '0 1px 2px rgba(34,48,60,0.05)',
                      }}
                    >
                      {m.messageType === 'text' ? (
                        <div>{m.content}</div>
                      ) : m.mediaUrl ? (
                        <a href={m.mediaUrl} target="_blank" rel="noreferrer" style={{ color: c.primaryLine }}>
                          Download {m.messageType}
                        </a>
                      ) : (
                        <div>[{m.messageType}]</div>
                      )}
                      <div style={{ fontSize: 10.5, color: c.inkFaint, marginTop: 4, textAlign: 'right' }}>
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {isOut && <> · {statusLabel(m.deliveryStatus)}</>}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div style={{ display: 'flex', gap: 10, padding: '14px 20px', borderTop: `1px solid ${c.border}`, background: c.card }}>
              <input
                style={{ ...s.input, flex: 1, background: c.bg, borderRadius: 24 }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Type a message..."
                disabled={sending}
              />
              <button
                onClick={handleSend}
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
            </div>
          </>
        ) : (
          <div style={{ margin: 'auto', textAlign: 'center', color: c.inkFaint }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>💬</div>
            Select a conversation to view messages
          </div>
        )}
      </div>
    </div>
  );
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? `${str.slice(0, n)}…` : str;
}