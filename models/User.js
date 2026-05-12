const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse:true },
    password: { type: String},
    avatar: { type: String, default: '' },
    lastSeen: { type: Date, default: Date.now },
    isOnline: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);