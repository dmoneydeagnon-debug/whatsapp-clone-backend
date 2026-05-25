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
        // receiver is required for 1:1 chats; for groups we use groupId
        required: false
    },

    groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        // groupId is required for group chats
        required: false
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

    status: {
        type: String,
        enum: ['sent', 'delivered', 'read'],
        default: 'sent'
    },

    read: {
        type: Boolean,
        default: false
    },

    // Reactions (emoji per message, by user)
    reactions: [
        {
            emoji: { type: String, required: true },
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
        }
    ]

}, { timestamps: true });


// Soft-delete support
// - deletedForMe: message is hidden only for specific users (requester side)
// - deletedForEveryone: message is deleted for everyone (both sides show placeholder)
messageSchema.add({
  deletedForMe: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  deletedForEveryone: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model('Message', messageSchema);
