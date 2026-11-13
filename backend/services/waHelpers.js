const { sql } = require('../config/db');

// Must match the clock your CreatedAt columns use (TicketMessages looked like IST => GETDATE()).
const DB_NOW = 'GETDATE()';

function normalizeMobile(m) {
  let d = String(m || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return d;
}

function extractRequestId(data) {
  return data?.requestId || data?.request_id || data?.id || null;
}

// True if this customer messaged us in the last 24h, in the ticket flow OR the inbox flow.
// Matches on the last 10 digits, because Tickets.MobileNumber can be 10-digit or 91-prefixed.
async function isWindowOpenForMobile(pool, mobile) {
  const last10 = String(mobile || '').replace(/\D/g, '').slice(-10);
  const r = await pool.request()
    .input('Last10', sql.VarChar(10), last10)
    .query(`
      SELECT MAX(x.MsgAt) AS LastInbound
      FROM (
        SELECT tm.CreatedAt AS MsgAt
        FROM TicketMessages tm
        JOIN Tickets t ON t.TicketID = tm.TicketID
        WHERE RIGHT(t.MobileNumber, 10) = @Last10 AND tm.SenderType = 'Customer'
        UNION ALL
        SELECT wm.CreatedAt
        FROM WhatsAppMessages wm
        JOIN WhatsAppConversations c ON c.ConversationId = wm.ConversationId
        WHERE RIGHT(c.CustomerMobile, 10) = @Last10 AND wm.Direction = 'IN'
      ) x
      WHERE x.MsgAt >= DATEADD(HOUR, -24, ${DB_NOW})
    `);
  return !!r.recordset[0]?.LastInbound;
}

module.exports = { normalizeMobile, extractRequestId, isWindowOpenForMobile };