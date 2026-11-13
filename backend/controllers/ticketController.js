const { getPool, sql } = require('../config/db');
const { sendTicketAcknowledgement, sendTextMessage } = require('../config/whatsapp');

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
    const { message } = req.body;
    const agentName = req.user?.username || 'Agent';

    if (!message) {
      return res.status(400).json({ success: false, message: 'message is required' });
    }

    const pool = await getPool();

    const ticketResult = await pool.request()
      .input('TicketID', sql.VarChar(20), id)
      .execute('usp_GetTicketById');

    const ticket = ticketResult.recordset[0];
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // Push the reply out over WhatsApp. This only works inside the 24h
    // session window opened by the customer's last incoming message -
    // MsgClub will reject/no-op sends outside that window. We still save
    // the message either way, but flag sendFailed so the UI can warn the agent.
    let waMessageId = null;
    let sendFailed = false;
    try {
      const waResult = await sendTextMessage(ticket.MobileNumber, message);
      waMessageId =
        waResult?.messages?.[0]?.id ||
        waResult?.messageId ||
        waResult?.response ||
        null;
      if (!waMessageId) {
        sendFailed = true;
        console.warn('WhatsApp reply send: no message id in response, check 24h window / payload shape:', waResult);
      }
    } catch (waErr) {
      sendFailed = true;
      console.error('WhatsApp reply send failed:', waErr);
    }

    const result = await pool.request()
      .input('TicketID', sql.VarChar(20), id)
      .input('SenderType', sql.VarChar(10), 'Agent')
      .input('SenderName', sql.NVarChar(100), agentName)
      .input('MessageText', sql.NVarChar(sql.MAX), message)
      .input('MessageType', sql.VarChar(20), 'text')
      .input('MediaURL', sql.NVarChar(500), null)
      .input('WaMessageId', sql.VarChar(100), waMessageId)
      .execute('usp_AddMessage');

    return res.json({ success: true, sendFailed, data: result.recordset });
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
    const { mobileNumber, customerName, message } = req.body;
    const agentName = req.user?.username || 'Agent';

    if (!mobileNumber || !message) {
      return res.status(400).json({ success: false, message: 'mobileNumber and message are required' });
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
    try {
      const waResult = await sendTextMessage(mobileNumber, message);
      waMessageId = waResult?.messages?.[0]?.id || waResult?.response || null;
      if (!waMessageId) sendFailed = true;
    } catch (waErr) {
      console.error('startNewConversation send failed:', waErr);
      sendFailed = true;
    }

    const result = await pool.request()
      .input('TicketID', sql.VarChar(20), ticketId)
      .input('SenderType', sql.VarChar(10), 'Agent')
      .input('SenderName', sql.NVarChar(100), agentName)
      .input('MessageText', sql.NVarChar(sql.MAX), message)
      .input('MessageType', sql.VarChar(20), 'text')
      .input('MediaURL', sql.NVarChar(500), null)
      .input('WaMessageId', sql.VarChar(100), waMessageId)
      .execute('usp_AddMessage');

    return res.json({
      success: true,
      data: { ticketId, isNewTicket, sendFailed, messages: result.recordset }
    });
  } catch (err) {
    console.error('startNewConversation error:', err);
    return res.status(500).json({ success: false, message: 'Failed to start conversation' });
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
  startNewConversation
};