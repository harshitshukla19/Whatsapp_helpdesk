import React, { useState, useEffect, useCallback, useRef } from 'react';
import { c, s } from '../styles.js';
import ChatWindow from '../components/ChatWindow.jsx';
import TicketList from '../components/TicketList.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import {
  getAllTickets,
  getTicketThreadInternal,
  addAgentMessage,
  updateTicketStatus,
  startNewConversation
} from '../api/api.js';

const POLL_MS = 6000;
const STATUS_OPTIONS = ['Open', 'InProgress', 'Resolved', 'Closed'];

function genTempId() {
  return `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function AgentDashboard() {
  const [token] = useState(sessionStorage_getToken());

  const [tickets, setTickets] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [activeTicketId, setActiveTicketId] = useState(null);
  const [activeTicket, setActiveTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [replyError, setReplyError] = useState('');

  // Tracks reply messages we've echoed locally but the server hasn't
  // confirmed writing yet — keeps them on screen (with the browser's own
  // timestamp) across the 6s poll instead of letting the poll wipe them.
  const pendingTempIds = useRef(new Set());

  const [showNewMsg, setShowNewMsg] = useState(false);
  const [newMobile, setNewMobile] = useState('');
  const [newName, setNewName] = useState('');
  const [newText, setNewText] = useState('');
  const [newMsgError, setNewMsgError] = useState('');
  const [sendingNew, setSendingNew] = useState(false);
  // NOTE: sessionStorage is used here only for this demo dashboard's auth token,
  // not for chat state - fine for a localhost starter project.
  function sessionStorage_getToken() {
    try { return sessionStorage.getItem('agentToken') || ''; } catch { return ''; }
  }

  const refreshTickets = useCallback(async () => {
    try {
      const res = await getAllTickets(token, statusFilter || undefined);
      setTickets(res.data);
    } catch (err) {
      // silent poll fail
    }
  }, [token, statusFilter]);

  useEffect(() => {
    refreshTickets();
    const interval = setInterval(refreshTickets, POLL_MS);
    return () => clearInterval(interval);
  }, [refreshTickets]);

  const refreshActiveThread = useCallback(async () => {
    if (!activeTicketId) return;
    try {
      const res = await getTicketThreadInternal(token, activeTicketId);
      setActiveTicket(res.data.ticket);
      // Keep any reply we've echoed locally that the server hasn't
      // confirmed yet, so it doesn't flicker out during the poll.
      setMessages((prev) => {
        const stillPending = prev.filter(
          (m) => m.clientTempId && pendingTempIds.current.has(m.clientTempId)
        );
        return [...res.data.messages, ...stillPending];
      });
    } catch (err) {
      // silent poll fail
    }
  }, [token, activeTicketId]);

  useEffect(() => {
    // Switching tickets — any pending echo from the previous thread no
    // longer applies here.
    pendingTempIds.current.clear();
    refreshActiveThread();
    if (!activeTicketId) return;
    const interval = setInterval(refreshActiveThread, POLL_MS);
    return () => clearInterval(interval);
  }, [activeTicketId, refreshActiveThread]);

  async function handleSendReply(text) {
    setReplyError('');

    const clientTempId = genTempId();
    pendingTempIds.current.add(clientTempId);

    // Echo immediately using the browser's own clock — this is the
    // timestamp the agent sees, not whatever the server returns later.
    setMessages((prev) => [
      ...prev,
      {
        MessageID: `optimistic_${clientTempId}`,
        SenderType: 'Agent',
        SenderName: null,
        MessageText: text,
        MessageType: 'text',
        MediaURL: null,
        DeliveryStatus: 'sending',
        CreatedAt: new Date().toISOString(),
        clientTempId,
      },
    ]);

    try {
      const res = await addAgentMessage(token, activeTicketId, text);
      if (res.sendFailed) {
        setReplyError('Message saved, but WhatsApp delivery failed — the customer may be outside the 24h reply window.');
        setMessages((prev) =>
          prev.map((m) => (m.clientTempId === clientTempId ? { ...m, DeliveryStatus: 'Failed' } : m))
        );
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.clientTempId === clientTempId ? { ...m, DeliveryStatus: 'Sent' } : m))
        );
      }
    } catch (err) {
      setReplyError(err.message || 'Failed to send message');
      setMessages((prev) =>
        prev.map((m) => (m.clientTempId === clientTempId ? { ...m, DeliveryStatus: 'Failed' } : m))
      );
    } finally {
      pendingTempIds.current.delete(clientTempId);
    }
    refreshActiveThread();
  }

  async function handleStartConversation(e) {
    e.preventDefault();
    if (!newMobile.trim() || !newText.trim() || sendingNew) return;
    setNewMsgError('');
    setSendingNew(true);
    try {
      const res = await startNewConversation(token, {
        mobileNumber: newMobile.trim(),
        customerName: newName.trim() || undefined,
        message: newText.trim()
      });
      if (res.data.sendFailed) {
        setNewMsgError('Ticket created, but WhatsApp send failed — likely outside the 24h reply window for this number.');
      } else {
        setShowNewMsg(false);
      }
      setNewMobile('');
      setNewName('');
      setNewText('');
      await refreshTickets();
      setActiveTicketId(res.data.ticketId);
    } catch (err) {
      setNewMsgError(err.message || 'Failed to start conversation');
    } finally {
      setSendingNew(false);
    }
  }

  async function handleStatusChange(newStatus) {
    await updateTicketStatus(token, activeTicketId, newStatus);
    refreshActiveThread();
    refreshTickets();
  }

  const visibleTickets = tickets.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (t.TicketID || '').toLowerCase().includes(q) ||
      (t.MobileNumber || '').toLowerCase().includes(q) ||
      (t.Subject || '').toLowerCase().includes(q)
    );
  });

  // ---------- MAIN DASHBOARD ----------
  return (
    <div style={{ display: 'flex', height: '100vh', background: c.bg }}>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
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
                S
              </div>
              <div style={{ fontWeight: 700, fontSize: 17 }}>Support Inbox</div>
            </div>
            <button
              type="button"
              onClick={() => { setShowNewMsg((v) => !v); setNewMsgError(''); }}
              style={{
                background: 'rgba(255,255,255,0.16)',
                border: 'none',
                color: '#fff',
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {showNewMsg ? 'Cancel' : '+ New'}
            </button>
          </div>

          {showNewMsg ? (
            <form onSubmit={handleStartConversation} style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                style={{ ...s.input, background: 'rgba(255,255,255,0.94)', border: 'none' }}
                placeholder="Mobile number (e.g. 919999999999)"
                value={newMobile}
                onChange={(e) => setNewMobile(e.target.value)}
              />
              <input
                style={{ ...s.input, background: 'rgba(255,255,255,0.94)', border: 'none' }}
                placeholder="Customer name (optional)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <textarea
                style={{ ...s.input, background: 'rgba(255,255,255,0.94)', border: 'none', minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }}
                placeholder="Message"
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
              />
              {newMsgError && (
                <div style={{ fontSize: 12, color: c.accentSoft, background: 'rgba(0,0,0,0.18)', padding: '6px 8px', borderRadius: 6 }}>
                  {newMsgError}
                </div>
              )}
              <button
                type="submit"
                disabled={sendingNew || !newMobile.trim() || !newText.trim()}
                style={{ ...s.buttonAccent, opacity: sendingNew || !newMobile.trim() || !newText.trim() ? 0.6 : 1 }}
              >
                {sendingNew ? 'Sending...' : 'Send'}
              </button>
            </form>
          ) : (
            <input
              style={{ ...s.input, marginTop: 14, background: 'rgba(255,255,255,0.94)', border: 'none' }}
              placeholder="Search tickets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
        </div>

        {/* Status filter row */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${c.border}` }}>
          <select style={s.input} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <TicketList tickets={visibleTickets} activeTicketId={activeTicketId} onSelect={setActiveTicketId} />
        </div>
      </div>

      {/* Main panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: c.bg }}>
        {activeTicket ? (
          <>
            <div
              style={{
                padding: '16px 24px',
                borderBottom: `1px solid ${c.border}`,
                background: c.card,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: c.primarySoft,
                    color: c.primaryDark,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                  }}
                >
                  {activeTicket.MobileNumber ? activeTicket.MobileNumber.slice(-2) : '#'}
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: c.text }}>
                    {activeTicket.CustomerName || activeTicket.MobileNumber}
                  </div>
                  <div style={{ fontSize: 12, color: c.textMuted }}>
                    {activeTicket.TicketID} · {activeTicket.Subject || 'No subject'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <StatusBadge status={activeTicket.Status} />
                <select
                  style={{ ...s.input, width: 150 }}
                  value={activeTicket.Status}
                  onChange={(e) => handleStatusChange(e.target.value)}
                >
                  {STATUS_OPTIONS.map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ChatWindow
                messages={messages}
                onSend={handleSendReply}
                selfSenderType="Agent"
                placeholder="Reply to customer..."
                sendError={replyError}
              />
            </div>
          </>
        ) : (
          <div style={{ margin: 'auto', textAlign: 'center', color: c.textMuted }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>💬</div>
            Select a ticket to view the conversation
          </div>
        )}
      </div>
    </div>
  );
}