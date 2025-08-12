// What changed in Stage G — shim for sendToGemini
// Keeps existing imports working without moving the real file.
// The real file lives in the project root: /sendToGemini.js
module.exports = require('../sendToGemini');
