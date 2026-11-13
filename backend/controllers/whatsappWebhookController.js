const { getPool, sql } = require('../config/db');
const { sendTicketAcknowledgement } = require('../config/whatsapp');
/** Find the most recent ticket for this mobile number, or create a new one. */
async function getOrCreateTicketForMobile(pool, mobile) {
  const existing = await pool
    .request()
    .input('Mobile', sql.VarChar(15), mobile)
    .query(`
      SELECT TOP 1 TicketID
      FROM Tickets
      WHERE MobileNumber = @Mobile
      ORDER BY CreatedAt DESC
    `);

  if (existing.recordset?.length) {
    return existing.recordset[0].TicketID;
  }

  const seqResult = await pool
    .request()
    .output('NewTicketID', sql.VarChar(20))
    .execute('usp_GetNextTicketNumber');
  const ticketId = seqResult.output.NewTicketID;

  await pool
    .request()
    .input('TicketID', sql.VarChar(20), ticketId)
    .input('MobileNumber', sql.VarChar(15), mobile)
    .input('Subject', sql.NVarChar(255), `WhatsApp - ${mobile}`)
    .query(`
      INSERT INTO Tickets (TicketID, CustomerName, MobileNumber, Subject, Status)
      VALUES (@TicketID, NULL, @MobileNumber, @Subject, 'Open')
    `);

  // Fires exactly once - only reached on brand-new ticket creation.
  sendTicketAcknowledgement(mobile, ticketId).catch((err) =>
    console.error(`[getOrCreateTicketForMobile] ack send failed for ${ticketId}:`, err)
  );

  return ticketId;
}

async function whatsappWebhookHandler(req, res) {
  res.status(200).json({ success: true });

  const body = req.body || {};
  const rawJson = JSON.stringify(body);

  try {
    const pool = await getPool();

    try {
      await pool
        .request()
        .input('RawBody', sql.NVarChar(sql.MAX), rawJson)
        .query(`
          INSERT INTO WhatsAppWebhookRawLog (RawBody, ReceivedAt)
          VALUES (@RawBody, GETUTCDATE())
        `);
    } catch (logErr) {
      console.warn('[whatsappWebhookHandler] raw log insert failed:', logErr.message);
    }

    // ---- Incoming customer message -> auto-create/find ticket by mobile number ----
    if (body.clientResponse && typeof body.clientResponse === 'object') {
      const mobile = String(body.clientResponse.sender || '').replace(/\D/g, '');
      const text = String(body.clientResponse.message || '').trim();

      if (!mobile) {
        console.warn('[whatsappWebhookHandler] clientResponse but no sender', body);
        return;
      }

      const ticketId = await getOrCreateTicketForMobile(pool, mobile);

      await pool
        .request()
        .input('TicketID', sql.VarChar(20), ticketId)
        .input('SenderType', sql.VarChar(10), 'Customer')
        .input('SenderName', sql.NVarChar(100), null)
        .input('MessageText', sql.NVarChar(sql.MAX), text || '(empty)')
        .input('MessageType', sql.VarChar(20), 'text')
        .input('MediaURL', sql.NVarChar(500), null)
        .input('WaMessageId', sql.VarChar(100), null)
        .input('DeliveryStatus', sql.VarChar(20), 'received')
        .execute('usp_AddMessage');

      console.log(
        `[whatsappWebhookHandler] IN from ${mobile} ticket=${ticketId}: ${text.slice(0, 80)}`
      );
      return;
    }

    // ---- Status update for a previously sent agent reply ----
    if (body.status && body.requestId) {
      const requestId = String(body.requestId);
      const status = String(body.status).toLowerCase();

      const ticketResult = await pool
        .request()
        .input('WaMessageId', sql.VarChar(100), requestId)
        .input('DeliveryStatus', sql.VarChar(30), status)
        .query(`
          UPDATE TicketMessages
          SET DeliveryStatus = @DeliveryStatus
          WHERE WaMessageId = @WaMessageId
        `);

      const waResult = await pool
        .request()
        .input('RequestId', sql.VarChar(100), requestId)
        .input('DeliveryStatus', sql.VarChar(30), status)
        .query(`
          UPDATE WhatsAppMessages
          SET DeliveryStatus = @DeliveryStatus
          WHERE RequestId = @RequestId
        `);

      const ticketRows = ticketResult.rowsAffected?.[0] || 0;
      const waRows = waResult.rowsAffected?.[0] || 0;
      const matched = ticketRows + waRows;

      if (matched === 0) {
        console.warn(
          `[whatsappWebhookHandler] status ${status} for requestId ${requestId} matched NO rows in TicketMessages or WhatsAppMessages`
        );
      } else {
        console.log(
          `[whatsappWebhookHandler] status ${status} for requestId ${requestId} (TicketMessages:${ticketRows}, WhatsAppMessages:${waRows})`
        );
      }
      return;
    }

    console.warn('[whatsappWebhookHandler] unhandled payload shape', body);
  } catch (err) {
    console.error('[whatsappWebhookHandler] error:', err.message);
  }
}

async function getRecentWebhookLogs(req, res) {
  try {
    const key = req.query.key || req.headers['x-debug-key'];
    if (!process.env.WEBHOOK_DEBUG_KEY || key !== process.env.WEBHOOK_DEBUG_KEY) {
      return res.status(401).json({ success: false, message: 'Invalid debug key' });
    }

    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);
    const sinceId = req.query.since ? parseInt(req.query.since, 10) : null;

    const pool = await getPool();
    const request = pool.request().input('Limit', sql.Int, limit);

    let query = `
      SELECT TOP (@Limit)
        LogId AS id,
        RawBody AS payload,
        ReceivedAt AS receivedAt
      FROM WhatsAppWebhookRawLog
    `;
    if (sinceId && !Number.isNaN(sinceId)) {
      request.input('SinceId', sql.Int, sinceId);
      query += ` WHERE LogId > @SinceId`;
    }
    query += ` ORDER BY LogId DESC`;

    const result = await request.query(query);
    const rows = (result.recordset || []).map((r) => {
      let payload = r.payload;
      try {
        payload = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch (_) {}
      return { id: r.id, receivedAt: r.receivedAt, payload };
    });

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[getRecentWebhookLogs]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  whatsappWebhookHandler,
  getRecentWebhookLogs
};