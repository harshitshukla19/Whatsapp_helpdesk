const axios = require('axios');
require('dotenv').config();

// ---- Legacy icloudsms template API (unchanged - used for the ticket ack) ----
const AUTH_KEY = process.env.ICLOUDSMS_AUTH_KEY;
const SENDER_ID = process.env.ICLOUDSMS_SENDER_ID;
const LANGUAGE = process.env.ICLOUDSMS_LANGUAGE || 'en';

// Template endpoints live on v2, separate from the v3 sendChat API used for
// free-form text (see MSGCLUB_CHAT_URL below / msgclub.service.js).
const TEMPLATE_BASE_URL =
  process.env.ICLOUDSMS_TEMPLATE_BASE_URL ||
  'http://msg.icloudsms.com/rest/services/sendSMS/v2';

// ---- MsgClub v3 chat API (new) - free-form send/reply within the 24h window ----
const MSGCLUB_CHAT_URL = process.env.MSGCLUB_CHAT_URL || 'http://msg.icloudsms.com/rest/services/sendSMS/v3/sendChat';
const MSGCLUB_AUTH_KEY = process.env.MSGCLUB_AUTH_KEY;
const MSGCLUB_SENDER_NUMBER = process.env.MSGCLUB_SENDER_NUMBER;

/**
 * Sends a WhatsApp template message (e.g. ticket acknowledgement) via icloudsms.
 * templateParams is an optional object of placeholder values your template expects
 * (e.g. { "1": ticketId }) - adjust based on how your approved template is structured
 * in the icloudsms/WABA dashboard.
 */
async function sendTemplateMessage({ mobileNumber, templateName, headerMediaLink, templateParams }) {
  try {
    const params = {
      AUTH_KEY,
      senderId: SENDER_ID,
      mobileNumbers: mobileNumber,
      templateName,
      language: LANGUAGE
    };

    if (headerMediaLink) params.header_media_link = headerMediaLink;
    if (templateParams) {
      // Flatten template params into query params if your BSP expects that -
      // confirm exact param naming against icloudsms docs / getTemplateReadyJson response.
      Object.entries(templateParams).forEach(([key, value]) => {
        params[`var${key}`] = value;
      });
    }

const response = await axios.get(`${TEMPLATE_BASE_URL}/sendtemplate`, { params });    return response.data;
  } catch (err) {
    console.error('WhatsApp send error:', err.response?.data || err.message);
    // Do not throw - a failed WhatsApp send should not block ticket creation.
    return { success: false, error: err.response?.data || err.message };
  }
}

/**
 * Sends the "ticket created" acknowledgement message with the ticket ID.
 */
async function sendTicketAcknowledgement(mobileNumber, ticketId) {
  // ticketId is expected in "TKT-OR-24" format — {{1}} = "24"
  const ticketNumber = String(ticketId).split('-').pop();

  const message =
    `Hi, we've got your message!\n` +
    `Your ticket number is #TKT-OR-${ticketNumber}. A support representative is on it and will reply shortly.\n\n` +
    `Feel free to drop any additional details below in the meantime.`;

  return sendTextMessage(mobileNumber, message);
}

/**
 * Fetches the list of approved WhatsApp templates for this sender.
 */
async function getTemplateList(status = 'APPROVED') {
  const response = await axios.get(`${TEMPLATE_BASE_URL}/getTemplateList`, {
    params: { AUTH_KEY, senderId: SENDER_ID, status }
  });
  return response.data;
}

/**
 * Sends a free-form WhatsApp TEXT message using MsgClub's v3 sendChat API.
 * This only works within the 24-hour customer-service window (i.e. the
 * customer must have messaged in the last 24h) - per MsgClub support, use
 * sendTemplateMessage() above for anything outside that window.
 *
 * Docs: Developer -> API -> WhatsApp Chat -> Get API (in the MsgClub panel)
 */
async function sendTextMessage(mobileNumber, text) {
  try {
    const response = await axios.post(
      `${MSGCLUB_CHAT_URL}?AUTH_KEY=${MSGCLUB_AUTH_KEY}`,
      {
        senderId: MSGCLUB_SENDER_NUMBER,
        component: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: mobileNumber,
          type: 'text',
          text: {
            preview_url: true,
            body: text
          }
        }
      }
    );
    return response.data;
  } catch (err) {
    console.error('MsgClub sendTextMessage error:', err.response?.data || err.message);
    return { success: false, error: err.response?.data || err.message };
  }
}

/**
 *
 * @param {Object} params
 * @param {string} params.mobileNumber
 * @param {'image'|'video'|'document'|'audio'} params.mediaType
 * @param {string} params.mediaLink - publicly reachable URL to the file
 * @param {string} [params.caption] - not applicable to audio
 */
async function sendMediaMessage({ mobileNumber, mediaType, mediaLink, caption }) {
  try {
    const mediaObject = { link: mediaLink };
    if (caption && mediaType !== 'audio') {
      mediaObject.caption = caption;
    }

    const response = await axios.post(
      `${MSGCLUB_CHAT_URL}?AUTH_KEY=${MSGCLUB_AUTH_KEY}`,
      {
        senderId: MSGCLUB_SENDER_NUMBER,
        component: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: mobileNumber,
          type: mediaType,
          [mediaType]: mediaObject
        }
      }
    );
    return response.data;
  } catch (err) {
    console.error('MsgClub sendMediaMessage error:', err.response?.data || err.message);
    return { success: false, error: err.response?.data || err.message };
  }
}

module.exports = {
  sendTemplateMessage,
  sendTicketAcknowledgement,
  getTemplateList,
  sendTextMessage,
  sendMediaMessage
};