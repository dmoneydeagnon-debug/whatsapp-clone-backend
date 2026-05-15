const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // FIXED ✅
    text: {
        type: String,
        trim: true,
        default: ''
    },

    mediaUrl: {
        type: String,
        default: ''
    },

    mediaType: {
        type: String,
        enum: ['text', 'voice', 'image'],
        default: 'text'
    },

    read: {
        type: Boolean,
        default: false
    }

}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);