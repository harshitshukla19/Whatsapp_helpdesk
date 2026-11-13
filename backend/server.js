process.env.TZ = 'Asia/Kolkata';
                                   // the VPS OS clock, so GETDATE() timestamps
                                   // resolve correctly no matter how the server
                                   // itself is provisioned in future
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { getPool } = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const internalTicketRoutes = require('./routes/internalTicketRoutes');
const whatsappWebhookRoutes = require('./routes/whatsappWebhookRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');

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
app.use(express.json());

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