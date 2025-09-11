// routes/messagesRoutes.js
// Messages Routes - GPT-5 powered message generation endpoints

const router = require('express').Router();
const { authenticateToken } = require('../middleware/auth');
const {
    handleGenerateMessage,
    handleGenerateConnection,
    handleGenerateIntro,
    handleGenerateColdEmail  // ADD THIS LINE
} = require('../controllers/messagesController');

// Message generation routes (same URLs, same middleware)
router.post('/generate-message', authenticateToken, handleGenerateMessage);
router.post('/generate-connection', authenticateToken, handleGenerateConnection);
router.post('/generate-intro', authenticateToken, handleGenerateIntro);
router.post('/generate-cold-email', authenticateToken, handleGenerateColdEmail); // ADD THIS LINE

module.exports = router;
