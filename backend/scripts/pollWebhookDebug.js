/**
 * Run this on your LOCAL machine (not on the VPS) while developing.
 * It polls the production debug endpoint every few seconds and prints any
 * new MsgClub webhook payloads to your console - so you can see real
 * incoming messages/DLRs while your app runs on localhost.
 *
 * Usage:
 *   node scripts/pollWebhookDebug.js
 *
 * Requires in your LOCAL .env (or just hardcode below for a quick test):
 *   PROD_WEBHOOK_DEBUG_URL=https://helpdesk.onremote.in/api/webhooks/msgclub/debug/recent
 *   WEBHOOK_DEBUG_KEY=<same value you set in the VPS .env>
 */
require('dotenv').config();
const axios = require('axios');

const DEBUG_URL = process.env.PROD_WEBHOOK_DEBUG_URL || 'https://helpdesk.onremote.in/api/webhooks/msgclub/debug/recent';
const DEBUG_KEY = process.env.WEBHOOK_DEBUG_KEY;
const POLL_INTERVAL_MS = 4000;

if (!DEBUG_KEY) {
  console.error('Set WEBHOOK_DEBUG_KEY in your local .env (same value as on the VPS) before running this.');
  process.exit(1);
}

let lastSeenId = null;

async function poll() {
  try {
    const { data } = await axios.get(DEBUG_URL, {
      params: {
        key: DEBUG_KEY,
        since: lastSeenId ?? undefined,
        limit: 20
      }
    });

    const logs = data?.data || [];
    if (logs.length > 0) {
      // logs come back newest-first; print oldest-first so it reads top-to-bottom
      for (const log of [...logs].reverse()) {
        console.log(`\n[${log.receivedAt}] webhook #${log.id}`);
        console.log(JSON.stringify(log.payload, null, 2));
      }
      lastSeenId = logs[0].id; // newest id in this batch
    }
  } catch (err) {
    console.error('Poll failed:', err.response?.data || err.message);
  } finally {
    setTimeout(poll, POLL_INTERVAL_MS);
  }
}

console.log(`Polling ${DEBUG_URL} every ${POLL_INTERVAL_MS / 1000}s for new MsgClub webhook payloads...`);
poll();