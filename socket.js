const jwt = require('jsonwebtoken');
const Message = require('./models/Message');
const User = require('./models/User');

// userId -> Set(socketId)
let onlineUsers = new Map();

module.exports = (io) => {

    // AUTH MIDDLEWARE
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

    io.on('connection', async (socket) => {

        const userId = socket.user.id;
        socket.userId = userId;

        console.log('User connected:', socket.id, 'User:', userId);

        // =========================
        // HANDLE ONLINE USERS MAP
        // =========================
        if (!onlineUsers.has(userId)) {
            onlineUsers.set(userId, new Set());
        }

        onlineUsers.get(userId).add(socket.id);

        // Update DB
        await User.findByIdAndUpdate(userId, {
            isOnline: true
        });

        // Broadcast online
        io.emit('userStatusChanged', {
            userId,
            isOnline: true
        });

        // =========================
        // SEND MESSAGE
        // =========================
        socket.on('sendMessage', async (data) => {
            try {
                if (!data.text?.trim()) return;

                const message = await Message.create({
                    sender: userId,
                    receiver: data.receiver,
                    text: data.text.trim(),
                    mediaType: data.mediaType || 'text'
                });

                const cleanMessage = {
                    _id: message._id,
                    sender: userId,
                    receiver: data.receiver,
                    text: message.text,
                    mediaType: message.mediaType,
                    createdAt: message.createdAt
                };

                // Send to receiver (all their devices)
                const receiverSockets = onlineUsers.get(data.receiver);

                if (receiverSockets) {
                    for (const socketId of receiverSockets) {
                        io.to(socketId).emit('receiveMessage', cleanMessage);
                    }
                }

                // Send back to sender
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