// services/msgclub.service.js
// Thin wrapper around MsgClub's WhatsApp Send Chat API.
// Requires these in your .env:
//   MSGCLUB_AUTH_KEY=69daeea8d6db98c428f11dc98effdc   (the one they gave you)
//   MSGCLUB_SENDER_ID=<your WhatsApp business number, the one registered with MsgClub>
//   MSGCLUB_SEND_URL=http://msg.icloudsms.com/rest/services/sendSMS/v3/sendChat

const axios = require('axios');

const MSGCLUB_SEND_URL = process.env.MSGCLUB_SEND_URL ||
    'http://msg.icloudsms.com/rest/services/sendSMS/v3/sendChat';
const AUTH_KEY = process.env.MSGCLUB_AUTH_KEY;
const SENDER_ID = process.env.MSGCLUB_SENDER_ID;

if (!AUTH_KEY || !SENDER_ID) {
    // eslint-disable-next-line no-console
    console.warn('[msgclub.service] MSGCLUB_AUTH_KEY or MSGCLUB_SENDER_ID missing from env.');
}

/**
 * Send a plain text message (only works inside the 24h customer service window).
 * @param {string} toMobile - customer mobile in international format, e.g. 919999999999
 * @param {string} text
 * @returns {Promise<{requestId: string|null, raw: object}>}
 */
async function sendTextMessage(toMobile, text) {
    const payload = {
        senderId: SENDER_ID,
        component: {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: toMobile,
            type: 'text',
            text: {
                preview_url: true,
                body: text,
            },
        },
    };

    const url = `${MSGCLUB_SEND_URL}?AUTH_KEY=${AUTH_KEY}`;
    const { data } = await axios.post(url, payload, { timeout: 15000 });

    // NOTE: MsgClub does not have a "Message ID" concept - they issue a
    // "Request ID" instead (per their support reply). Adjust the field name
    // below once you see a real response body - common candidates are
    // data.requestId / data.request_id / data.id. Log `data` on first send
    // to confirm, then trim this fallback chain down to the one that's real.
    const requestId = data?.requestId || data?.request_id || data?.id || null;

    return { requestId, raw: data };
}

/**
 * Send a media message using a pre-approved template's "Ready JSON"
 * (built in the MsgClub panel: Developer -> API -> WhatsApp Chat -> Get API).
 * Pass the exact JSON body MsgClub generated for that template; this function
 * just injects the auth key and forwards it.
 * @param {object} readyJsonPayload - the full body copied from the MsgClub panel
 */
async function sendMediaMessage(readyJsonPayload) {
    const url = `${MSGCLUB_SEND_URL}?AUTH_KEY=${AUTH_KEY}`;
    const { data } = await axios.post(url, readyJsonPayload, { timeout: 20000 });
    const requestId = data?.requestId || data?.request_id || data?.id || null;
    return { requestId, raw: data };
}

module.exports = { sendTextMessage, sendMediaMessage };