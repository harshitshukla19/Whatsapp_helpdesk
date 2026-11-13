// controllers/whatsappController.js
const { getPool, sql } = require('../config/db');
const { sendTextMessage } = require('../services/msgclub.service');

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
// GET /api/whatsapp/conversations/:conversationId/messages
async function getMessages(req, res) {
    const { conversationId } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('ConversationId', sql.Int, conversationId)
            .execute('usp_WhatsApp_GetMessagesByConversation');

        // opportunistically clear unread count when agent opens the thread
        await pool.request()
            .input('ConversationId', sql.Int, conversationId)
            .execute('usp_WhatsApp_MarkConversationRead');

        // Normalize PascalCase SQL columns to the camelCase shape the frontend
        // (WhatsAppConversation.jsx) reads - matches the shape sendMessage()
        // already builds by hand for optimistic sends.
        const data = result.recordset.map((row) => ({
            messageId: row.MessageId,
            conversationId: row.ConversationId,
            direction: row.Direction,
            messageType: row.MessageType,
            content: row.Content,
            mediaUrl: row.MediaUrl,
            requestId: row.RequestId,
            deliveryStatus: row.DeliveryStatus,
            agentId: row.AgentId,
            clientTempId: row.ClientTempId,
            createdAt: row.CreatedAt,
        }));

        res.json({ success: true, data });
    } catch (err) {
        console.error('[getMessages]', err);
        res.status(500).json({ success: false, message: 'Failed to load messages' });
    }
}

// POST /api/whatsapp/conversations/:conversationId/send
// body: { text, clientTempId }
async function sendMessage(req, res) {
    const { conversationId } = req.params;
    const { text, clientTempId, agentId } = req.body;
    // No authMiddleware runs on this route (matches internalTicketRoutes'
    // no-auth pattern), so there's no req.user - agentId, if you want to
    // track who sent it, has to come from the request body itself.

    if (!text || !text.trim()) {
        return res.status(400).json({ success: false, message: 'Message text is required' });
    }

    try {
        const pool = await getPool();

        const convRow = await pool.request()
            .input('ConversationId', sql.Int, conversationId)
            .query('SELECT CustomerMobile FROM WhatsAppConversations WHERE ConversationId = @ConversationId');

        const customerMobile = convRow.recordset?.[0]?.CustomerMobile;
        if (!customerMobile) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        // 1. Actually send via MsgClub.
        // sendTextMessage() catches its own errors and returns { success: false, error }
        // instead of throwing - so check for that explicitly rather than relying on try/catch.
        const msgClubResult = await sendTextMessage(customerMobile, text.trim());

        if (msgClubResult && msgClubResult.success === false) {
            // Still record the attempt so the agent can see it failed in the thread,
            // instead of it silently vanishing.
            const failedInsert = pool.request()
                .input('ConversationId', sql.Int, conversationId)
                .input('Direction', sql.VarChar(3), 'OUT')
                .input('MessageType', sql.VarChar(20), 'text')
                .input('Content', sql.NVarChar(sql.MAX), text.trim())
                .input('MediaUrl', sql.VarChar(1000), null)
                .input('RequestId', sql.VarChar(100), null)
                .input('DeliveryStatus', sql.VarChar(20), 'failed')
                .input('AgentId', sql.Int, agentId)
                .input('ClientTempId', sql.VarChar(50), clientTempId || null)
                .output('MessageId', sql.Int);
            await failedInsert.execute('usp_WhatsApp_InsertMessage');

            return res.status(502).json({
                success: false,
                message: 'MsgClub rejected the message',
                detail: msgClubResult.error,
            });
        }

        // NOTE: MsgClub has no "Message ID" concept - only a "Request ID" (per
        // their support reply), and sendTextMessage() currently returns their raw
        // response body as-is. Log `msgClubResult` on your first real send to see
        // which key actually holds it, then trim this fallback chain down to that
        // one key.
        const requestId =
            msgClubResult?.requestId || msgClubResult?.request_id || msgClubResult?.id || null;

        // 2. Persist as an OUT message
        const insertReq = pool.request()
            .input('ConversationId', sql.Int, conversationId)
            .input('Direction', sql.VarChar(3), 'OUT')
            .input('MessageType', sql.VarChar(20), 'text')
            .input('Content', sql.NVarChar(sql.MAX), text.trim())
            .input('MediaUrl', sql.VarChar(1000), null)
            .input('RequestId', sql.VarChar(100), requestId)
            .input('DeliveryStatus', sql.VarChar(20), 'sent')
            .input('AgentId', sql.Int, agentId)
            .input('ClientTempId', sql.VarChar(50), clientTempId || null)
            .output('MessageId', sql.Int);

        const insertResult = await insertReq.execute('usp_WhatsApp_InsertMessage');
        const messageId = insertResult.output.MessageId;

        // bump conversation's last message
        await pool.request()
            .input('CustomerMobile', sql.VarChar(20), customerMobile)
            .input('CustomerName', sql.VarChar(100), null)
            .input('LastMessageText', sql.VarChar(500), text.trim().slice(0, 500))
            .input('IncrementUnread', sql.Bit, 0)
            .output('ConversationId', sql.Int)
            .execute('usp_WhatsApp_UpsertConversation');

        const messagePayload = {
            messageId,
            conversationId: Number(conversationId),
            direction: 'OUT',
            messageType: 'text',
            content: text.trim(),
            mediaUrl: null,
            requestId,
            deliveryStatus: 'sent',
            clientTempId: clientTempId || null,
            createdAt: new Date().toISOString(),
        };

        // No socket layer in this backend - the agent's own screen updates from
        // this HTTP response, and every other agent's screen picks it up on the
        // next poll cycle (matches how AgentDashboard.jsx already works for tickets).
        res.json({ success: true, data: messagePayload });
    } catch (err) {
        console.error('[sendMessage]', err);
        res.status(500).json({ success: false, message: 'Failed to send message' });
    }
}

module.exports = { getConversations, getMessages, sendMessage };