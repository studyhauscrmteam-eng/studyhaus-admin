const fs = require('fs');

const BUMP_V = 'v=60';

// 1. firebase-entry.js
let fb = fs.readFileSync('firebase-entry.js', 'utf8');
fb = fb.replace(/\.\/services\/paymentAdminUI\.js(\?v=\d+)?/g, `./services/paymentAdminUI.js?${BUMP_V}`);
fb = fb.replace(/\.\/services\/whatsappModalUI\.js(\?v=\d+)?/g, `./services/whatsappModalUI.js?${BUMP_V}`);
fb = fb.replace(/\.\/services\/settingsAdminUI\.js(\?v=\d+)?/g, `./services/settingsAdminUI.js?${BUMP_V}`);
fb = fb.replace(/\.\/services\/receiptService\.js(\?v=\d+)?/g, `./services/receiptService.js?${BUMP_V}`);
fs.writeFileSync('firebase-entry.js', fb, 'utf8');
console.log('firebase-entry.js bumped.');

// 2. HTML files
const htmlFiles = ['admin/dashboard.html', 'index.html', 'manager/dashboard.html', 'employee/dashboard.html'];
htmlFiles.forEach(file => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/firebase-entry\.js(\?v=\d+)?/g, `firebase-entry.js?${BUMP_V}`);
    fs.writeFileSync(file, content, 'utf8');
    console.log(`${file} bumped.`);
  }
});
