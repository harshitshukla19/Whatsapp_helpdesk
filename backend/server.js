process.env.TZ = 'Asia/Kolkata';
                                   // the VPS OS clock, so GETDATE() timestamps
                                   // resolve correctly no matter how the server
                                   // itself is provisioned in future
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const { getPool } = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const internalTicketRoutes = require('./routes/internalTicketRoutes');
const whatsappWebhookRoutes = require('./routes/whatsappWebhookRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');

const fs = require('fs');

const app = express();

const allowedOrigins = (process.env.CLIENT_URL || 'http://103.191.89.237:3003,http://localhost:3003').split(',').map((origin) => origin.trim()).filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true
}));
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// Static uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// In-memory session store for chunked media uploads
const chunkUploads = new Map();

// Periodic cleanup of stale chunk sessions (> 30 mins)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of chunkUploads.entries()) {
    if (now - session.createdAt > 30 * 60 * 1000) {
      chunkUploads.delete(id);
    }
  }
}, 5 * 60 * 1000);

// Single-shot media upload endpoint
app.post('/api/upload', (req, res) => {
  try {
    const { base64, fileName, mimeType } = req.body || {};
    if (!base64) {
      return res.status(400).json({ success: false, message: 'base64 data is required' });
    }

    const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    const dataBuffer = Buffer.from(matches ? matches[2] : base64, 'base64');
    const detectedMime = (matches ? matches[1] : mimeType) || 'application/octet-stream';

    let ext = path.extname(fileName || '').slice(1);
    if (!ext) {
      if (detectedMime.includes('image/jpeg')) ext = 'jpg';
      else if (detectedMime.includes('image/png')) ext = 'png';
      else if (detectedMime.includes('image/webp')) ext = 'webp';
      else if (detectedMime.includes('video/mp4')) ext = 'mp4';
      else if (detectedMime.includes('video/webm')) ext = 'webm';
      else if (detectedMime.includes('application/pdf')) ext = 'pdf';
      else ext = 'bin';
    }

    const safeName = `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.join(uploadsDir, safeName);
    fs.writeFileSync(filePath, dataBuffer);

    let mediaType = 'document';
    if (detectedMime.startsWith('image/')) mediaType = 'image';
    else if (detectedMime.startsWith('video/')) mediaType = 'video';
    else if (detectedMime.startsWith('audio/')) mediaType = 'audio';

    const host = req.get('host') || '';
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    let publicBase = process.env.PUBLIC_MEDIA_BASE_URL;
    if (!publicBase) {
      if (host && host.includes(':') && !host.includes('localhost') && !host.includes('127.0.0.1')) {
        publicBase = `${protocol}://${host}`;
      } else {
        // Port 3003 is the public Nginx web server serving frontend and /uploads
        publicBase = 'http://103.191.89.237:3003';
      }
    }
    const fileUrl = `${publicBase}/uploads/${safeName}`;

    return res.json({
      success: true,
      url: fileUrl,
      mediaType,
      fileName: safeName,
    });
  } catch (err) {
    console.error('[upload error]', err);
    return res.status(500).json({ success: false, message: 'Failed to upload media', error: err.message });
  }
});

// Chunked media upload endpoint: accepts 350KB chunks to bypass Nginx 1MB client_max_body_size
app.post('/api/upload/chunk', (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks, data, fileName, mimeType } = req.body || {};
    if (!uploadId || chunkIndex === undefined || !totalChunks || !data) {
      return res.status(400).json({ success: false, message: 'Missing chunk upload parameters' });
    }

    if (!chunkUploads.has(uploadId)) {
      chunkUploads.set(uploadId, {
        chunks: new Array(totalChunks),
        received: 0,
        fileName,
        mimeType,
        createdAt: Date.now(),
      });
    }

    const session = chunkUploads.get(uploadId);
    if (!session.chunks[chunkIndex]) {
      session.chunks[chunkIndex] = data;
      session.received += 1;
    }

    // Still waiting for more chunks
    if (session.received < totalChunks) {
      return res.json({
        success: true,
        received: session.received,
        total: totalChunks,
        done: false,
      });
    }

    // All chunks received -> concatenate and persist
    const fullBase64 = session.chunks.join('');
    chunkUploads.delete(uploadId);

    const matches = fullBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    const dataBuffer = Buffer.from(matches ? matches[2] : fullBase64, 'base64');
    const detectedMime = (matches ? matches[1] : session.mimeType) || 'application/octet-stream';

    let ext = path.extname(session.fileName || '').slice(1);
    if (!ext) {
      if (detectedMime.includes('image/jpeg')) ext = 'jpg';
      else if (detectedMime.includes('image/png')) ext = 'png';
      else if (detectedMime.includes('image/webp')) ext = 'webp';
      else if (detectedMime.includes('video/mp4')) ext = 'mp4';
      else if (detectedMime.includes('video/webm')) ext = 'webm';
      else if (detectedMime.includes('application/pdf')) ext = 'pdf';
      else ext = 'bin';
    }

    const safeName = `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.join(uploadsDir, safeName);
    fs.writeFileSync(filePath, dataBuffer);

    let mediaType = 'document';
    if (detectedMime.startsWith('image/')) mediaType = 'image';
    else if (detectedMime.startsWith('video/')) mediaType = 'video';
    else if (detectedMime.startsWith('audio/')) mediaType = 'audio';

    const host = req.get('host') || '';
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    let publicBase = process.env.PUBLIC_MEDIA_BASE_URL;
    if (!publicBase) {
      if (host && host.includes(':') && !host.includes('localhost') && !host.includes('127.0.0.1')) {
        publicBase = `${protocol}://${host}`;
      } else {
        publicBase = 'http://103.191.89.237:3003';
      }
    }
    const fileUrl = `${publicBase}/uploads/${safeName}`;

    return res.json({
      success: true,
      done: true,
      url: fileUrl,
      mediaType,
      fileName: safeName,
    });
  } catch (err) {
    console.error('[chunk upload error]', err);
    return res.status(500).json({ success: false, message: 'Chunk upload failed', error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => res.json({ success: true, message: 'OK' }));

// Login endpoint kept mounted (unused by the dashboard right now) in case
// you want to re-add a login gate later - see internal routes below.
app.use('/api/auth', authRoutes);

// MsgClub WhatsApp webhooks (incoming messages + delivery status) - public,
// no CORS/JWT needed since MsgClub calls this server-to-server.
// Public URL to use for MsgClub: http://103.191.89.237:3003/api/webhooks/msgclub/messages
app.use('/api/webhooks/msgclub', whatsappWebhookRoutes);

// Ticket intake (e.g. from a WhatsApp webhook, or any future public form)
app.use('/api/tickets', ticketRoutes);

// Team dashboard - NO LOGIN REQUIRED (per explicit instruction: direct access,
// no auth gate). authMiddleware intentionally NOT applied here.
app.use('/api/internal/tickets', internalTicketRoutes);

// WhatsApp conversation view for agents - same no-auth pattern as the ticket
// dashboard above, so it's reachable from the frontend without a token.
app.use('/api/whatsapp', whatsappRoutes);

const PORT = process.env.PORT || 5004;
const HOST = process.env.HOST || '0.0.0.0';

// Initialize DB pool before accepting traffic
getPool()
  .then(() => {
    console.log('Database pool initialized');
    app.listen(PORT, HOST, () => {
      console.log(`Server running on http://${HOST}:${PORT}`);
      console.log(`Webhook endpoint: http://${HOST}:${PORT}/api/webhooks/msgclub/messages`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database pool:', err);
    process.exit(1);
  });