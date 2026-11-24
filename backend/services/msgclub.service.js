// services/msgclub.service.js
// Wrapper around MsgClub's WhatsApp Send Chat & Template APIs.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const axios = require('axios');

const MSGCLUB_SEND_URL =
  process.env.MSGCLUB_SEND_URL ||
  process.env.MSGCLUB_CHAT_URL ||
  'http://msg.icloudsms.com/rest/services/sendSMS/v3/sendChat';

const TEMPLATE_SEND_URL =
  process.env.ICLOUDSMS_TEMPLATE_BASE_URL ||
  'https://msg.icloudsms.com/rest/services/sendSMS/v2';

const AUTH_KEY =
  process.env.MSGCLUB_AUTH_KEY ||
  process.env.ICLOUDSMS_AUTH_KEY;

const SENDER_ID =
  process.env.MSGCLUB_SENDER_ID ||
  process.env.MSGCLUB_SENDER_NUMBER ||
  process.env.ICLOUDSMS_SENDER_ID;

if (!AUTH_KEY || !SENDER_ID) {
  // eslint-disable-next-line no-console
  console.warn('[msgclub.service] AUTH_KEY or SENDER_ID missing from env.');
}

/**
 * Normalizes mobile number to E.164 without plus sign (e.g. 919999999999).
 */
function normalizeMobile(m) {
  let d = String(m || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return d;
}

/**
 * Extracts the Request ID from MsgClub's response.
 * MsgClub returns { responseCode: '3001', response: '10011794800497117' },
 * where `response` is the unique tracking Request ID.
 */
function extractRequestId(data) {
  return data?.response || data?.requestId || data?.request_id || data?.id || null;
}

/**
 * Send a plain text message using MsgClub v3 sendChat API.
 * Note: Free-form text works inside the 24h customer session window.
 * Outside that window, MsgClub webhook will report "Re-engagement message" failure.
 *
 * @param {string} toMobile - customer mobile (10 digits or 91...)
 * @param {string} text - message body
 * @returns {Promise<{success: boolean, requestId: string|null, responseCode?: string, raw?: object, error?: string}>}
 */
async function sendTextMessage(toMobile, text) {
  try {
    const mobile = normalizeMobile(toMobile);
    const payload = {
      senderId: SENDER_ID,
      component: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: mobile,
        type: 'text',
        text: {
          preview_url: true,
          body: text,
        },
      },
    };

    const url = `${MSGCLUB_SEND_URL}?AUTH_KEY=${AUTH_KEY}`;
    const { data } = await axios.post(url, payload, { timeout: 20000 });

    const requestId = extractRequestId(data);
    const isSuccess = data?.responseCode === '3001' || (!data?.responseCode && !!requestId);

    return {
      success: isSuccess,
      requestId,
      responseCode: data?.responseCode,
      raw: data,
    };
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.response?.data || err.message;
    console.error('[msgclub.service] sendTextMessage error:', errorMsg);
    return {
      success: false,
      requestId: null,
      error: typeof errorMsg === 'object' ? JSON.stringify(errorMsg) : String(errorMsg),
    };
  }
}

/**
 * Send an approved WhatsApp template message (used for initiating conversations outside the 24h window).
 *
 * @param {Object} options
 * @param {string} options.mobileNumber
 * @param {string} options.templateName - e.g. 'welcome_msg', 'ticket_acknowledgement'
 * @param {string} [options.language='en']
 * @param {Array}  [options.components] - optional parameters for the template
 */
async function sendTemplateMessage({ mobileNumber, templateName, language = 'en', components }) {
  try {
    const mobile = normalizeMobile(mobileNumber);
    const templateObj = {
      name: templateName,
      language: { code: language },
    };

    if (components && Array.isArray(components) && components.length > 0) {
      templateObj.components = components;
    }

    const payload = {
      mobileNumbers: mobile,
      senderId: SENDER_ID,
      component: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        type: 'template',
        template: templateObj,
        qrImageUrl: false,
        qrLinkUrl: false,
        to: mobile,
      },
    };

    const url = `${TEMPLATE_SEND_URL}/sendtemplate?AUTH_KEY=${AUTH_KEY}`;
    const { data } = await axios.post(url, payload, { timeout: 25000 });

    const requestId = extractRequestId(data);
    const isSuccess = data?.responseCode === '3001' || (!data?.responseCode && !!requestId);

    return {
      success: isSuccess,
      requestId,
      responseCode: data?.responseCode,
      raw: data,
    };
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.response?.data || err.message;
    console.error('[msgclub.service] sendTemplateMessage error:', errorMsg);
    return {
      success: false,
      requestId: null,
      error: typeof errorMsg === 'object' ? JSON.stringify(errorMsg) : String(errorMsg),
    };
  }
}

/**
 * Send a media message (image, video, document, audio) via MsgClub v3 sendChat.
 */
async function sendMediaMessage(mobileNumber, mediaType, mediaUrl, caption) {
  try {
    const mobile = normalizeMobile(mobileNumber);
    const mediaObject = { link: mediaUrl };
    if (caption && mediaType !== 'audio') {
      mediaObject.caption = caption;
    }
    if (mediaType === 'document') {
      const fileName = path.basename((mediaUrl || '').split('?')[0]);
      mediaObject.filename = fileName || 'document.pdf';
    }

    const payload = {
      senderId: SENDER_ID,
      component: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: mobile,
        type: mediaType,
        [mediaType]: mediaObject,
      },
    };

    const url = `${MSGCLUB_SEND_URL}?AUTH_KEY=${AUTH_KEY}`;
    const { data } = await axios.post(url, payload, { timeout: 25000 });

    const requestId = extractRequestId(data);
    const isSuccess = data?.responseCode === '3001' || (!data?.responseCode && !!requestId);

    return {
      success: isSuccess,
      requestId,
      responseCode: data?.responseCode,
      raw: data,
    };
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.response?.data || err.message;
    console.error('[msgclub.service] sendMediaMessage error:', errorMsg);
    return {
      success: false,
      requestId: null,
      error: typeof errorMsg === 'object' ? JSON.stringify(errorMsg) : String(errorMsg),
    };
  }
}

/**
 * Send a location message via MsgClub v3 sendChat.
 */
async function sendLocationMessage(mobileNumber, { latitude, longitude, name, address }) {
  try {
    const mobile = normalizeMobile(mobileNumber);
    const locationObj = {
      latitude: Number(latitude),
      longitude: Number(longitude),
    };
    if (name) locationObj.name = name;
    if (address) locationObj.address = address;

    const payload = {
      senderId: SENDER_ID,
      component: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: mobile,
        type: 'location',
        location: locationObj,
      },
    };

    const url = `${MSGCLUB_SEND_URL}?AUTH_KEY=${AUTH_KEY}`;
    const { data } = await axios.post(url, payload, { timeout: 25000 });

    const requestId = extractRequestId(data);
    const isSuccess = data?.responseCode === '3001' || (!data?.responseCode && !!requestId);

    return {
      success: isSuccess,
      requestId,
      responseCode: data?.responseCode,
      raw: data,
    };
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.response?.data || err.message;
    console.error('[msgclub.service] sendLocationMessage error:', errorMsg);
    return {
      success: false,
      requestId: null,
      error: typeof errorMsg === 'object' ? JSON.stringify(errorMsg) : String(errorMsg),
    };
  }
}

/**
 * Send a contact card via MsgClub v3 sendChat.
 */
async function sendContactMessage(mobileNumber, { name, phone, email, organization }) {
  try {
    const mobile = normalizeMobile(mobileNumber);
    const cleanPhone = (phone || '').replace(/[^0-9+]/g, '');
    const nameParts = (name || '').trim().split(' ');
    const firstName = nameParts[0] || 'Contact';
    const lastName = nameParts.slice(1).join(' ') || '';

    const formattedName = organization
      ? `${name || cleanPhone} (${organization})`
      : (name || cleanPhone);

    const contactCard = {
      name: {
        formatted_name: formattedName,
        first_name: firstName,
        last_name: lastName,
      },
      phones: [
        {
          phone: cleanPhone || '',
          type: 'CELL',
        },
      ],
    };

    if (email) {
      contactCard.emails = [{ email: email.trim(), type: 'WORK' }];
    }
    // Note: Do not pass contactCard.org as MsgClub API rejects the 'org' key with a 500 error.
    // The organization name is cleanly placed into formatted_name above.

    const payload = {
      senderId: SENDER_ID,
      component: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: mobile,
        type: 'contacts',
        contacts: [contactCard],
      },
    };

    const url = `${MSGCLUB_SEND_URL}?AUTH_KEY=${AUTH_KEY}`;
    const { data } = await axios.post(url, payload, { timeout: 25000 });

    const requestId = extractRequestId(data);
    const isSuccess = data?.responseCode === '3001' || (!data?.responseCode && !!requestId);

    return {
      success: isSuccess,
      requestId,
      responseCode: data?.responseCode,
      raw: data,
    };
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.response?.data || err.message;
    console.error('[msgclub.service] sendContactMessage error:', errorMsg);
    return {
      success: false,
      requestId: null,
      error: typeof errorMsg === 'object' ? JSON.stringify(errorMsg) : String(errorMsg),
    };
  }
}

/**
 * Fetches the list of approved WhatsApp templates registered on the account.
 */
async function getApprovedTemplates(status = 'APPROVED') {
  try {
    const url = `${TEMPLATE_SEND_URL}/getTemplateList`;
    const res = await axios.get(url, {
      params: { AUTH_KEY, senderId: SENDER_ID, status },
      timeout: 15000,
    });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.error('[msgclub.service] getApprovedTemplates error:', err.response?.data || err.message);
    return [];
  }
}

module.exports = {
  normalizeMobile,
  extractRequestId,
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendLocationMessage,
  sendContactMessage,
  getApprovedTemplates,
};
