const express = require('express');
const router = express.Router();
const {
  getAllTickets,
  getTicketThreadInternal,
  addAgentMessage,
  updateTicketStatus,
  startNewConversation,
  deleteTicket,
} = require('../controllers/ticketController');

// All routes in this file are mounted behind authMiddleware in server.js

router.get('/', getAllTickets);
router.post('/new', startNewConversation);
router.get('/:id', getTicketThreadInternal);
router.post('/:id/messages', addAgentMessage);
router.put('/:id/status', updateTicketStatus);
router.delete('/:id', deleteTicket);

module.exports = router;