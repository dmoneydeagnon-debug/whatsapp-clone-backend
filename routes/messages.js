const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const auth = require('../middleware/auth');

// Get messages between users
router.get('/:userId', auth, async (req, res) => {
    try {
        const messages = await Message.find({
            $or: [
                { sender: req.user.id, receiver: req.params.userId },
                { sender: req.params.userId, receiver: req.user.id }
            ],
            // hide messages deleted only for this user
            deletedForMe: { $ne: req.user.id }
        }).sort({ createdAt: 1 });

        res.json(messages);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

module.exports = router;