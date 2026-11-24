import React, { useState, useRef, useEffect } from 'react';
import { c, s, chatWallpaper } from '../styles.js';
import { uploadMedia, compressImageIfNeeded } from '../api/api.js';

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
  const type = (m.MessageType || '').toLowerCase();
  const mediaUrl = m.MediaURL || m.mediaUrl;
  const text = m.MessageText || m.content || '';

  const isLoc = type === 'location' || (text.startsWith('{') && text.includes('"latitude"') && text.includes('"longitude"'));
  const isCon = type === 'contact' || (text.startsWith('{') && (text.includes('"phone"') || text.includes('"name"')));
  const isImg = type === 'image' || (mediaUrl && mediaUrl.match(/\.(jpeg|jpg|png|webp|gif)/i));
  const isVid = type === 'video' || (mediaUrl && mediaUrl.match(/\.(mp4|webm|mov|mkv)/i));
  const isAud = type === 'audio' || (mediaUrl && mediaUrl.match(/\.(mp3|ogg|wav|m4a)/i));
  const isDoc = type === 'document' || (mediaUrl && !isImg && !isVid && !isAud && !isLoc && !isCon);

  if (isLoc) {
    let locData = {};
    try {
      locData = typeof text === 'object' ? text : JSON.parse(text || '{}');
    } catch {
      locData = { name: text };
    }
    const mapLink = mediaUrl || `https://maps.google.com/?q=${locData.latitude || ''},${locData.longitude || ''}`;
    return (
      <div style={{ background: '#E8F5E9', borderRadius: 10, padding: 10, minWidth: 200, border: '1px solid #C8E6C9' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#00A884', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
            📍
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1B5E20' }}>
              {locData.name || 'Location'}
            </div>
            {locData.address && <div style={{ fontSize: 11.5, color: '#2E7D32' }}>{locData.address}</div>}
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
  }

  if (isCon) {
    let conData = {};
    try {
      conData = typeof text === 'object' ? text : JSON.parse(text || '{}');
    } catch {
      conData = { name: text };
    }
    return (
      <div style={{ background: '#E3F2FD', borderRadius: 10, padding: 10, minWidth: 200, border: '1px solid #BBDEFB' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#0288D1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700 }}>
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
          </div>
        </div>
        {conData.phone && (
          <a
            href={`tel:${conData.phone}`}
            style={{
              display: 'block',
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
            📞 Call Contact
          </a>
        )}
      </div>
    );
  }

  if (isImg && mediaUrl) {
    return (
      <div>
        <a href={mediaUrl} target="_blank" rel="noreferrer">
          <img
            src={mediaUrl}
            alt="attachment"
            style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, display: 'block', cursor: 'pointer' }}
            onError={(e) => {
              if (mediaUrl.includes(':3003/uploads/')) {
                e.currentTarget.src = mediaUrl.replace(':3003/uploads/', ':5004/uploads/');
              } else if (mediaUrl.includes(':5004/uploads/')) {
                e.currentTarget.src = mediaUrl.replace(':5004/uploads/', ':3003/uploads/');
              }
            }}
          />
        </a>
        {text && <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{text}</div>}
      </div>
    );
  }

  if (isVid && mediaUrl) {
    return (
      <div>
        <video
          src={mediaUrl}
          controls
          style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, display: 'block', background: '#000' }}
          onError={(e) => {
            if (mediaUrl.includes(':3003/uploads/')) {
              e.currentTarget.src = mediaUrl.replace(':3003/uploads/', ':5004/uploads/');
            } else if (mediaUrl.includes(':5004/uploads/')) {
              e.currentTarget.src = mediaUrl.replace(':5004/uploads/', ':3003/uploads/');
            }
          }}
        />
        {text && <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{text}</div>}
      </div>
    );
  }

  if (isAud && mediaUrl) {
    return (
      <div>
        <audio src={mediaUrl} controls style={{ maxWidth: 260, display: 'block' }} />
        {text && <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{text}</div>}
      </div>
    );
  }

  if (isDoc && mediaUrl) {
    return (
      <div>
        <a
          href={mediaUrl}
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: 'underline', color: 'inherit', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          📄 {text || 'View document'}
        </a>
      </div>
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

export default function ChatWindow({ messages, onSend, selfSenderType, placeholder, sendError, token }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState(null); // { file, previewUrl, mediaType, fileName, base64 }
  const [uploadError, setUploadError] = useState('');

  const bottomRef = useRef(null);
  const photoInputRef = useRef(null);
  const videoInputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Clean up object URL on unmount or removal
  useEffect(() => {
    return () => {
      if (selectedAttachment?.previewUrl) {
        URL.revokeObjectURL(selectedAttachment.previewUrl);
      }
    };
  }, [selectedAttachment]);

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

    setUploadError('');
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
      setUploadError('Failed to read file');
    };
    reader.readAsDataURL(file);

    // Reset input so same file can be picked again if desired
    e.target.value = '';
  }

  function handleRemoveAttachment() {
    if (selectedAttachment?.previewUrl) {
      URL.revokeObjectURL(selectedAttachment.previewUrl);
    }
    setSelectedAttachment(null);
    setUploadError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const text = draft.trim();
    if ((!text && !selectedAttachment) || sending) return;

    setSending(true);
    setUploadError('');

    try {
      if (selectedAttachment) {
        // Upload media file first
        const uploadRes = await uploadMedia(token, {
          base64: selectedAttachment.base64,
          fileName: selectedAttachment.fileName,
          mimeType: selectedAttachment.file.type,
        });

        if (!uploadRes.url) {
          throw new Error(uploadRes.message || 'Media upload failed');
        }

        await onSend({
          text,
          mediaUrl: uploadRes.url,
          mediaType: uploadRes.mediaType || selectedAttachment.mediaType,
        });

        handleRemoveAttachment();
        setDraft('');
      } else {
        await onSend(text);
        setDraft('');
      }
    } catch (err) {
      setUploadError(err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  // Group messages by calendar day
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

      {(sendError || uploadError) && (
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
          ⚠ {uploadError || sendError}
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

      <form
        onSubmit={handleSubmit}
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
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => handleFileSelect(e, 'image')}
        />
        <input
          type="file"
          ref={videoInputRef}
          accept="video/*"
          style={{ display: 'none' }}
          onChange={(e) => handleFileSelect(e, 'video')}
        />

        {/* 📷 Photo Button */}
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          title="Send Photo / Image"
          style={{
            background: 'transparent',
            border: `1px solid ${c.border}`,
            borderRadius: '50%',
            width: 38,
            height: 38,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 17,
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#EEF2F6')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          📷
        </button>

        {/* 🎥 Video Button */}
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          title="Send Video"
          style={{
            background: 'transparent',
            border: `1px solid ${c.border}`,
            borderRadius: '50%',
            width: 38,
            height: 38,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 17,
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#EEF2F6')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          🎥
        </button>

        <input
          style={{ ...s.input, flex: 1, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 24 }}
          placeholder={
            selectedAttachment
              ? `Add a caption for this ${selectedAttachment.mediaType === 'image' ? 'photo' : 'video'} (optional)...`
              : (placeholder || 'Write a message...')
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sending}
        />

        <button
          type="submit"
          disabled={sending || (!draft.trim() && !selectedAttachment)}
          style={{
            ...s.buttonAccent,
            width: 42,
            height: 42,
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
      </form>
    </div>
  );
}