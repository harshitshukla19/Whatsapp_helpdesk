const msgclub = require('../services/msgclub.service');
require('dotenv').config();

const ACK_TEMPLATE_NAME =
  (process.env.ICLOUDSMS_ACK_TEMPLATE_NAME && process.env.ICLOUDSMS_ACK_TEMPLATE_NAME !== 'ticket_acknowledgement')
    ? process.env.ICLOUDSMS_ACK_TEMPLATE_NAME
    : 'welcome_msg';

/**
 * Sends a WhatsApp template message via MsgClub / icloudsms.
 */
async function sendTemplateMessage({ mobileNumber, templateName, language = 'en', components }) {
  return msgclub.sendTemplateMessage({
    mobileNumber,
    templateName,
    language,
    components,
  });
}

/**
 * Sends the "ticket created" acknowledgement message with the ticket ID.
 */
async function sendTicketAcknowledgement(mobileNumber, ticketId) {
  const ticketNumber = String(ticketId).split('-').pop();

  const message =
    `Hi, we've got your message!\n` +
    `Your ticket number is #TKT-OR-${ticketNumber}. A support representative is on it and will reply shortly.\n\n` +
    `Feel free to drop any additional details below in the meantime.`;

  // First try sending as free-form text. If outside window, can fall back to approved template
  const res = await msgclub.sendTextMessage(mobileNumber, message);
  if (!res.success && ACK_TEMPLATE_NAME) {
    return msgclub.sendTemplateMessage({
      mobileNumber,
      templateName: ACK_TEMPLATE_NAME,
      language: 'en',
    });
  }
  return res;
}

/**
 * Fetches the list of approved WhatsApp templates.
 */
async function getTemplateList(status = 'APPROVED') {
  return msgclub.getApprovedTemplates(status);
}

/**
 * Sends a free-form WhatsApp text message via MsgClub v3 sendChat.
 */
async function sendTextMessage(mobileNumber, text) {
  return msgclub.sendTextMessage(mobileNumber, text);
}

/**
 * Sends a media message via MsgClub v3 sendChat.
 * Supports both positional args: (mobileNumber, mediaType, mediaUrl, caption)
 * and object arg: ({ mobileNumber, mediaType, mediaLink, caption })
 */
async function sendMediaMessage(arg1, arg2, arg3, arg4) {
  if (typeof arg1 === 'object' && arg1 !== null) {
    return msgclub.sendMediaMessage(
      arg1.mobileNumber,
      arg1.mediaType,
      arg1.mediaLink || arg1.mediaUrl,
      arg1.caption
    );
  }
  return msgclub.sendMediaMessage(arg1, arg2, arg3, arg4);
}

/**
 * Sends a location message via MsgClub v3 sendChat.
 */
async function sendLocationMessage(mobileNumber, location) {
  return msgclub.sendLocationMessage(mobileNumber, location);
}

/**
 * Sends a contact card via MsgClub v3 sendChat.
 */
async function sendContactMessage(mobileNumber, contact) {
  return msgclub.sendContactMessage(mobileNumber, contact);
}

module.exports = {
  sendTemplateMessage,
  sendTicketAcknowledgement,
  getTemplateList,
  sendTextMessage,
  sendMediaMessage,
  sendLocationMessage,
  sendContactMessage,
};
