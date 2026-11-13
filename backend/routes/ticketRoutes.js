const express = require('express');
const router = express.Router();
const {
  createTicket,
  addCustomerMessage,
  getTicketThreadPublic
} = require('../controllers/ticketController');

// Customer submits a new query -> creates ticket, sends WhatsApp ack with ticket ID
router.post('/', createTicket);

// Customer views their ticket thread (?mobileNumber= for ownership check)
router.get('/:id', getTicketThreadPublic);

// Customer sends a follow-up message on an existing ticket
router.post('/:id/messages/customer', addCustomerMessage);

module.exports = router;