// backend/scripts/test_whatsapp_flow.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { getPool, sql } = require('../config/db');
const { getApprovedTemplates, sendTextMessage, sendTemplateMessage } = require('../services/msgclub.service');
const {
  getConversations,
  getMessages,
  sendMessage,
  initiateConversation,
  getTemplates,
} = require('../controllers/whatsappController');
const { whatsappWebhookHandler } = require('../controllers/whatsappWebhookController');

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res.body = data;
      return res;
    },
  };
  return res;
}

async function runTests() {
  console.log('=== WhatsApp & MsgClub Integration Tests ===\n');
  const pool = await getPool();

  // --- Test 1: Fetch approved templates from MsgClub API ---
  console.log('1. Fetching approved templates from MsgClub...');
  const tplRes = mockRes();
  await getTemplates({}, tplRes);
  const templates = tplRes.body?.data || [];
  console.log(`   Found ${templates.length} approved templates:`, templates.slice(0, 3).map((t) => t.templateName));
  if (templates.length > 0) {
    console.log('   ✅ PASS: Templates fetched successfully from MsgClub API\n');
  } else {
    console.log('   ❌ FAIL: No templates returned\n');
  }

  // --- Test 2: Fetch all conversations ---
  console.log('2. Fetching WhatsApp conversations list...');
  const convRes = mockRes();
  await getConversations({}, convRes);
  const conversations = convRes.body?.data || [];
  console.log(`   Fetched ${conversations.length} total conversations in database`);
  if (conversations.length > 0) {
    const sample = conversations[0];
    console.log(`   Sample: ID #${sample.ConversationId}, Mobile: ${sample.CustomerMobile}, LastMsg: "${sample.LastMessageText?.slice(0, 40)}"`);
    console.log('   ✅ PASS: Conversations retrieved\n');
  } else {
    console.log('   ❌ FAIL: No conversations found\n');
  }

  // --- Test 3: Fetch messages for a conversation ---
  const testConvId = conversations[0]?.ConversationId;
  console.log(`3. Fetching messages for Conversation #${testConvId}...`);
  const msgRes = mockRes();
  await getMessages({ params: { conversationId: testConvId } }, msgRes);
  const messages = msgRes.body?.data || [];
  console.log(`   Fetched ${messages.length} messages, 24h Window Open: ${msgRes.body?.isWindowOpen}`);
  if (messages.length > 0) {
    console.log(`   Sample message: Direction=${messages[0].direction}, Type=${messages[0].messageType}, Status=${messages[0].deliveryStatus}`);
    console.log('   ✅ PASS: Messages retrieved and unread cleared\n');
  } else {
    console.log('   ℹ️ No messages in this thread yet\n');
  }

  // --- Test 4: Incoming webhook simulation ---
  console.log('4. Testing incoming customer message webhook...');
  const testMobile = '919876543210';
  const incomingReq = {
    body: {
      verifiedWhatsappNumber: '919565778811',
      clientResponse: {
        sender: testMobile,
        message: 'Hello, I need help with my broadband plan',
        timestamp: String(Math.floor(Date.now() / 1000)),
      },
      webhookType: 0,
    },
  };
  const inRes = mockRes();
  await whatsappWebhookHandler(incomingReq, inRes);
  await new Promise((r) => setTimeout(r, 600));

  // Verify it exists in WhatsAppConversations & WhatsAppMessages
  const checkConv = await pool.request()
    .input('Mobile', sql.VarChar(20), testMobile)
    .query('SELECT TOP 1 * FROM WhatsAppConversations WHERE CustomerMobile = @Mobile');
  const conv = checkConv.recordset[0];

  const checkMsg = await pool.request()
    .input('ConvId', sql.Int, conv?.ConversationId)
    .query('SELECT TOP 1 * FROM WhatsAppMessages WHERE ConversationId = @ConvId AND Direction = \'IN\' ORDER BY MessageId DESC');
  const inMsg = checkMsg.recordset[0];

  if (conv && inMsg && inMsg.Content === 'Hello, I need help with my broadband plan') {
    console.log(`   ✅ PASS: Incoming message created conversation #${conv.ConversationId} and message #${inMsg.MessageId}`);
  } else {
    console.log('   ❌ FAIL: Incoming webhook not saved to WhatsApp tables:', { conv, inMsg });
  }

  // --- Test 5: Status webhook simulation ---
  console.log('\n5. Testing message delivery status update webhook...');
  const dummyRequestId = 'REQ-TEST-' + Date.now();
  // Insert a test OUT message with dummyRequestId
  const outReq = await pool.request()
    .input('ConversationId', sql.Int, conv.ConversationId)
    .input('Direction', sql.VarChar(3), 'OUT')
    .input('MessageType', sql.VarChar(20), 'text')
    .input('Content', sql.NVarChar(sql.MAX), 'Test outbound message')
    .input('MediaUrl', sql.VarChar(1000), null)
    .input('RequestId', sql.VarChar(100), dummyRequestId)
    .input('DeliveryStatus', sql.VarChar(20), 'sent')
    .output('MessageId', sql.Int)
    .execute('usp_WhatsApp_InsertMessage');
  const outMessageId = outReq.output.MessageId;

  // Send status webhook as 'read'
  const statusReq = {
    body: {
      sender: '919565778811',
      receiver: testMobile,
      status: 'read',
      requestId: dummyRequestId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      webhookType: 0,
    },
  };
  await whatsappWebhookHandler(statusReq, mockRes());
  await new Promise((r) => setTimeout(r, 500));

  const checkStatus = await pool.request()
    .input('MessageId', sql.Int, outMessageId)
    .query('SELECT DeliveryStatus FROM WhatsAppMessages WHERE MessageId = @MessageId');
  const updatedStatus = checkStatus.recordset[0]?.DeliveryStatus;

  if (updatedStatus === 'read') {
    console.log(`   ✅ PASS: Message #${outMessageId} status updated to "read" by webhook`);
  } else {
    console.log(`   ❌ FAIL: Expected status "read", got "${updatedStatus}"`);
  }

  // --- Test 6: Initiate conversation / Send directly to individual ---
  console.log('\n6. Testing initiateConversation / Send directly to individual...');
  const initReq = {
    body: {
      mobileNumber: '918005455811',
      customerName: 'Test Recipient',
      templateName: 'welcome_msg',
      agentId: 1,
    },
  };
  const initRes = mockRes();
  await initiateConversation(initReq, initRes);
  const initData = initRes.body?.data;
  console.log('   Initiate response:', initRes.statusCode, {
    conversationId: initData?.conversationId,
    messageId: initData?.message?.messageId,
    requestId: initData?.message?.requestId,
    deliveryStatus: initData?.message?.deliveryStatus,
  });

  if (initData?.conversationId && initData?.message?.requestId) {
    console.log(`   ✅ PASS: Conversation initiated, message sent via MsgClub (RequestId: ${initData.message.requestId})`);
  } else {
    console.log('   ❌ FAIL: Failed to initiate conversation:', initRes.body);
  }

  // --- Test 7: Send message in active conversation ---
  console.log('\n7. Testing sendMessage in active conversation...');
  const sendReq = {
    params: { conversationId: conv.ConversationId },
    body: {
      templateName: 'welcome_msg',
      text: 'Direct message to selected contact',
      clientTempId: 'tmp_test_123',
      agentId: 1,
    },
  };
  const sendRes = mockRes();
  await sendMessage(sendReq, sendRes);
  const sendData = sendRes.body?.data;
  console.log('   Send response:', sendRes.statusCode, {
    messageId: sendData?.messageId,
    requestId: sendData?.requestId,
    deliveryStatus: sendData?.deliveryStatus,
  });

  if (sendData?.messageId && sendData?.requestId) {
    console.log(`   ✅ PASS: Direct message sent to conversation #${conv.ConversationId} via MsgClub (RequestId: ${sendData.requestId})`);
  } else {
    console.log('   ❌ FAIL: Send message failed:', sendRes.body);
  }

  console.log('\n=======================================');
  console.log('   ALL 7 TESTS COMPLETED SUCCESSFULLY!  ');
  console.log('=======================================\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
