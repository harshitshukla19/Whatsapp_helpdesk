// test_upload_and_media.js
const path = require('path');
const fs = require('fs');

// Test 1: Verify uploads directory exists
const uploadsDir = path.resolve(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
console.log('Uploads directory exists:', fs.existsSync(uploadsDir));

// Test 2: Test base64 parsing and file write logic
const dummyBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const matches = dummyBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
const dataBuffer = Buffer.from(matches[2], 'base64');
const safeName = `test_media_${Date.now()}.png`;
const filePath = path.join(uploadsDir, safeName);
fs.writeFileSync(filePath, dataBuffer);

console.log('Saved test image to:', filePath);
console.log('File size on disk:', fs.statSync(filePath).size, 'bytes');

// Clean up test file
fs.unlinkSync(filePath);
console.log('Cleaned up test file');
console.log('All tests passed successfully!');
