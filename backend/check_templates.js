// One-off script: list approved WhatsApp templates via the existing
// getTemplateList() helper in config/whatsapp.js.
require('dotenv').config();
const { getTemplateList } = require('./config/whatsapp');

getTemplateList('APPROVED')
  .then((data) => {
    console.log(JSON.stringify(data, null, 2));
  })
  .catch((err) => {
    console.error('Failed to fetch template list:', err.response?.data || err.message);
  });
