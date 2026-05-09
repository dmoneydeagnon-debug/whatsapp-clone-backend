const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const auth = require('../middleware/auth');

// Get messages between users
router.get('/:userId', auth, async (requestAnimationFrame, res) => {
    try {
        const messages = await Message.find({
            $or: [
                { sender: requestAnimationFrame.user.id, receiver: requestAnimationFrame.params.userId },
                { sender: requestAnimationFrame.params.userId, receiver: requestAnimationFrame.user.id }
            ]
        }).sort({ createdAt: 1 });

        res.json(messages);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

module.exports = router;