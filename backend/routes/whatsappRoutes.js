// routes/whatsappRoutes.js
const express = require('express');
const router = express.Router();
const {
  getConversations,
  getMessages,
  sendMessage,
  initiateConversation,
  deleteConversation,
  deleteMessage,
  getTemplates,
} = require('../controllers/whatsappController');

router.get('/conversations', getConversations);
router.get('/conversations/:conversationId/messages', getMessages);
router.post('/conversations/:conversationId/send', sendMessage);
router.post('/conversations/initiate', initiateConversation);
router.delete('/conversations/:conversationId', deleteConversation);
router.delete('/conversations/:conversationId/messages/:messageId', deleteMessage);
router.get('/templates', getTemplates);

module.exports = router;
