const { getPool, sql } = require('../config/db');
const {
  sendTicketAcknowledgement,
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendLocationMessage,
  sendContactMessage,
} = require('../config/whatsapp');
const { isWindowOpenForMobile } = require('../services/waHelpers');

/**
 * PUBLIC: Customer submits a new query -> creates a ticket,
 * sends back the ticket ID, and fires a WhatsApp acknowledgement.
 * POST /api/tickets
 */
async function createTicket(req, res) {
  try {
    const { customerName, mobileNumber, subject, message } = req.body;

    if (!mobileNumber || !message) {
      return res.status(400).json({ success: false, message: 'mobileNumber and message are required' });
    }

    const pool = await getPool();

    // 1. Get next ticket ID
    const seqResult = await pool.request()
      .output('NewTicketID', sql.VarChar(20))
      .execute('usp_GetNextTicketNumber');
    const ticketId = seqResult.output.NewTicketID;

    // 2. Create ticket + first message
    const result = await pool.request()
      .input('TicketID', sql.VarChar(20), ticketId)
      .input('CustomerName', sql.NVarChar(100), customerName ?? null)
      .input('MobileNumber', sql.VarChar(15), mobileNumber)
      .input('Subject', sql.NVarChar(255), subject ?? null)
      .input('MessageText', sql.NVarChar(sql.MAX), message)
      .execute('usp_CreateTicket');

    const ticket = result.recordset[0];

    // 3. Fire-and-forget WhatsApp acknowledgement (does not block response on failure)
    sendTicketAcknowledgement(mobileNumber, ticketId).catch((err) =>
      console.error('Ack send failed:', err)
    );

    return res.json({ success: true, data: { ticket, ticketId } });
  } catch (err) {
    console.error('createTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create ticket' });
  }
}

/**
 * PUBLIC: Customer adds a follow-up message to an existing ticket.
 * Requires ticketId + mobileNumber to match, as a lightweight ownership check.
 * POST /api/tickets/:id/messages/customer
 */
async function addCustomerMessage(req, res) {
  try {
    const { id } = req.params;
    const { mobileNumber, message } = req.body;

    if (!mobileNumber || !message) {
      return res.status(400).json({ success: false, message: 'mobileNumber and message are required' });
    }

    const pool = await getPool();

    const ticketResult = await pool.request()
      .input('TicketID', sql.VarChar(20), id)
      .execute('usp_GetTicketById');

    const ticket = ticketResult.recordset[0];
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    if (ticket.MobileNumber !== mobileNumber) {
      return res.status(403).json({ success: false, message: 'Mobile number does not match this ticket' });
    }

    const result = await pool.request()
      .input('TicketID', sql.VarChar(20), id)
      .input('SenderType', sql.VarChar(10), 'Customer')
      .input('SenderName', sql.NVarChar(100), ticket.CustomerName ?? null)
      .input('MessageText', sql.NVarChar(sql.MAX), message)
      .execute('usp_AddMessage');

    return res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('addCustomerMessage error:', err);
    return res.status(500).json({ success: false, message: 'Failed to add message' });
  }
}

/**
 * PUBLIC: Customer views the full thread for their ticket.
 * GET /api/tickets/:id?mobileNumber=xxxx
 */
async function getTicketThreadPublic(req, res) {
  try {
    const { id } = req.params;
    const { mobileNumber } = req.query;

    const pool = await getPool();

    const ticketResult = await pool.request()
      .input('TicketID', sql.VarChar(20), id)
      .execute('usp_GetTicketById');

    const ticket = ticketResult.recordset[0];
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    if (mobileNumber && ticket.MobileNumber !== mobileNumber) {
      return res.status(403).json({ success: false, message: 'Mobile number does not match this ticket' });
    }

    const messagesResult = await pool.request()
      .input('TicketID', sql.VarChar(20), id)
      .execute('usp_GetMessagesByTicket');

    return res.json({ success: true, data: { ticket, messages: messagesResult.recordset } });
  } catch (err) {
    console.error('getTicketThreadPublic error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch ticket' });
  }
}

/**
 * INTERNAL (JWT protected): List all tickets, optional ?status= filter.
 * GET /api/internal/tickets
 */
async function getAllTickets(req, res) {
  try {
    const { status } = req.query;
    const pool = await getPool();

    const result = await pool.request()
      .input('Status', sql.VarChar(20), status ?? null)
      .execute('usp_GetAllTickets');

    return res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('getAllTickets error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch tickets' });
  }
}

/**
 * INTERNAL (JWT protected): Get full thread for a ticket (agent view).
 * GET /api/internal/tickets/:id
 */
async function getTicketThreadInternal(req, res) {
  try {
    const { id } = req.params;
    const pool = await getPool();

    const ticketResult = await pool.request()
      .input('TicketID', sql.VarChar(20), id)
      .execute('usp_GetTicketById');

    const ticket = ticketResult.recordset[0];
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const messagesResult = await pool.request()
      .input('TicketID', sql.VarChar(20), id)
      .execute('usp_GetMessagesByTicket');

    return res.json({ success: true, data: { ticket, messages: messagesResult.recordset } });
  } catch (err) {
    console.error('getTicketThreadInternal error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch ticket' });
  }
}

/**
 * INTERNAL (JWT protected): Agent replies to a ticket.
 * Sends the reply out over WhatsApp via MsgClub's v3 sendChat API, then
 * logs it against the ticket (with the WhatsApp message id, so a later
 * delivery-status webhook can be matched back to this row).
 * POST /api/internal/tickets/:id/messages
 */
async function addAgentMessage(req, res) {
  try {
    const { id } = req.params;
    const { message, templateName, mediaUrl, mediaType, location, contact } = req.body;
    const agentName = req.user?.username || 'Agent';

    if (!message && !templateName && !mediaUrl && !location && !contact) {
      return res.status(400).json({ success: false, message: 'message, media, or templateName is required' });
    }

    const pool = await getPool();

    const ticketResult = await pool.request()
      .input('TicketID', sql.VarChar(20), id)
      .execute('usp_GetTicketById');

    const ticket = ticketResult.recordset[0];
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    let waMessageId = null;
    let sendFailed = false;
    let usedTemplate = false;
    let computedMediaUrl = mediaUrl || null;
    let finalMsgType = 'text';

    try {
      let waResult;
      if (location || mediaType === 'location') {
        finalMsgType = 'location';
        const locObj = typeof location === 'object' ? location : JSON.parse(message || '{}');
        computedMediaUrl = `https://maps.google.com/?q=${locObj.latitude},${locObj.longitude}`;
        waResult = await sendLocationMessage(ticket.MobileNumber, locObj);
      } else if (contact || mediaType === 'contact') {
        finalMsgType = 'contact';
        const conObj = typeof contact === 'object' ? contact : JSON.parse(message || '{}');
        computedMediaUrl = conObj.phone ? `tel:${conObj.phone}` : null;
        waResult = await sendContactMessage(ticket.MobileNumber, conObj);
      } else if (mediaUrl) {
        finalMsgType = mediaType || 'image';
        waResult = await sendMediaMessage(ticket.MobileNumber, finalMsgType, mediaUrl, message || '');
      } else if (templateName && templateName !== 'ticket_acknowledgement') {
        usedTemplate = true;
        finalMsgType = 'template';
        waResult = await sendTemplateMessage({
          mobileNumber: ticket.MobileNumber,
          templateName,
          language: 'en'
        });
      } else {
        // Send free-form text as is (e.g. "hi") - do NOT force-replace with welcome_msg!
        finalMsgType = 'text';
        waResult = await sendTextMessage(ticket.MobileNumber, message);
      }

      waMessageId =
        waResult?.requestId ||
        waResult?.response ||
        waResult?.messages?.[0]?.id ||
        waResult?.messageId ||
        null;

      if (!waMessageId || waResult?.success === false) {
        sendFailed = true;
        console.warn('WhatsApp send rejected or no request id:', waResult);
      }
    } catch (waErr) {
      sendFailed = true;
      console.error('WhatsApp send failed:', waErr);
    }

    const storedText = usedTemplate
      ? (message ? `${message}\n[WhatsApp Template: ${templateName}]` : `[WhatsApp Template: ${templateName}]`)
      : (message || (computedMediaUrl ? `[Media: ${finalMsgType}]` : ''));

    const result = await pool.request()
      .input('TicketID', sql.VarChar(20), id)
      .input('SenderType', sql.VarChar(10), 'Agent')
      .input('SenderName', sql.NVarChar(100), agentName)
      .input('MessageText', sql.NVarChar(sql.MAX), storedText)
      .input('MessageType', sql.VarChar(20), finalMsgType)
      .input('MediaURL', sql.NVarChar(500), computedMediaUrl)
      .input('WaMessageId', sql.VarChar(100), waMessageId)
      .execute('usp_AddMessage');

    // Sync to WhatsAppConversations & WhatsAppMessages
    try {
      const convUpsert = await pool.request()
        .input('CustomerMobile', sql.VarChar(20), ticket.MobileNumber)
        .input('CustomerName', sql.VarChar(100), ticket.CustomerName || null)
        .input('LastMessageText', sql.VarChar(500), storedText.slice(0, 500))
        .input('IncrementUnread', sql.Bit, 0)
        .output('ConversationId', sql.Int)
        .execute('usp_WhatsApp_UpsertConversation');

      const convId = convUpsert.output.ConversationId;
      await pool.request()
        .input('ConversationId', sql.Int, convId)
        .input('Direction', sql.VarChar(3), 'OUT')
        .input('MessageType', sql.VarChar(20), finalMsgType)
        .input('Content', sql.NVarChar(sql.MAX), storedText)
        .input('MediaUrl', sql.VarChar(1000), computedMediaUrl)
        .input('RequestId', sql.VarChar(100), waMessageId)
        .input('DeliveryStatus', sql.VarChar(20), sendFailed ? 'failed' : 'sent')
        .input('AgentId', sql.Int, null)
        .input('ClientTempId', sql.VarChar(50), null)
        .output('MessageId', sql.Int)
        .execute('usp_WhatsApp_InsertMessage');
    } catch (syncErr) {
      console.warn('[addAgentMessage] WhatsApp inbox sync error:', syncErr.message);
    }

    return res.json({
      success: true,
      sendFailed,
      usedTemplate,
      requestId: waMessageId,
      data: result.recordset
    });
  } catch (err) {
    console.error('addAgentMessage error:', err);
    return res.status(500).json({ success: false, message: 'Failed to add message' });
  }
}

/**
 * INTERNAL (JWT protected): Agent starts a brand-new conversation to a
 * mobile number. Reuses an existing ticket for that number if one already
 * exists; otherwise creates one.
 * POST /api/internal/tickets/new
 */
async function startNewConversation(req, res) {
  try {
    const { mobileNumber, customerName, message, templateName, mediaUrl, mediaType, location, contact } = req.body;
    const agentName = req.user?.username || 'Agent';

    if (!mobileNumber || (!message && !templateName && !mediaUrl && !location && !contact)) {
      return res.status(400).json({ success: false, message: 'mobileNumber and message content are required' });
    }

    const pool = await getPool();

    const existing = await pool.request()
      .input('Mobile', sql.VarChar(15), mobileNumber)
      .query(`
        SELECT TOP 1 TicketID FROM Tickets
        WHERE MobileNumber = @Mobile
        ORDER BY CreatedAt DESC
      `);

    let ticketId;
    let isNewTicket = false;

    if (existing.recordset?.length) {
      ticketId = existing.recordset[0].TicketID;
    } else {
      const seqResult = await pool.request()
        .output('NewTicketID', sql.VarChar(20))
        .execute('usp_GetNextTicketNumber');
      ticketId = seqResult.output.NewTicketID;
      isNewTicket = true;

      await pool.request()
        .input('TicketID', sql.VarChar(20), ticketId)
        .input('CustomerName', sql.NVarChar(100), customerName ?? null)
        .input('MobileNumber', sql.VarChar(15), mobileNumber)
        .input('Subject', sql.NVarChar(255), `WhatsApp - ${mobileNumber}`)
        .query(`
          INSERT INTO Tickets (TicketID, CustomerName, MobileNumber, Subject, Status)
          VALUES (@TicketID, @CustomerName, @MobileNumber, @Subject, 'Open')
        `);
    }

    let waMessageId = null;
    let sendFailed = false;
    let usedTemplate = false;
    let computedMediaUrl = mediaUrl || null;
    let finalMsgType = 'text';

    try {
      let waResult;
      if (location || mediaType === 'location') {
        finalMsgType = 'location';
        const locObj = typeof location === 'object' ? location : JSON.parse(message || '{}');
        computedMediaUrl = `https://maps.google.com/?q=${locObj.latitude},${locObj.longitude}`;
        waResult = await sendLocationMessage(mobileNumber, locObj);
      } else if (contact || mediaType === 'contact') {
        finalMsgType = 'contact';
        const conObj = typeof contact === 'object' ? contact : JSON.parse(message || '{}');
        computedMediaUrl = conObj.phone ? `tel:${conObj.phone}` : null;
        waResult = await sendContactMessage(mobileNumber, conObj);
      } else if (mediaUrl) {
        finalMsgType = mediaType || 'image';
        waResult = await sendMediaMessage(mobileNumber, finalMsgType, mediaUrl, message || '');
      } else if (templateName && templateName !== 'ticket_acknowledgement') {
        usedTemplate = true;
        finalMsgType = 'template';
        waResult = await sendTemplateMessage({
          mobileNumber,
          templateName,
          language: 'en'
        });
      } else {
        // Send free-form text directly
        finalMsgType = 'text';
        waResult = await sendTextMessage(mobileNumber, message);
      }

      waMessageId =
        waResult?.requestId ||
        waResult?.response ||
        waResult?.messages?.[0]?.id ||
        null;

      if (!waMessageId || waResult?.success === false) sendFailed = true;
    } catch (waErr) {
      console.error('startNewConversation send failed:', waErr);
      sendFailed = true;
    }

    const storedText = usedTemplate
      ? (message ? `${message}\n[WhatsApp Template: ${templateName}]` : `[WhatsApp Template: ${templateName}]`)
      : (message || (computedMediaUrl ? `[Media: ${finalMsgType}]` : ''));

    const result = await pool.request()
      .input('TicketID', sql.VarChar(20), ticketId)
      .input('SenderType', sql.VarChar(10), 'Agent')
      .input('SenderName', sql.NVarChar(100), agentName)
      .input('MessageText', sql.NVarChar(sql.MAX), storedText)
      .input('MessageType', sql.VarChar(20), finalMsgType)
      .input('MediaURL', sql.NVarChar(500), computedMediaUrl)
      .input('WaMessageId', sql.VarChar(100), waMessageId)
      .execute('usp_AddMessage');

    // Sync to WhatsAppConversations & WhatsAppMessages
    try {
      const convUpsert = await pool.request()
        .input('CustomerMobile', sql.VarChar(20), mobileNumber)
        .input('CustomerName', sql.VarChar(100), customerName || null)
        .input('LastMessageText', sql.VarChar(500), storedText.slice(0, 500))
        .input('IncrementUnread', sql.Bit, 0)
        .output('ConversationId', sql.Int)
        .execute('usp_WhatsApp_UpsertConversation');

      const convId = convUpsert.output.ConversationId;
      await pool.request()
        .input('ConversationId', sql.Int, convId)
        .input('Direction', sql.VarChar(3), 'OUT')
        .input('MessageType', sql.VarChar(20), finalMsgType)
        .input('Content', sql.NVarChar(sql.MAX), storedText)
        .input('MediaUrl', sql.VarChar(1000), computedMediaUrl)
        .input('RequestId', sql.VarChar(100), waMessageId)
        .input('DeliveryStatus', sql.VarChar(20), sendFailed ? 'failed' : 'sent')
        .input('AgentId', sql.Int, null)
        .input('ClientTempId', sql.VarChar(50), null)
        .output('MessageId', sql.Int)
        .execute('usp_WhatsApp_InsertMessage');
    } catch (syncErr) {
      console.warn('[startNewConversation] WhatsApp inbox sync error:', syncErr.message);
    }

    return res.json({
      success: true,
      data: {
        ticketId,
        isNewTicket,
        sendFailed,
        usedTemplate,
        requestId: waMessageId,
      }
    });
  } catch (err) {
    console.error('startNewConversation error:', err);
    return res.status(500).json({ success: false, message: 'Failed to start conversation' });
  }
}

// DELETE /api/internal/tickets/:id
async function deleteTicket(req, res) {
  const { id } = req.params;
  try {
    const pool = await getPool();
    await pool.request()
      .input('TicketID', sql.VarChar(20), id)
      .query(`
        DELETE FROM TicketMessages WHERE TicketID = @TicketID;
        DELETE FROM Tickets WHERE TicketID = @TicketID;
      `);
    return res.json({ success: true, message: 'Ticket deleted successfully' });
  } catch (err) {
    console.error('[deleteTicket]', err);
    return res.status(500).json({ success: false, message: 'Failed to delete ticket' });
  }
}

/**
 * INTERNAL (JWT protected): Update ticket status / assignment.
 * PUT /api/internal/tickets/:id/status
 */
async function updateTicketStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, assignedTo } = req.body;

    const validStatuses = ['Open', 'InProgress', 'Resolved', 'Closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of ${validStatuses.join(', ')}` });
    }

    const pool = await getPool();

    const result = await pool.request()
      .input('TicketID', sql.VarChar(20), id)
      .input('Status', sql.VarChar(20), status)
      .input('AssignedTo', sql.NVarChar(100), assignedTo ?? null)
      .execute('usp_UpdateTicketStatus');

    return res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    console.error('updateTicketStatus error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update ticket' });
  }
}
module.exports = {
  createTicket,
  addCustomerMessage,
  getTicketThreadPublic,
  getAllTickets,
  getTicketThreadInternal,
  addAgentMessage,
  updateTicketStatus,
  startNewConversation,
  deleteTicket,
};