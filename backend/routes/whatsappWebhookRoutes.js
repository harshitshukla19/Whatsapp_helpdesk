const express = require('express');
const router = express.Router();
const {
  whatsappWebhookHandler,
  getRecentWebhookLogs
} = require('../controllers/whatsappWebhookController');

router.post('/messages', whatsappWebhookHandler);
router.get('/debug/recent', getRecentWebhookLogs);

module.exports = router;