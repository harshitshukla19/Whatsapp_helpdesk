const { getPool, sql } = require('../config/db');
const { sendTicketAcknowledgement } = require('../config/whatsapp');

/**
 * Find the most recent ticket for this mobile number, or create a new one.
 */
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

  // Fire-and-forget ticket acknowledgement
  sendTicketAcknowledgement(mobile, ticketId).catch((err) =>
    console.error(`[getOrCreateTicketForMobile] ack send failed for ${ticketId}:`, err)
  );

  return ticketId;
}

/**
 * MsgClub WhatsApp Webhook endpoint handler
 * POST /api/webhooks/msgclub/messages
 */
async function whatsappWebhookHandler(req, res) {
  // Always acknowledge immediately to MsgClub
  res.status(200).json({ success: true });

  const body = req.body || {};
  const rawJson = JSON.stringify(body);

  try {
    const pool = await getPool();

    // 1. Raw audit log
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

    // 2. Incoming customer message
    if (body.clientResponse && typeof body.clientResponse === 'object') {
      const mobile = String(body.clientResponse.sender || '').replace(/\D/g, '');
      const text = String(body.clientResponse.message || '').trim();
      const mediaUrl = body.clientResponse.fileData?.mediaUrl || null;
      const messageType = mediaUrl ? 'image' : 'text';

      if (!mobile) {
        console.warn('[whatsappWebhookHandler] clientResponse with no sender:', body);
        return;
      }

      const displayText = text || (mediaUrl ? '[Image/Attachment]' : '(message)');

      // A) Update WhatsAppConversations & WhatsAppMessages (WhatsApp Inbox view)
      try {
        const convResult = await pool.request()
          .input('CustomerMobile', sql.VarChar(20), mobile)
          .input('CustomerName', sql.VarChar(100), null)
          .input('LastMessageText', sql.VarChar(500), displayText.slice(0, 500))
          .input('IncrementUnread', sql.Bit, 1)
          .output('ConversationId', sql.Int)
          .execute('usp_WhatsApp_UpsertConversation');

        const conversationId = convResult.output.ConversationId;

        await pool.request()
          .input('ConversationId', sql.Int, conversationId)
          .input('Direction', sql.VarChar(3), 'IN')
          .input('MessageType', sql.VarChar(20), messageType)
          .input('Content', sql.NVarChar(sql.MAX), text || (mediaUrl ? '[Image/Attachment]' : null))
          .input('MediaUrl', sql.VarChar(1000), mediaUrl)
          .input('RequestId', sql.VarChar(100), null)
          .input('DeliveryStatus', sql.VarChar(20), 'received')
          .input('AgentId', sql.Int, null)
          .input('ClientTempId', sql.VarChar(50), null)
          .output('MessageId', sql.Int)
          .execute('usp_WhatsApp_InsertMessage');
      } catch (waErr) {
        console.error('[whatsappWebhookHandler] WhatsApp inbox store error:', waErr.message);
      }

      // B) Update Tickets & TicketMessages (Ticketing view)
      try {
        const ticketId = await getOrCreateTicketForMobile(pool, mobile);

        await pool
          .request()
          .input('TicketID', sql.VarChar(20), ticketId)
          .input('SenderType', sql.VarChar(10), 'Customer')
          .input('SenderName', sql.NVarChar(100), null)
          .input('MessageText', sql.NVarChar(sql.MAX), displayText)
          .input('MessageType', sql.VarChar(20), messageType)
          .input('MediaURL', sql.NVarChar(500), mediaUrl)
          .input('WaMessageId', sql.VarChar(100), null)
          .input('DeliveryStatus', sql.VarChar(20), 'received')
          .execute('usp_AddMessage');

        console.log(
          `[whatsappWebhookHandler] IN from ${mobile} -> ticket=${ticketId}, text="${displayText.slice(0, 60)}"`
        );
      } catch (tktErr) {
        console.error('[whatsappWebhookHandler] Ticket store error:', tktErr.message);
      }

      return;
    }

    // 3. Status update for sent message
    if (body.status && body.requestId) {
      const requestId = String(body.requestId);
      const status = String(body.status).toLowerCase();
      const failedReason = body.failedReason || null;

      // Update TicketMessages
      const ticketResult = await pool
        .request()
        .input('WaMessageId', sql.VarChar(100), requestId)
        .input('DeliveryStatus', sql.VarChar(30), status)
        .input('FailureReason', sql.NVarChar(500), failedReason)
        .query(`
          UPDATE TicketMessages
          SET DeliveryStatus = @DeliveryStatus,
              FailureReason = COALESCE(@FailureReason, FailureReason)
          WHERE WaMessageId = @WaMessageId
        `);

      // Update WhatsAppMessages
      const waResult = await pool
        .request()
        .input('RequestId', sql.VarChar(100), requestId)
        .input('DeliveryStatus', sql.VarChar(20), status)
        .input('FailureReason', sql.VarChar(500), failedReason)
        .execute('usp_WhatsApp_UpdateMessageStatusByRequestId');

      let ticketRows = ticketResult.rowsAffected?.[0] || 0;
      let waRows = waResult.recordset?.length || 0;

      // Fallback: if WhatsAppMessages had 0 rows by RequestId but we have receiver mobile
      if (waRows === 0 && body.receiver) {
        const last10 = String(body.receiver).replace(/\D/g, '').slice(-10);
        const fbRes = await pool.request()
          .input('Last10', sql.VarChar(10), last10)
          .input('DeliveryStatus', sql.VarChar(20), status)
          .input('FailureReason', sql.VarChar(500), failedReason)
          .input('RequestId', sql.VarChar(100), requestId)
          .query(`
            WITH TargetMsg AS (
              SELECT TOP (1) wm.DeliveryStatus, wm.FailureReason, wm.RequestId
              FROM WhatsAppMessages wm
              JOIN WhatsAppConversations wc ON wc.ConversationId = wm.ConversationId
              WHERE RIGHT(wc.CustomerMobile, 10) = @Last10
                AND wm.Direction = 'OUT'
              ORDER BY wm.CreatedAt DESC
            )
            UPDATE TargetMsg
            SET DeliveryStatus = @DeliveryStatus,
                FailureReason = COALESCE(@FailureReason, FailureReason),
                RequestId = COALESCE(RequestId, @RequestId);
          `);
        waRows = fbRes.rowsAffected?.[0] || 0;
      }

      console.log(
        `[whatsappWebhookHandler] status=${status} for requestId=${requestId} (TicketMessages:${ticketRows}, WhatsAppMessages:${waRows})${failedReason ? ` reason="${failedReason}"` : ''}`
      );
      return;
    }

    console.warn('[whatsappWebhookHandler] unhandled payload shape:', body);
  } catch (err) {
    console.error('[whatsappWebhookHandler] general error:', err.message);
  }
}

/**
 * Debug endpoint to inspect recent raw webhooks
 */
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
  getRecentWebhookLogs,
};
