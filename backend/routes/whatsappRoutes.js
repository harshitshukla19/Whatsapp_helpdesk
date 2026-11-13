// routes/whatsappRoutes.js
//
// NO LOGIN REQUIRED - matches internalTicketRoutes.js, which is intentionally
// unguarded per your app's design. authMiddleware is NOT applied here either.
const express = require('express');
const router = express.Router();
const { getConversations, getMessages, sendMessage } = require('../controllers/whatsappController');

router.get('/conversations', getConversations);
router.get('/conversations/:conversationId/messages', getMessages);
router.post('/conversations/:conversationId/send', sendMessage);

module.exports = router;