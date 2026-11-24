// controllers/whatsappController.js
const { getPool, sql } = require('../config/db');
const {
  normalizeMobile,
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendLocationMessage,
  sendContactMessage,
  getApprovedTemplates,
} = require('../services/msgclub.service');
const { isWindowOpenForMobile } = require('../services/waHelpers');

/**
 * Helper: Find or create ticket for mobile to keep Tickets in sync with WhatsApp
 */
async function syncTicketForMobile(pool, mobile, customerName, text, senderType, waMessageId, deliveryStatus, mediaUrl = null, mediaType = 'text') {
  try {
    const existing = await pool.request()
      .input('Mobile', sql.VarChar(15), mobile)
      .query('SELECT TOP 1 TicketID FROM Tickets WHERE MobileNumber = @Mobile ORDER BY CreatedAt DESC');

    let ticketId;
    if (existing.recordset?.length) {
      ticketId = existing.recordset[0].TicketID;
    } else {
      const seqResult = await pool.request()
        .output('NewTicketID', sql.VarChar(20))
        .execute('usp_GetNextTicketNumber');
      ticketId = seqResult.output.NewTicketID;

      await pool.request()
        .input('TicketID', sql.VarChar(20), ticketId)
        .input('CustomerName', sql.NVarChar(100), customerName || null)
        .input('MobileNumber', sql.VarChar(15), mobile)
        .input('Subject', sql.NVarChar(255), `WhatsApp - ${mobile}`)
        .query(`
          INSERT INTO Tickets (TicketID, CustomerName, MobileNumber, Subject, Status)
          VALUES (@TicketID, @CustomerName, @MobileNumber, @Subject, 'Open')
        `);
    }

    await pool.request()
      .input('TicketID', sql.VarChar(20), ticketId)
      .input('SenderType', sql.VarChar(10), senderType)
      .input('SenderName', sql.NVarChar(100), senderType === 'Customer' ? customerName : 'Agent')
      .input('MessageText', sql.NVarChar(sql.MAX), text || (mediaUrl ? `[Media: ${mediaType}]` : '(empty)'))
      .input('MessageType', sql.VarChar(20), mediaUrl ? (mediaType || 'image') : (mediaType || 'text'))
      .input('MediaURL', sql.NVarChar(500), mediaUrl || null)
      .input('WaMessageId', sql.VarChar(100), waMessageId || null)
      .input('DeliveryStatus', sql.VarChar(20), deliveryStatus || 'sent')
      .execute('usp_AddMessage');

    return ticketId;
  } catch (err) {
    console.warn('[syncTicketForMobile] non-fatal ticket sync error:', err.message);
    return null;
  }
}

// GET /api/whatsapp/conversations
async function getConversations(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().execute('usp_WhatsApp_GetConversations');
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('[getConversations]', err);
    res.status(500).json({ success: false, message: 'Failed to load conversations' });
  }
}

// GET /api/whatsapp/conversations/:conversationId/messages
async function getMessages(req, res) {
  const { conversationId } = req.params;
  try {
    const pool = await getPool();

    // Load messages
    const result = await pool.request()
      .input('ConversationId', sql.Int, conversationId)
      .execute('usp_WhatsApp_GetMessagesByConversation');

    // Opportunistically clear unread count when opened
    await pool.request()
      .input('ConversationId', sql.Int, conversationId)
      .execute('usp_WhatsApp_MarkConversationRead');

    // Fetch conversation details to check 24h window
    const convRow = await pool.request()
      .input('ConversationId', sql.Int, conversationId)
      .query('SELECT CustomerMobile, CustomerName FROM WhatsAppConversations WHERE ConversationId = @ConversationId');

    const customerMobile = convRow.recordset?.[0]?.CustomerMobile || null;
    const customerName = convRow.recordset?.[0]?.CustomerName || null;

    let isWindowOpen = false;
    if (customerMobile) {
      isWindowOpen = await isWindowOpenForMobile(pool, customerMobile);
    }

    const data = result.recordset.map((row) => ({
      messageId: row.MessageId,
      conversationId: row.ConversationId,
      direction: row.Direction,
      messageType: row.MessageType,
      content: row.Content,
      mediaUrl: row.MediaUrl,
      requestId: row.RequestId,
      deliveryStatus: row.DeliveryStatus,
      failureReason: row.FailureReason,
      agentId: row.AgentId,
      clientTempId: row.ClientTempId,
      createdAt: row.CreatedAt,
    }));

    res.json({
      success: true,
      data,
      isWindowOpen,
      customerMobile,
      customerName,
    });
  } catch (err) {
    console.error('[getMessages]', err);
    res.status(500).json({ success: false, message: 'Failed to load messages' });
  }
}

// POST /api/whatsapp/conversations/:conversationId/send
// body: { text, clientTempId, agentId, templateName, mediaUrl, mediaType, location, contact }
async function sendMessage(req, res) {
  const { conversationId } = req.params;
  const { text, clientTempId, agentId, templateName, mediaUrl, mediaType, location, contact } = req.body;

  if (!text && !templateName && !mediaUrl && !location && !contact) {
    return res.status(400).json({ success: false, message: 'Message content is required' });
  }

  try {
    const pool = await getPool();

    const convRow = await pool.request()
      .input('ConversationId', sql.Int, conversationId)
      .query('SELECT CustomerMobile, CustomerName FROM WhatsAppConversations WHERE ConversationId = @ConversationId');

    const customerMobile = convRow.recordset?.[0]?.CustomerMobile;
    const customerName = convRow.recordset?.[0]?.CustomerName;

    if (!customerMobile) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    let msgClubResult;
    let messageType = 'text';
    let messageContent = (text || '').trim();
    let computedMediaUrl = mediaUrl || null;

    if (location || mediaType === 'location') {
      messageType = 'location';
      const locObj = typeof location === 'object' ? location : JSON.parse(text || '{}');
      messageContent = JSON.stringify(locObj);
      computedMediaUrl = `https://maps.google.com/?q=${locObj.latitude},${locObj.longitude}`;
      msgClubResult = await sendLocationMessage(customerMobile, locObj);
    } else if (contact || mediaType === 'contact') {
      messageType = 'contact';
      const conObj = typeof contact === 'object' ? contact : JSON.parse(text || '{}');
      messageContent = JSON.stringify(conObj);
      computedMediaUrl = conObj.phone ? `tel:${conObj.phone}` : null;
      msgClubResult = await sendContactMessage(customerMobile, conObj);
    } else if (mediaUrl) {
      messageType = mediaType || 'image';
      msgClubResult = await sendMediaMessage(customerMobile, messageType, mediaUrl, messageContent);
    } else if (templateName && templateName !== 'ticket_acknowledgement') {
      messageType = 'template';
      messageContent = text ? text.trim() : `[Template: ${templateName}]`;
      msgClubResult = await sendTemplateMessage({
        mobileNumber: customerMobile,
        templateName,
        language: 'en',
      });
    } else {
      // Normal free-form text message (e.g. "hi") - send exactly as typed!
      messageType = 'text';
      msgClubResult = await sendTextMessage(customerMobile, messageContent);
    }

    const isSuccess = msgClubResult?.success !== false && !!msgClubResult?.requestId;
    const requestId = msgClubResult?.requestId || null;
    const deliveryStatus = isSuccess ? 'sent' : 'failed';
    const failureReason = !isSuccess ? (msgClubResult?.error || 'Failed to dispatch') : null;

    // Persist OUT message in WhatsAppMessages
    const insertReq = pool.request()
      .input('ConversationId', sql.Int, conversationId)
      .input('Direction', sql.VarChar(3), 'OUT')
      .input('MessageType', sql.VarChar(20), messageType)
      .input('Content', sql.NVarChar(sql.MAX), messageContent)
      .input('MediaUrl', sql.VarChar(1000), computedMediaUrl)
      .input('RequestId', sql.VarChar(100), requestId)
      .input('DeliveryStatus', sql.VarChar(20), deliveryStatus)
      .input('AgentId', sql.Int, agentId || null)
      .input('ClientTempId', sql.VarChar(50), clientTempId || null)
      .output('MessageId', sql.Int);

    const insertResult = await insertReq.execute('usp_WhatsApp_InsertMessage');
    const messageId = insertResult.output.MessageId;

    // Bump conversation last message
    await pool.request()
      .input('CustomerMobile', sql.VarChar(20), customerMobile)
      .input('CustomerName', sql.VarChar(100), customerName || null)
      .input('LastMessageText', sql.VarChar(500), (messageContent || `[${messageType}]`).slice(0, 500))
      .input('IncrementUnread', sql.Bit, 0)
      .output('ConversationId', sql.Int)
      .execute('usp_WhatsApp_UpsertConversation');

    // Sync to Tickets & TicketMessages in background
    syncTicketForMobile(
      pool,
      customerMobile,
      customerName,
      messageContent,
      'Agent',
      requestId,
      deliveryStatus,
      computedMediaUrl,
      messageType
    );

    const messagePayload = {
      messageId,
      conversationId: Number(conversationId),
      direction: 'OUT',
      messageType,
      content: messageContent,
      mediaUrl: computedMediaUrl,
      requestId,
      deliveryStatus,
      failureReason,
      clientTempId: clientTempId || null,
      createdAt: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: messagePayload,
      sendFailed: !isSuccess,
      error: failureReason,
    });
  } catch (err) {
    console.error('[sendMessage]', err);
    res.status(500).json({ success: false, message: 'Failed to send message', detail: err.message });
  }
}

// POST /api/whatsapp/conversations/initiate
// Initiate or send message directly to an individual mobile number (new or existing)
// body: { mobileNumber, customerName, text, templateName, agentId, mediaUrl, mediaType, location, contact }
async function initiateConversation(req, res) {
  const { mobileNumber, customerName, text, templateName, agentId, mediaUrl, mediaType, location, contact } = req.body;

  if (!mobileNumber || (!text && !templateName && !mediaUrl && !location && !contact)) {
    return res.status(400).json({
      success: false,
      message: 'mobileNumber and message content are required',
    });
  }

  const normalized = normalizeMobile(mobileNumber);
  if (!normalized || normalized.length < 10) {
    return res.status(400).json({
      success: false,
      message: 'Invalid mobile number format. Provide 10 digits or international format (e.g. 919999999999)',
    });
  }

  try {
    const pool = await getPool();

    let messageType = 'text';
    let messageContent = (text || '').trim();
    let msgClubResult;
    let computedMediaUrl = mediaUrl || null;

    if (location || mediaType === 'location') {
      messageType = 'location';
      const locObj = typeof location === 'object' ? location : JSON.parse(text || '{}');
      messageContent = JSON.stringify(locObj);
      computedMediaUrl = `https://maps.google.com/?q=${locObj.latitude},${locObj.longitude}`;
      msgClubResult = await sendLocationMessage(normalized, locObj);
    } else if (contact || mediaType === 'contact') {
      messageType = 'contact';
      const conObj = typeof contact === 'object' ? contact : JSON.parse(text || '{}');
      messageContent = JSON.stringify(conObj);
      computedMediaUrl = conObj.phone ? `tel:${conObj.phone}` : null;
      msgClubResult = await sendContactMessage(normalized, conObj);
    } else if (mediaUrl) {
      messageType = mediaType || 'image';
      msgClubResult = await sendMediaMessage(normalized, messageType, mediaUrl, messageContent);
    } else if (templateName && templateName !== 'ticket_acknowledgement') {
      messageType = 'template';
      messageContent = text ? text.trim() : `[Template: ${templateName}]`;
      msgClubResult = await sendTemplateMessage({
        mobileNumber: normalized,
        templateName,
        language: 'en',
      });
    } else {
      // Normal free-form text (e.g. "hi") - send exactly as typed!
      messageType = 'text';
      msgClubResult = await sendTextMessage(normalized, messageContent);
    }

    const isSuccess = msgClubResult?.success !== false && !!msgClubResult?.requestId;
    const requestId = msgClubResult?.requestId || null;
    const deliveryStatus = isSuccess ? 'sent' : 'failed';
    const failureReason = !isSuccess ? (msgClubResult?.error || 'Failed to dispatch') : null;

    // Upsert conversation
    const upsertRes = await pool.request()
      .input('CustomerMobile', sql.VarChar(20), normalized)
      .input('CustomerName', sql.VarChar(100), customerName ? customerName.trim() : null)
      .input('LastMessageText', sql.VarChar(500), (messageContent || `[${messageType}]`).slice(0, 500))
      .input('IncrementUnread', sql.Bit, 0)
      .output('ConversationId', sql.Int)
      .execute('usp_WhatsApp_UpsertConversation');

    const conversationId = upsertRes.output.ConversationId;

    // Insert message into WhatsAppMessages
    const insertReq = pool.request()
      .input('ConversationId', sql.Int, conversationId)
      .input('Direction', sql.VarChar(3), 'OUT')
      .input('MessageType', sql.VarChar(20), messageType)
      .input('Content', sql.NVarChar(sql.MAX), messageContent || `[${messageType}]`)
      .input('MediaUrl', sql.VarChar(1000), computedMediaUrl)
      .input('RequestId', sql.VarChar(100), requestId)
      .input('DeliveryStatus', sql.VarChar(20), deliveryStatus)
      .input('AgentId', sql.Int, agentId || null)
      .input('ClientTempId', sql.VarChar(50), null)
      .output('MessageId', sql.Int);

    const insertResult = await insertReq.execute('usp_WhatsApp_InsertMessage');
    const messageId = insertResult.output.MessageId;

    // Sync to Tickets
    syncTicketForMobile(
      pool,
      normalized,
      customerName,
      messageContent,
      'Agent',
      requestId,
      deliveryStatus,
      computedMediaUrl,
      messageType
    );

    const messagePayload = {
      messageId,
      conversationId: Number(conversationId),
      direction: 'OUT',
      messageType,
      content: messageContent,
      mediaUrl: computedMediaUrl,
      requestId,
      deliveryStatus,
      failureReason,
      createdAt: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: {
        conversationId,
        customerMobile: normalized,
        customerName: customerName || null,
        message: messagePayload,
        sendFailed: !isSuccess,
        error: failureReason,
      },
    });
  } catch (err) {
    console.error('[initiateConversation]', err);
    res.status(500).json({ success: false, message: 'Failed to initiate conversation', detail: err.message });
  }
}

// DELETE /api/whatsapp/conversations/:conversationId
async function deleteConversation(req, res) {
  const { conversationId } = req.params;
  try {
    const pool = await getPool();
    await pool.request()
      .input('ConversationId', sql.Int, conversationId)
      .query(`
        DELETE FROM WhatsAppMessages WHERE ConversationId = @ConversationId;
        DELETE FROM WhatsAppConversations WHERE ConversationId = @ConversationId;
      `);
    return res.json({ success: true, message: 'Conversation deleted successfully' });
  } catch (err) {
    console.error('[deleteConversation]', err);
    return res.status(500).json({ success: false, message: 'Failed to delete conversation', detail: err.message });
  }
}

// DELETE /api/whatsapp/conversations/:conversationId/messages/:messageId
async function deleteMessage(req, res) {
  const { conversationId, messageId } = req.params;
  try {
    const pool = await getPool();
    await pool.request()
      .input('ConversationId', sql.Int, conversationId)
      .input('MessageId', sql.Int, messageId)
      .query(`
        DELETE FROM WhatsAppMessages WHERE ConversationId = @ConversationId AND MessageId = @MessageId;
      `);
    return res.json({ success: true, message: 'Message deleted successfully' });
  } catch (err) {
    console.error('[deleteMessage]', err);
    return res.status(500).json({ success: false, message: 'Failed to delete message', detail: err.message });
  }
}

// GET /api/whatsapp/templates
async function getTemplates(req, res) {
  try {
    const templates = await getApprovedTemplates('APPROVED');
    res.json({ success: true, data: templates });
  } catch (err) {
    console.error('[getTemplates]', err);
    res.status(500).json({ success: false, message: 'Failed to load templates' });
  }
}

module.exports = {
  getConversations,
  getMessages,
  sendMessage,
  initiateConversation,
  deleteConversation,
  deleteMessage,
  getTemplates,
};
