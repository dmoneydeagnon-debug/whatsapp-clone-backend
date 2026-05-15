const jwt = require('jsonwebtoken');
const Message = require('./models/Message');
const User = require('./models/User');

// userId -> Set(socketId)
let onlineUsers = new Map();

module.exports = (io) => {

    // =========================
    // AUTH MIDDLEWARE
    // =========================
    io.use((socket, next) => {
        try {
            const token = socket.handshake.auth.token;

            if (!token) {
                return next(new Error('Authentication error'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded;

            next();

        } catch (err) {
            next(new Error('Authentication error'));
        }
    });

    // =========================
    // CONNECTION
    // =========================
    io.on('connection', async (socket) => {

        const userId = socket.user.id;
        socket.userId = userId;

        console.log('User connected:', socket.id, 'User:', userId);

        // =========================
        // ONLINE USERS MAP (multi-device safe)
        // =========================
        if (!onlineUsers.has(userId)) {
            onlineUsers.set(userId, new Set());
        }

        onlineUsers.get(userId).add(socket.id);

        // mark online in DB
        await User.findByIdAndUpdate(userId, {
            isOnline: true
        });

        // broadcast online status
        io.emit('userStatusChanged', {
            userId,
            isOnline: true
        });

        // =========================
        // SEND MESSAGE (TEXT + IMAGE + VOICE)
        // =========================
        socket.on('sendMessage', async (data) => {
            try {

                const hasText = data.text && data.text.trim();
                const hasMedia = data.mediaUrl && data.mediaUrl.trim();

                // block only if completely empty
                if (!hasText && !hasMedia) return;

                const message = await Message.create({
                    sender: userId,
                    receiver: data.receiver,
                    text: data.text?.trim() || '',
                    mediaUrl: data.mediaUrl || '',
                    mediaType: data.mediaType || 'text'
                });

                const cleanMessage = {
                    _id: message._id,
                    sender: userId,
                    receiver: data.receiver,
                    text: message.text,
                    mediaUrl: message.mediaUrl,
                    mediaType: message.mediaType,
                    createdAt: message.createdAt
                };

                // send to receiver (all devices)
                const receiverSockets = onlineUsers.get(data.receiver);

                if (receiverSockets && receiverSockets.size > 0) {
                    for (const socketId of receiverSockets) {
                        io.to(socketId).emit('receiveMessage', cleanMessage);
                    }
                }

                // send back to sender
                socket.emit('receiveMessage', cleanMessage);

            } catch (err) {
                console.error('SEND MESSAGE ERROR:', err);
            }
        });

        // =========================
        // DISCONNECT
        // =========================
        socket.on('disconnect', async () => {

            const sockets = onlineUsers.get(userId);

            if (sockets) {
                sockets.delete(socket.id);

                if (sockets.size === 0) {
                    onlineUsers.delete(userId);

                    const lastSeen = new Date();

                    await User.findByIdAndUpdate(userId, {
                        isOnline: false,
                        lastSeen
                    });

                    io.emit('userStatusChanged', {
                        userId,
                        isOnline: false,
                        lastSeen
                    });
                }
            }

            console.log('Disconnected:', socket.id);
        });
    });
};