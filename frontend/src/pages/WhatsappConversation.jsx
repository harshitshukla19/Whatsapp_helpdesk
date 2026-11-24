import React, { useState, useEffect, useCallback, useRef } from 'react';
import { c, s, chatWallpaper, avatarColor } from '../styles.js';
import {
  getWhatsAppConversations,
  getWhatsAppMessages,
  sendWhatsAppMessage,
  initiateWhatsAppConversation,
  getWhatsAppTemplates,
  uploadMedia,
  compressImageIfNeeded,
  deleteWhatsAppConversation,
  deleteWhatsAppMessage,
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

function statusLabel(status, failureReason) {
  const norm = String(status || '').toLowerCase();
  if (norm === 'read') return <span style={{ color: c.readTick }} title="Read by customer">✓✓ read</span>;
  if (norm === 'delivered') return <span style={{ color: c.readTick }} title="Delivered to customer">✓✓ delivered</span>;
  if (norm === 'sent') return <span style={{ color: c.inkMuted }} title="Sent to WhatsApp">✓ sent</span>;
  if (norm === 'sending') return <span style={{ color: c.inkFaint }}>⏱ sending...</span>;
  if (norm === 'failed') {
    return (
      <span style={{ color: c.danger }} title={failureReason || 'Failed to send'}>
        ⚠ failed {failureReason ? `(${failureReason})` : ''}
      </span>
    );
  }
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
  const [isWindowOpen, setIsWindowOpen] = useState(false);
  const [actionError, setActionError] = useState('');

  // Available templates
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // WhatsApp Attachment & Action State
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null); // { type: 'conversation'|'message', id, subId, title }

  // Location Form
  const [locName, setLocName] = useState('');
  const [locAddress, setLocAddress] = useState('');
  const [locLat, setLocLat] = useState('');
  const [locLng, setLocLng] = useState('');
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState('');

  // Contact Form
  const [conName, setConName] = useState('');
  const [conPhone, setConPhone] = useState('');
  const [conOrg, setConOrg] = useState('');
  const [conEmail, setConEmail] = useState('');
  const [conError, setConError] = useState('');

  // Attachment State for active conversation
  const [selectedAttachment, setSelectedAttachment] = useState(null); // { file, previewUrl, mediaType, fileName, base64 }
  const photoInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const documentInputRef = useRef(null);
  const attachmentMenuRef = useRef(null);

  // "+ New Chat" Modal State
  const [showNewModal, setShowNewModal] = useState(false);
  const [newMobile, setNewMobile] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('text'); // 'text' | 'template' | 'location' | 'contact'
  const [newTemplate, setNewTemplate] = useState('');
  const [newText, setNewText] = useState('');
  const [newModalError, setNewModalError] = useState('');
  const [initiating, setInitiating] = useState(false);
  const [newAttachment, setNewAttachment] = useState(null);
  const modalPhotoInputRef = useRef(null);
  const modalVideoInputRef = useRef(null);
  const modalDocumentInputRef = useRef(null);

  const messagesEndRef = useRef(null);
  const pendingTempIds = useRef(new Set());

  // Close attachment menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (attachmentMenuRef.current && !attachmentMenuRef.current.contains(e.target)) {
        setShowAttachmentMenu(false);
      }
    }
    if (showAttachmentMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showAttachmentMenu]);

  // Clean up object URLs
  useEffect(() => {
    return () => {
      if (selectedAttachment?.previewUrl) URL.revokeObjectURL(selectedAttachment.previewUrl);
      if (newAttachment?.previewUrl) URL.revokeObjectURL(newAttachment.previewUrl);
    };
  }, [selectedAttachment, newAttachment]);

  async function handleFileSelect(e, forceType) {
    let file = e.target.files?.[0];
    if (!file) return;

    let mediaType = forceType;
    if (!mediaType) {
      if (file.type.startsWith('video/')) mediaType = 'video';
      else if (file.type.startsWith('image/')) mediaType = 'image';
      else mediaType = 'document';
    }

    if (mediaType === 'image') {
      try {
        file = await compressImageIfNeeded(file);
      } catch (err) {
        console.warn('Image optimization skipped:', err);
      }
    }

    setActionError('');
    const previewUrl = URL.createObjectURL(file);

    const reader = new FileReader();
    reader.onload = () => {
      setSelectedAttachment({
        file,
        previewUrl,
        mediaType,
        fileName: file.name,
        base64: reader.result,
      });
    };
    reader.onerror = () => {
      setActionError('Failed to read file');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleRemoveAttachment() {
    if (selectedAttachment?.previewUrl) {
      URL.revokeObjectURL(selectedAttachment.previewUrl);
    }
    setSelectedAttachment(null);
  }

  async function handleModalFileSelect(e, forceType) {
    let file = e.target.files?.[0];
    if (!file) return;

    let mediaType = forceType;
    if (!mediaType) {
      if (file.type.startsWith('video/')) mediaType = 'video';
      else if (file.type.startsWith('image/')) mediaType = 'image';
      else mediaType = 'document';
    }

    if (mediaType === 'image') {
      try {
        file = await compressImageIfNeeded(file);
      } catch (err) {
        console.warn('Image optimization skipped:', err);
      }
    }

    setNewModalError('');
    const previewUrl = URL.createObjectURL(file);

    const reader = new FileReader();
    reader.onload = () => {
      setNewAttachment({
        file,
        previewUrl,
        mediaType,
        fileName: file.name,
        base64: reader.result,
      });
    };
    reader.onerror = () => {
      setNewModalError('Failed to read file');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleModalRemoveAttachment() {
    if (newAttachment?.previewUrl) {
      URL.revokeObjectURL(newAttachment.previewUrl);
    }
    setNewAttachment(null);
  }

  // Load templates on mount
  useEffect(() => {
    getWhatsAppTemplates(token)
      .then((res) => {
        const list = res.data || [];
        setTemplates(list);
        if (list.length > 0) {
          setNewTemplate(list[0].templateName || '');
          setSelectedTemplate(list[0].templateName || '');
        }
      })
      .catch((err) => console.warn('Could not load WhatsApp templates:', err.message));
  }, [token]);

  const refreshConversations = useCallback(async () => {
    try {
      const res = await getWhatsAppConversations(token);
      setConversations(res.data || []);
    } catch (err) {
      // silent poll fail
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
      setIsWindowOpen(!!res.isWindowOpen);
      setMessages((prev) => {
        const stillPending = prev.filter(
          (m) => m.clientTempId && pendingTempIds.current.has(m.clientTempId)
        );
        return [...(res.data || []), ...stillPending];
      });
    } catch (err) {
      // silent poll fail
    }
  }, [token, activeConversationId]);

  useEffect(() => {
    pendingTempIds.current.clear();
    setActionError('');
    refreshActiveMessages();
    if (!activeConversationId) return;
    const interval = setInterval(refreshActiveMessages, POLL_MS);
    return () => clearInterval(interval);
  }, [activeConversationId, refreshActiveMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send message in existing conversation
  async function handleSend(customPayload = null) {
    const text = (customPayload?.text !== undefined ? customPayload.text : draft).trim();
    const templateName = customPayload?.templateName;
    const attachmentToSend = customPayload?.attachment !== undefined ? customPayload.attachment : selectedAttachment;

    if ((!text && !templateName && !attachmentToSend) || !activeConversationId || sending) return;

    setActionError('');
    const clientTempId = genTempId();
    pendingTempIds.current.add(clientTempId);
    setSending(true);
    if (!customPayload) {
      setDraft('');
      handleRemoveAttachment();
    }
    setShowTemplatePicker(false);

    let mediaUrl = null;
    let mediaType = 'text';

    if (attachmentToSend) {
      mediaType = attachmentToSend.mediaType || 'image';
      try {
        const uploadRes = await uploadMedia(token, {
          base64: attachmentToSend.base64,
          fileName: attachmentToSend.fileName,
          mimeType: attachmentToSend.file.type,
        });
        if (!uploadRes.url) {
          throw new Error(uploadRes.message || 'Media upload failed');
        }
        mediaUrl = uploadRes.url;
        mediaType = uploadRes.mediaType || mediaType;
      } catch (err) {
        setActionError(err.message || 'Failed to upload media');
        setSending(false);
        pendingTempIds.current.delete(clientTempId);
        return;
      }
    }

    const optimisticContent = templateName
      ? `[Template: ${templateName}] ${text}`.trim()
      : (text || (mediaUrl ? `[Media: ${mediaType}]` : ''));

    setMessages((prev) => [
      ...prev,
      {
        messageId: `optimistic_${clientTempId}`,
        conversationId: activeConversationId,
        direction: 'OUT',
        messageType: templateName ? 'template' : (mediaUrl ? mediaType : 'text'),
        content: optimisticContent,
        mediaUrl: mediaUrl || attachmentToSend?.previewUrl || null,
        deliveryStatus: 'sending',
        clientTempId,
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      const sendBody = templateName
        ? { templateName, text: text || undefined, clientTempId }
        : { text: text || undefined, mediaUrl, mediaType, clientTempId };

      const res = await sendWhatsAppMessage(token, activeConversationId, sendBody, clientTempId);

      if (res.sendFailed) {
        setActionError(
          res.error ||
          'Message dispatch failed. Customer may be outside the 24-hour reply window. Try sending an approved template.'
        );
        setMessages((prev) =>
          prev.map((m) =>
            m.clientTempId === clientTempId
              ? { ...m, deliveryStatus: 'failed', failureReason: res.error || 'Outside 24h window' }
              : m
          )
        );
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.clientTempId === clientTempId ? { ...m, deliveryStatus: 'sent', mediaUrl: mediaUrl || m.mediaUrl } : m))
        );
      }

      pendingTempIds.current.delete(clientTempId);
      refreshActiveMessages();
      refreshConversations();
    } catch (err) {
      setActionError(err.message || 'Failed to send message');
      setMessages((prev) =>
        prev.map((m) =>
          m.clientTempId === clientTempId
            ? { ...m, deliveryStatus: 'failed', failureReason: err.message }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  }

  // Geolocation lookup
  function handleGetGeoLocation() {
    if (!navigator.geolocation) {
      setLocError('Geolocation is not supported by your browser');
      return;
    }
    setLocLoading(true);
    setLocError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocLat(pos.coords.latitude.toFixed(6));
        setLocLng(pos.coords.longitude.toFixed(6));
        if (!locName) setLocName('Current Location');
        setLocLoading(false);
      },
      (err) => {
        setLocError(err.message || 'Unable to retrieve location');
        setLocLoading(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  // Send Location message in active conversation
  async function handleSendLocation(e) {
    if (e) e.preventDefault();
    if (!locLat || !locLng) {
      setLocError('Latitude and Longitude are required');
      return;
    }
    const locObj = {
      name: locName.trim() || 'Shared Location',
      address: locAddress.trim() || undefined,
      latitude: locLat.trim(),
      longitude: locLng.trim(),
    };
    setShowLocationModal(false);
    setLocName('');
    setLocAddress('');
    setLocLat('');
    setLocLng('');
    setLocError('');

    setActionError('');
    const clientTempId = genTempId();
    pendingTempIds.current.add(clientTempId);
    setSending(true);

    const mapsUrl = `https://maps.google.com/?q=${locObj.latitude},${locObj.longitude}`;

    setMessages((prev) => [
      ...prev,
      {
        messageId: `optimistic_${clientTempId}`,
        conversationId: activeConversationId,
        direction: 'OUT',
        messageType: 'location',
        content: JSON.stringify(locObj),
        mediaUrl: mapsUrl,
        deliveryStatus: 'sending',
        clientTempId,
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      const res = await sendWhatsAppMessage(token, activeConversationId, {
        location: locObj,
        clientTempId,
      });

      if (res.sendFailed) {
        setActionError(res.error || 'Failed to dispatch location message');
        setMessages((prev) =>
          prev.map((m) =>
            m.clientTempId === clientTempId
              ? { ...m, deliveryStatus: 'failed', failureReason: res.error }
              : m
          )
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.clientTempId === clientTempId
              ? { ...m, deliveryStatus: 'sent' }
              : m
          )
        );
      }
      pendingTempIds.current.delete(clientTempId);
      refreshActiveMessages();
      refreshConversations();
    } catch (err) {
      setActionError(err.message || 'Failed to send location');
      setMessages((prev) =>
        prev.map((m) =>
          m.clientTempId === clientTempId
            ? { ...m, deliveryStatus: 'failed', failureReason: err.message }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  }

  // Send Contact message in active conversation
  async function handleSendContact(e) {
    if (e) e.preventDefault();
    if (!conName.trim() || !conPhone.trim()) {
      setConError('Contact Name and Phone Number are required');
      return;
    }
    const conObj = {
      name: conName.trim(),
      phone: conPhone.trim(),
      organization: conOrg.trim() || undefined,
      email: conEmail.trim() || undefined,
    };
    setShowContactModal(false);
    setConName('');
    setConPhone('');
    setConOrg('');
    setConEmail('');
    setConError('');

    setActionError('');
    const clientTempId = genTempId();
    pendingTempIds.current.add(clientTempId);
    setSending(true);

    setMessages((prev) => [
      ...prev,
      {
        messageId: `optimistic_${clientTempId}`,
        conversationId: activeConversationId,
        direction: 'OUT',
        messageType: 'contact',
        content: JSON.stringify(conObj),
        mediaUrl: `tel:${conObj.phone}`,
        deliveryStatus: 'sending',
        clientTempId,
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      const res = await sendWhatsAppMessage(token, activeConversationId, {
        contact: conObj,
        clientTempId,
      });

      if (res.sendFailed) {
        setActionError(res.error || 'Failed to dispatch contact message');
        setMessages((prev) =>
          prev.map((m) =>
            m.clientTempId === clientTempId
              ? { ...m, deliveryStatus: 'failed', failureReason: res.error }
              : m
          )
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.clientTempId === clientTempId
              ? { ...m, deliveryStatus: 'sent' }
              : m
          )
        );
      }
      pendingTempIds.current.delete(clientTempId);
      refreshActiveMessages();
      refreshConversations();
    } catch (err) {
      setActionError(err.message || 'Failed to send contact');
      setMessages((prev) =>
        prev.map((m) =>
          m.clientTempId === clientTempId
            ? { ...m, deliveryStatus: 'failed', failureReason: err.message }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  }

  // Delete conversation or message
  async function handleConfirmDelete() {
    if (!showDeleteConfirm) return;
    const { type, id, subId } = showDeleteConfirm;
    setShowDeleteConfirm(null);

    if (type === 'conversation') {
      try {
        await deleteWhatsAppConversation(token, id);
        setConversations((prev) => prev.filter((cv) => cv.ConversationId !== id));
        if (activeConversationId === id) {
          setActiveConversationId(null);
          setMessages([]);
        }
      } catch (err) {
        setActionError(err.message || 'Failed to delete conversation');
      }
    } else if (type === 'message') {
      try {
        await deleteWhatsAppMessage(token, id, subId);
        setMessages((prev) => prev.filter((m) => m.messageId !== subId));
      } catch (err) {
        setActionError(err.message || 'Failed to delete message');
      }
    }
  }

  // Initiate new conversation to an individual / selected person
  async function handleInitiate(e) {
    e.preventDefault();
    if (!newMobile.trim() || initiating) return;
    if (newType === 'text' && !newText.trim() && !newAttachment) {
      setNewModalError('Message text or photo/video attachment is required');
      return;
    }
    if (newType === 'template' && !newTemplate) {
      setNewModalError('Please select a template');
      return;
    }

    setNewModalError('');
    setInitiating(true);

    try {
      let mediaUrl = null;
      let mediaType = undefined;

      if (newAttachment) {
        const uploadRes = await uploadMedia(token, {
          base64: newAttachment.base64,
          fileName: newAttachment.fileName,
          mimeType: newAttachment.file.type,
        });
        if (!uploadRes.url) {
          throw new Error(uploadRes.message || 'Media upload failed');
        }
        mediaUrl = uploadRes.url;
        mediaType = uploadRes.mediaType || newAttachment.mediaType;
      }

      const payload = {
        mobileNumber: newMobile.trim(),
        customerName: newName.trim() || undefined,
        text: newType === 'text' ? newText.trim() : (newText.trim() || undefined),
        templateName: newType === 'template' ? newTemplate : undefined,
        mediaUrl: mediaUrl || undefined,
        mediaType: mediaType || undefined,
      };

      const res = await initiateWhatsAppConversation(token, payload);
      const convId = res.data?.conversationId;

      await refreshConversations();

      if (convId) {
        setActiveConversationId(convId);
      }

      if (res.data?.sendFailed) {
        setActionError(
          res.data?.error ||
          'Conversation created, but message failed. The recipient may be outside the 24h window. Please use a template.'
        );
      }

      handleModalRemoveAttachment();
      setShowNewModal(false);
      setNewMobile('');
      setNewName('');
      setNewText('');
    } catch (err) {
      setNewModalError(err.message || 'Failed to initiate conversation');
    } finally {
      setInitiating(false);
    }
  }

  const visibleConversations = conversations.filter((cv) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (cv.CustomerMobile || '').toLowerCase().includes(q) ||
      (cv.CustomerName || '').toLowerCase().includes(q) ||
      (cv.LastMessageText || '').toLowerCase().includes(q)
    );
  });

  const activeConversation = conversations.find((cv) => cv.ConversationId === activeConversationId);

  // Build rows with day dividers
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
    <div style={{ display: 'flex', height: '100%', background: c.bg, position: 'relative' }}>
      <style>{`
        .conv-row { transition: background 0.12s ease; position: relative; }
        .conv-row:hover { background: #F3F6F8; }
        .conv-row.active:hover { background: ${c.primarySoft}; }
        .btn-hover:hover { opacity: 0.9; }
        .row-del-btn { opacity: 0; transition: opacity 0.15s ease; }
        .conv-row:hover .row-del-btn { opacity: 0.65; }
        .row-del-btn:hover { opacity: 1 !important; color: ${c.danger} !important; }
        .msg-bubble { position: relative; }
        .msg-del-btn { opacity: 0; transition: opacity 0.15s ease; }
        .msg-bubble:hover .msg-del-btn { opacity: 0.6; }
        .msg-del-btn:hover { opacity: 1 !important; color: ${c.danger} !important; }
        .wa-attach-btn:hover { background: #F0F4F8 !important; }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Sidebar */}
      <div
        style={{
          width: 350,
          minWidth: 350,
          display: 'flex',
          flexDirection: 'column',
          background: c.card,
          borderRight: `1px solid ${c.border}`,
        }}
      >
        <div style={{ padding: '16px 18px', ...s.headerGradient, color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.18)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: 18,
                }}
              >
                💬
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>WhatsApp Inbox</div>
                <div style={{ fontSize: 11.5, opacity: 0.85 }}>{conversations.length} conversations</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowNewModal(true);
                setNewModalError('');
              }}
              style={{
                background: 'rgba(255,255,255,0.22)',
                border: 'none',
                color: '#fff',
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <span>+</span> New Chat
            </button>
          </div>

          <input
            style={{
              ...s.input,
              marginTop: 12,
              background: 'rgba(255,255,255,0.95)',
              border: 'none',
              padding: '8px 12px',
              fontSize: 13,
            }}
            placeholder="Search by phone, name, or text..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Conversations list */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {visibleConversations.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: c.inkMuted, fontSize: 13 }}>
              {search ? 'No matching conversations' : 'No conversations yet'}
            </div>
          ) : (
            visibleConversations.map((cv) => {
              const label = cv.CustomerName || cv.CustomerMobile;
              const isActive = cv.ConversationId === activeConversationId;
              const timeDisplay = cv.LastMessageAt
                ? new Date(cv.LastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';

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
                      width: 40,
                      height: 40,
                      minWidth: 40,
                      borderRadius: '50%',
                      background: avatarColor(label),
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                  >
                    {(label || '#').slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 600, color: c.ink, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {label}
                      </div>
                      <div style={{ fontSize: 11, color: c.inkMuted, flexShrink: 0, marginLeft: 6 }}>
                        {timeDisplay}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: c.inkMuted, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {truncate(cv.LastMessageText, 30)}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {cv.UnreadCount > 0 && (
                          <span
                            style={{
                              background: c.accent,
                              color: '#fff',
                              borderRadius: 10,
                              padding: '1px 7px',
                              fontSize: 11,
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {cv.UnreadCount}
                          </span>
                        )}
                        <button
                          type="button"
                          className="row-del-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowDeleteConfirm({
                              type: 'conversation',
                              id: cv.ConversationId,
                              title: cv.CustomerName || cv.CustomerMobile || 'this chat',
                            });
                          }}
                          title="Delete this conversation"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            fontSize: 13,
                            color: c.inkMuted,
                            borderRadius: 4,
                            lineHeight: 1,
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Main chat window */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: c.bg, minWidth: 0 }}>
        {activeConversation ? (
          <>
            {/* Header */}
            <div
              style={{
                padding: '12px 20px',
                borderBottom: `1px solid ${c.border}`,
                background: c.card,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: '50%',
                    background: avatarColor(activeConversation.CustomerName || activeConversation.CustomerMobile),
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 16,
                  }}
                >
                  {(activeConversation.CustomerName || activeConversation.CustomerMobile || '#').slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: c.ink, fontSize: 15 }}>
                    {activeConversation.CustomerName || activeConversation.CustomerMobile}
                  </div>
                  <div style={{ fontSize: 12, color: c.inkMuted, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{activeConversation.CustomerMobile}</span>
                    {activeConversation.CustomerName && <span>· ID #{activeConversation.ConversationId}</span>}
                  </div>
                </div>
              </div>

              {/* Header Right Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* 24-hour Session Window indicator */}
                {isWindowOpen ? (
                  <span
                    style={{
                      background: '#E8F5E9',
                      color: '#2E7D32',
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '4px 10px',
                      borderRadius: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                    title="Customer messaged within last 24h. Free-form text permitted."
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2E7D32' }} />
                    24h Window Active
                  </span>
                ) : (
                  <span
                    style={{
                      background: '#FFF3E0',
                      color: '#E65100',
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '4px 10px',
                      borderRadius: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                    title="Customer has not messaged in the last 24h. Please send an Approved Template."
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#E65100' }} />
                    Outside 24h Window (Use Template)
                  </span>
                )}

                {/* Delete Entire Chat Button */}
                <button
                  type="button"
                  onClick={() =>
                    setShowDeleteConfirm({
                      type: 'conversation',
                      id: activeConversationId,
                      title: activeConversation.CustomerName || activeConversation.CustomerMobile || 'this chat',
                    })
                  }
                  title="Delete this entire conversation"
                  style={{
                    background: 'transparent',
                    border: `1px solid ${c.border}`,
                    color: c.danger,
                    borderRadius: 8,
                    padding: '6px 12px',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  🗑️ Delete Chat
                </button>
              </div>
            </div>

            {/* Error alert if send failed */}
            {actionError && (
              <div
                style={{
                  background: '#FDEDEC',
                  borderBottom: '1px solid #F5C6CB',
                  color: c.danger,
                  padding: '8px 20px',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <strong>Notice:</strong> {actionError}
                </div>
                <button
                  type="button"
                  onClick={() => setShowTemplatePicker(true)}
                  style={{
                    background: c.accent,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Send Template Instead
                </button>
              </div>
            )}

            {/* Message stream */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 24px', ...chatWallpaper }}>
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
                const isLoc = m.messageType === 'location' || (m.content && m.content.startsWith('{') && m.content.includes('"latitude"') && m.content.includes('"longitude"'));
                const isCon = m.messageType === 'contact' || (m.content && m.content.startsWith('{') && (m.content.includes('"phone"') || m.content.includes('"name"')));

                return (
                  <div
                    key={row.key}
                    style={{
                      display: 'flex',
                      justifyContent: isOut ? 'flex-end' : 'flex-start',
                      marginBottom: 10,
                    }}
                  >
                    <div
                      className="msg-bubble"
                      style={{
                        maxWidth: '68%',
                        padding: '10px 14px',
                        borderRadius: 14,
                        [isOut ? 'borderBottomRightRadius' : 'borderBottomLeftRadius']: 4,
                        fontSize: 14,
                        lineHeight: 1.45,
                        wordBreak: 'break-word',
                        background: isOut ? c.bubbleOutBg : c.bubbleInBg,
                        border: `1px solid ${isOut ? c.bubbleOutBorder : c.bubbleInBorder}`,
                        color: c.ink,
                        boxShadow: '0 1px 2px rgba(34,48,60,0.06)',
                      }}
                    >
                      {/* Location Card */}
                      {isLoc && (() => {
                        let locData = {};
                        try {
                          locData = typeof m.content === 'object' ? m.content : JSON.parse(m.content || '{}');
                        } catch {
                          locData = { name: m.content };
                        }
                        const mapLink = m.mediaUrl || `https://maps.google.com/?q=${locData.latitude || ''},${locData.longitude || ''}`;
                        return (
                          <div style={{ background: '#E8F5E9', borderRadius: 10, padding: 10, minWidth: 220, border: '1px solid #C8E6C9', marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                              <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#00A884', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                                📍
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1B5E20', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {locData.name || 'Shared Location'}
                                </div>
                                {locData.address && (
                                  <div style={{ fontSize: 11.5, color: '#2E7D32', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {locData.address}
                                  </div>
                                )}
                              </div>
                            </div>
                            {locData.latitude && locData.longitude && (
                              <div style={{ fontSize: 11, color: '#388E3C', marginBottom: 6 }}>
                                {locData.latitude}, {locData.longitude}
                              </div>
                            )}
                            <a
                              href={mapLink}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                fontSize: 12,
                                fontWeight: 600,
                                color: '#00A884',
                                textDecoration: 'none',
                                background: '#fff',
                                padding: '4px 8px',
                                borderRadius: 6,
                                border: '1px solid #C8E6C9',
                              }}
                            >
                              🗺️ Open in Google Maps ↗
                            </a>
                          </div>
                        );
                      })()}

                      {/* Contact Card */}
                      {isCon && (() => {
                        let conData = {};
                        try {
                          conData = typeof m.content === 'object' ? m.content : JSON.parse(m.content || '{}');
                        } catch {
                          conData = { name: m.content };
                        }
                        return (
                          <div style={{ background: '#E3F2FD', borderRadius: 10, padding: 10, minWidth: 220, border: '1px solid #BBDEFB', marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                              <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#0288D1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700 }}>
                                {(conData.name || 'C').slice(0, 1).toUpperCase()}
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontWeight: 700, fontSize: 13.5, color: '#0D47A1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {conData.name || 'Contact'}
                                </div>
                                {conData.organization && (
                                  <div style={{ fontSize: 11.5, color: '#1565C0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {conData.organization}
                                  </div>
                                )}
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#0277BD', marginTop: 2 }}>
                                  📞 {conData.phone || 'No phone'}
                                </div>
                                {conData.email && (
                                  <div style={{ fontSize: 11, color: '#546E7A' }}>
                                    ✉ {conData.email}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {conData.phone && (
                                <a
                                  href={`tel:${conData.phone}`}
                                  style={{
                                    flex: 1,
                                    textAlign: 'center',
                                    background: '#fff',
                                    border: '1px solid #90CAF9',
                                    color: '#0288D1',
                                    padding: '4px 8px',
                                    borderRadius: 6,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    textDecoration: 'none',
                                  }}
                                >
                                  📞 Call
                                </a>
                              )}
                              {conData.phone && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNewMobile(conData.phone);
                                    setNewName(conData.name || '');
                                    setShowNewModal(true);
                                  }}
                                  style={{
                                    flex: 1,
                                    textAlign: 'center',
                                    background: '#0288D1',
                                    border: 'none',
                                    color: '#fff',
                                    padding: '4px 8px',
                                    borderRadius: 6,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                  }}
                                >
                                  💬 Chat
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Media URL (Photos, Videos, Audio, Docs) */}
                      {m.mediaUrl && !isLoc && !isCon ? (
                        <div style={{ marginBottom: 6 }}>
                          {m.messageType === 'image' || m.mediaUrl.match(/\.(jpeg|jpg|gif|png|webp)/i) ? (
                            <a href={m.mediaUrl} target="_blank" rel="noreferrer">
                              <img
                                src={m.mediaUrl}
                                alt="Attachment"
                                style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, display: 'block', cursor: 'pointer' }}
                                onError={(e) => {
                                  if (m.mediaUrl.includes(':3003/uploads/')) {
                                    e.currentTarget.src = m.mediaUrl.replace(':3003/uploads/', ':5004/uploads/');
                                  } else if (m.mediaUrl.includes(':5004/uploads/')) {
                                    e.currentTarget.src = m.mediaUrl.replace(':5004/uploads/', ':3003/uploads/');
                                  }
                                }}
                              />
                            </a>
                          ) : m.messageType === 'video' || m.mediaUrl.match(/\.(mp4|webm|mov|mkv)/i) ? (
                            <video
                              src={m.mediaUrl}
                              controls
                              style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, display: 'block', background: '#000' }}
                              onError={(e) => {
                                if (m.mediaUrl.includes(':3003/uploads/')) {
                                  e.currentTarget.src = m.mediaUrl.replace(':3003/uploads/', ':5004/uploads/');
                                } else if (m.mediaUrl.includes(':5004/uploads/')) {
                                  e.currentTarget.src = m.mediaUrl.replace(':5004/uploads/', ':3003/uploads/');
                                }
                              }}
                            />
                          ) : m.messageType === 'audio' || m.mediaUrl.match(/\.(mp3|ogg|wav|m4a)/i) ? (
                            <audio src={m.mediaUrl} controls style={{ maxWidth: 240, display: 'block' }} />
                          ) : (
                            <a
                              href={m.mediaUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                color: c.primaryLine,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                textDecoration: 'none',
                                fontWeight: 600,
                                background: 'rgba(0,0,0,0.04)',
                                padding: '6px 10px',
                                borderRadius: 8,
                              }}
                            >
                              📄 View Document ({m.messageType || 'file'})
                            </a>
                          )}
                        </div>
                      ) : null}

                      {/* Content Text (shown only if not location/contact raw JSON) */}
                      {m.content && !isLoc && !isCon && (
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                          {m.content}
                        </div>
                      )}

                      <div style={{ fontSize: 10.5, color: c.inkFaint, marginTop: 4, textAlign: 'right', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                        <span>
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isOut && <span>· {statusLabel(m.deliveryStatus, m.failureReason)}</span>}
                        {m.messageId && !String(m.messageId).startsWith('optimistic_') && (
                          <button
                            type="button"
                            className="msg-del-btn"
                            onClick={() =>
                              setShowDeleteConfirm({
                                type: 'message',
                                id: activeConversationId,
                                subId: m.messageId,
                                title: 'this message',
                              })
                            }
                            title="Delete this message"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: 11,
                              padding: '0 2px',
                              lineHeight: 1,
                            }}
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Template Picker dropdown */}
            {showTemplatePicker && (
              <div
                style={{
                  padding: '12px 20px',
                  background: '#FFF8E1',
                  borderTop: `1px solid ${c.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>
                  Select Template:
                </span>
                <select
                  value={selectedTemplate}
                  onChange={(e) => setSelectedTemplate(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: `1px solid ${c.border}`,
                    background: '#fff',
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  {templates.map((tpl) => (
                    <option key={tpl.templateName} value={tpl.templateName}>
                      {tpl.templateName} ({tpl.language})
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => handleSend({ templateName: selectedTemplate })}
                  disabled={sending || !selectedTemplate}
                  style={{
                    background: c.accent,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '6px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Send Template
                </button>

                <button
                  type="button"
                  onClick={() => setShowTemplatePicker(false)}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${c.border}`,
                    color: c.inkMuted,
                    borderRadius: 8,
                    padding: '6px 12px',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Attachment Preview Strip */}
            {selectedAttachment && (
              <div
                style={{
                  padding: '10px 20px',
                  background: '#F0F4F8',
                  borderTop: `1px solid ${c.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  {selectedAttachment.mediaType === 'image' ? (
                    <img
                      src={selectedAttachment.previewUrl}
                      alt="preview"
                      style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: `1px solid ${c.border}` }}
                    />
                  ) : selectedAttachment.mediaType === 'video' ? (
                    <video
                      src={selectedAttachment.previewUrl}
                      style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, background: '#000' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 8,
                        background: '#E2E8F0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 24,
                      }}
                    >
                      📄
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: c.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedAttachment.fileName}
                    </div>
                    <div style={{ fontSize: 11.5, color: c.inkMuted }}>
                      {selectedAttachment.mediaType === 'image' ? '📷 Photo / Image' : '🎥 Video'} · {(selectedAttachment.file.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleRemoveAttachment}
                  title="Cancel attachment"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: c.danger,
                    fontSize: 18,
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: 6,
                    fontWeight: 700,
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Composer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 20px',
                borderTop: `1px solid ${c.border}`,
                background: c.card,
              }}
            >
              {/* Hidden file inputs */}
              <input
                type="file"
                ref={photoInputRef}
                accept="image/*,video/*"
                style={{ display: 'none' }}
                onChange={(e) => handleFileSelect(e)}
              />
              <input
                type="file"
                ref={documentInputRef}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                style={{ display: 'none' }}
                onChange={(e) => handleFileSelect(e, 'document')}
              />

              <button
                type="button"
                onClick={() => setShowTemplatePicker((v) => !v)}
                title="Send an approved WhatsApp template"
                style={{
                  background: showTemplatePicker ? c.accent : c.primarySoft,
                  color: showTemplatePicker ? '#fff' : c.primary,
                  border: 'none',
                  borderRadius: 20,
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                📑 Template
              </button>

              {/* WhatsApp Attachment Button (📎 Popover Menu) */}
              <div style={{ position: 'relative' }} ref={attachmentMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowAttachmentMenu((prev) => !prev)}
                  title="Attach (Photo, Video, Document, Location, Contact)"
                  style={{
                    background: showAttachmentMenu ? '#E2E8F0' : 'transparent',
                    border: `1px solid ${c.border}`,
                    borderRadius: '50%',
                    width: 38,
                    height: 38,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 19,
                    cursor: 'pointer',
                    flexShrink: 0,
                    transform: showAttachmentMenu ? 'rotate(45deg)' : 'none',
                    transition: 'all 0.18s ease',
                  }}
                  onMouseEnter={(e) => { if (!showAttachmentMenu) e.currentTarget.style.background = '#EEF2F6'; }}
                  onMouseLeave={(e) => { if (!showAttachmentMenu) e.currentTarget.style.background = 'transparent'; }}
                >
                  📎
                </button>

                {showAttachmentMenu && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 52,
                      left: 0,
                      background: '#fff',
                      borderRadius: 16,
                      boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
                      padding: '10px 8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      zIndex: 1000,
                      width: 195,
                      border: `1px solid ${c.border}`,
                      animation: 'fadeInUp 0.15s ease-out',
                    }}
                  >
                    {/* 1. Photos & Videos */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachmentMenu(false);
                        photoInputRef.current?.click();
                      }}
                      className="wa-attach-btn"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '8px 10px',
                        borderRadius: 10,
                        textAlign: 'left',
                        width: '100%',
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #007BFC, #0056B3)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                        }}
                      >
                        📷
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Photos & Videos</div>
                        <div style={{ fontSize: 10.5, color: c.inkMuted }}>Images, mp4, etc.</div>
                      </div>
                    </button>

                    {/* 2. Document */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachmentMenu(false);
                        documentInputRef.current?.click();
                      }}
                      className="wa-attach-btn"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '8px 10px',
                        borderRadius: 10,
                        textAlign: 'left',
                        width: '100%',
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #7F66FF, #5E35B1)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                        }}
                      >
                        📄
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Document</div>
                        <div style={{ fontSize: 10.5, color: c.inkMuted }}>PDF, doc, txt, zip</div>
                      </div>
                    </button>

                    {/* 3. Location */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachmentMenu(false);
                        setShowLocationModal(true);
                      }}
                      className="wa-attach-btn"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '8px 10px',
                        borderRadius: 10,
                        textAlign: 'left',
                        width: '100%',
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #00A884, #008069)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                        }}
                      >
                        📍
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Location</div>
                        <div style={{ fontSize: 10.5, color: c.inkMuted }}>GPS pin & address</div>
                      </div>
                    </button>

                    {/* 4. Contact */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachmentMenu(false);
                        setShowContactModal(true);
                      }}
                      className="wa-attach-btn"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '8px 10px',
                        borderRadius: 10,
                        textAlign: 'left',
                        width: '100%',
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #0288D1, #0277BD)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                        }}
                      >
                        👤
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Contact</div>
                        <div style={{ fontSize: 10.5, color: c.inkMuted }}>Share contact card</div>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              <input
                style={{ ...s.input, flex: 1, background: c.bg, borderRadius: 24, padding: '10px 16px' }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  selectedAttachment
                    ? `Add a caption for this ${selectedAttachment.mediaType === 'image' ? 'photo' : selectedAttachment.mediaType === 'video' ? 'video' : 'document'} (optional)...`
                    : 'Type a WhatsApp message...'
                }
                disabled={sending}
              />

              <button
                type="button"
                onClick={() => handleSend()}
                disabled={sending || (!draft.trim() && !selectedAttachment)}
                style={{
                  ...s.buttonAccent,
                  width: 44,
                  height: 44,
                  padding: 0,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: sending || (!draft.trim() && !selectedAttachment) ? 0.6 : 1,
                  flexShrink: 0,
                }}
                aria-label="Send"
              >
                {sending ? '⏱' : '➤'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ margin: 'auto', textAlign: 'center', color: c.inkFaint }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>💬</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: c.inkMuted, marginBottom: 6 }}>
              Select a conversation to start messaging
            </div>
            <div style={{ fontSize: 13 }}>
              Or click <strong>"+ New Chat"</strong> above to send to any individual number
            </div>
          </div>
        )}
      </div>

      {/* "+ New Chat" Modal */}
      {showNewModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNewModal(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              width: '100%',
              maxWidth: 480,
              boxShadow: '0 12px 36px rgba(0,0,0,0.22)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', ...s.headerGradient, color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Start New WhatsApp Chat</div>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleInitiate} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {newModalError && (
                <div style={{ background: '#FDEDEC', color: c.danger, padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>
                  {newModalError}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 5 }}>
                  Recipient Mobile Number *
                </label>
                <input
                  style={s.input}
                  placeholder="e.g. 919999999999 or 9876543210"
                  value={newMobile}
                  onChange={(e) => setNewMobile(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 5 }}>
                  Customer Name (Optional)
                </label>
                <input
                  style={s.input}
                  placeholder="e.g. John Doe"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 5 }}>
                  Message Type
                </label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setNewType('template')}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: newType === 'template' ? `2px solid ${c.accent}` : `1px solid ${c.border}`,
                      background: newType === 'template' ? c.accentSoft : '#fff',
                      color: c.ink,
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    Approved Template (Recommended)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewType('text')}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: newType === 'text' ? `2px solid ${c.accent}` : `1px solid ${c.border}`,
                      background: newType === 'text' ? c.accentSoft : '#fff',
                      color: c.ink,
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    Free-form Text
                  </button>
                </div>
                <div style={{ fontSize: 11.5, color: c.inkMuted, marginTop: 4 }}>
                  {newType === 'template'
                    ? 'Templates can reach users anytime, even outside the 24-hour service window.'
                    : 'Free-form messages only deliver if the user sent a message within the last 24h.'}
                </div>
              </div>

              {newType === 'template' ? (
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 5 }}>
                    Select Approved Template *
                  </label>
                  <select
                    value={newTemplate}
                    onChange={(e) => setNewTemplate(e.target.value)}
                    style={{ ...s.input, padding: '9px 12px' }}
                    required
                  >
                    {templates.map((tpl) => (
                      <option key={tpl.templateName} value={tpl.templateName}>
                        {tpl.templateName} ({tpl.language})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {/* Media attachment for New Chat */}
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 5 }}>
                  Attach Photo / Video (Optional)
                </label>
                <input
                  type="file"
                  ref={modalPhotoInputRef}
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => handleModalFileSelect(e, 'image')}
                />
                <input
                  type="file"
                  ref={modalVideoInputRef}
                  accept="video/*"
                  style={{ display: 'none' }}
                  onChange={(e) => handleModalFileSelect(e, 'video')}
                />

                <input
                  type="file"
                  ref={modalDocumentInputRef}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                  style={{ display: 'none' }}
                  onChange={(e) => handleModalFileSelect(e, 'document')}
                />

                {newAttachment ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: '#F0F4F8',
                      borderRadius: 8,
                      border: `1px solid ${c.border}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>{newAttachment.mediaType === 'image' ? '📷' : newAttachment.mediaType === 'video' ? '🎥' : '📄'}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{newAttachment.fileName}</span>
                      <span style={{ fontSize: 11.5, color: c.inkMuted }}>({(newAttachment.file.size / 1024 / 1024).toFixed(2)} MB)</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleModalRemoveAttachment}
                      style={{ background: 'transparent', border: 'none', color: c.danger, cursor: 'pointer', fontWeight: 700 }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => modalPhotoInputRef.current?.click()}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: `1px solid ${c.border}`,
                        background: '#fff',
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      📷 Photo
                    </button>
                    <button
                      type="button"
                      onClick={() => modalVideoInputRef.current?.click()}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: `1px solid ${c.border}`,
                        background: '#fff',
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      🎥 Video
                    </button>
                    <button
                      type="button"
                      onClick={() => modalDocumentInputRef.current?.click()}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: `1px solid ${c.border}`,
                        background: '#fff',
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      📄 Document
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 5 }}>
                  {newType === 'template' ? 'Optional Note' : 'Message Text *'}
                </label>
                <textarea
                  style={{ ...s.input, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }}
                  placeholder={newType === 'template' ? 'Optional internal note or text' : 'Type your message...'}
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  required={newType === 'text' && !newAttachment}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  style={{ ...s.buttonGhost, padding: '8px 16px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={initiating || !newMobile.trim()}
                  style={{ ...s.buttonAccent, padding: '8px 18px', opacity: initiating ? 0.7 : 1 }}
                >
                  {initiating ? 'Sending...' : 'Send & Open Chat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Location Modal */}
      {showLocationModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLocationModal(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              width: '100%',
              maxWidth: 440,
              boxShadow: '0 12px 36px rgba(0,0,0,0.25)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', background: '#00A884', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>📍</span> Send Location
              </div>
              <button
                type="button"
                onClick={() => setShowLocationModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSendLocation} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {locError && (
                <div style={{ background: '#FDEDEC', color: c.danger, padding: '8px 12px', borderRadius: 8, fontSize: 12.5 }}>
                  {locError}
                </div>
              )}

              <button
                type="button"
                onClick={handleGetGeoLocation}
                disabled={locLoading}
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid #00A884',
                  background: '#E8F5E9',
                  color: '#008069',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                {locLoading ? 'Fetching Location...' : '📍 Use My Current GPS Location'}
              </button>

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 4 }}>
                  Location / Venue Name
                </label>
                <input
                  style={s.input}
                  placeholder="e.g. Office HQ, Central Station"
                  value={locName}
                  onChange={(e) => setLocName(e.target.value)}
                  autoFocus
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 4 }}>
                  Street Address (Optional)
                </label>
                <input
                  style={s.input}
                  placeholder="e.g. 123 Tech Park, 5th Floor"
                  value={locAddress}
                  onChange={(e) => setLocAddress(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 4 }}>
                    Latitude *
                  </label>
                  <input
                    style={s.input}
                    placeholder="e.g. 28.6139"
                    value={locLat}
                    onChange={(e) => setLocLat(e.target.value)}
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 4 }}>
                    Longitude *
                  </label>
                  <input
                    style={s.input}
                    placeholder="e.g. 77.2090"
                    value={locLng}
                    onChange={(e) => setLocLng(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowLocationModal(false)}
                  style={{ ...s.buttonGhost, padding: '8px 16px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sending || !locLat.trim() || !locLng.trim()}
                  style={{ ...s.buttonAccent, background: '#00A884', borderColor: '#00A884', padding: '8px 18px' }}
                >
                  {sending ? 'Sending...' : 'Send Location'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Contact Modal */}
      {showContactModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowContactModal(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              width: '100%',
              maxWidth: 440,
              boxShadow: '0 12px 36px rgba(0,0,0,0.25)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', background: '#0288D1', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>👤</span> Send Contact Card
              </div>
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSendContact} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {conError && (
                <div style={{ background: '#FDEDEC', color: c.danger, padding: '8px 12px', borderRadius: 8, fontSize: 12.5 }}>
                  {conError}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 4 }}>
                  Full Name *
                </label>
                <input
                  style={s.input}
                  placeholder="e.g. John Doe"
                  value={conName}
                  onChange={(e) => setConName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 4 }}>
                  Phone Number *
                </label>
                <input
                  style={s.input}
                  placeholder="e.g. +91 98765 43210"
                  value={conPhone}
                  onChange={(e) => setConPhone(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 4 }}>
                  Company / Organization (Optional)
                </label>
                <input
                  style={s.input}
                  placeholder="e.g. Support Team"
                  value={conOrg}
                  onChange={(e) => setConOrg(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 4 }}>
                  Email Address (Optional)
                </label>
                <input
                  style={s.input}
                  type="email"
                  placeholder="e.g. john@example.com"
                  value={conEmail}
                  onChange={(e) => setConEmail(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowContactModal(false)}
                  style={{ ...s.buttonGhost, padding: '8px 16px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sending || !conName.trim() || !conPhone.trim()}
                  style={{ ...s.buttonAccent, background: '#0288D1', borderColor: '#0288D1', padding: '8px 18px' }}
                >
                  {sending ? 'Sending...' : 'Send Contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDeleteConfirm(null);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              width: '100%',
              maxWidth: 400,
              boxShadow: '0 12px 36px rgba(0,0,0,0.25)',
              padding: 22,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, color: c.danger }}>
              <span style={{ fontSize: 24 }}>🗑️</span>
              <div style={{ fontWeight: 700, fontSize: 16 }}>
                {showDeleteConfirm.type === 'conversation' ? 'Delete Conversation' : 'Delete Message'}
              </div>
            </div>
            <p style={{ fontSize: 13.5, color: c.ink, lineHeight: 1.5, margin: '0 0 18px 0' }}>
              Are you sure you want to delete <strong>{showDeleteConfirm.title}</strong>? This action will permanently remove it.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(null)}
                style={{ ...s.buttonGhost, padding: '8px 16px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                style={{
                  background: c.danger,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? `${str.slice(0, n)}…` : str;
}
