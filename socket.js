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

        // update pending messages that were sent while offline
        const pendingMessages = await Message.find({
            receiver: userId,
            status: 'sent'
        });

        for (const pending of pendingMessages) {
            pending.status = 'delivered';
            await pending.save();

            const senderSockets = onlineUsers.get(pending.sender.toString());
            if (senderSockets && senderSockets.size > 0) {
                for (const socketId of senderSockets) {
                    io.to(socketId).emit('messageStatusUpdate', {
                        messageId: pending._id,
                        status: 'delivered'
                    });
                }
            }
        }

        // =========================
        // SEND MESSAGE (TEXT + IMAGE + VOICE)
        // =========================
        socket.on('sendMessage', async (data) => {
            try {
                const hasText = data.text && data.text.trim();
                const hasMedia = data.mediaUrl && data.mediaUrl.trim();

                // block only if completely empty
                if (!hasText && !hasMedia) return;

                const receiverSockets = onlineUsers.get(data.receiver);
                const isReceiverOnline = receiverSockets && receiverSockets.size > 0;
                const messageStatus = isReceiverOnline ? 'delivered' : 'sent';

                const message = await Message.create({
                    sender: userId,
                    receiver: data.receiver,
                    text: data.text?.trim() || '',
                    mediaUrl: data.mediaUrl || '',
                    mediaType: data.mediaType || 'text',
                    status: messageStatus
                });

                const cleanMessage = {
                    _id: message._id,
                    sender: userId,
                    receiver: data.receiver,
                    text: message.text,
                    mediaUrl: message.mediaUrl,
                    mediaType: message.mediaType,
                    createdAt: message.createdAt,
                    status: message.status
                };

                // send to receiver (all devices)
                if (isReceiverOnline) {
                    for (const socketId of receiverSockets) {
                        io.to(socketId).emit('receiveMessage', cleanMessage);
                    }
                }

                // send back to sender
                socket.emit('receiveMessage', cleanMessage);

                // update sender devices as delivered when receiver is online
                if (isReceiverOnline) {
                    const senderSockets = onlineUsers.get(userId);
                    if (senderSockets) {
                        for (const socketId of senderSockets) {
                            io.to(socketId).emit('messageStatusUpdate', {
                                messageId: message._id,
                                status: 'delivered'
                            });
                        }
                    }
                }

            } catch (err) {
                console.error('SEND MESSAGE ERROR:', err);
            }
        });

        // =========================
        // MARK AS READ
        // =========================
        socket.on('markAsRead', async ({ chatId }) => {
            try {
                const unreadMessages = await Message.find({
                    sender: chatId,
                    receiver: userId,
                    read: false
                });

                if (unreadMessages.length === 0) return;

                const messageIds = unreadMessages.map((m) => m._id);

                await Message.updateMany(
                    { _id: { $in: messageIds } },
                    { $set: { read: true, status: 'read' } }
                );

                const senderSockets = onlineUsers.get(chatId);
                if (senderSockets && senderSockets.size > 0) {
                    for (const socketId of senderSockets) {
                        io.to(socketId).emit('messageStatusUpdate', {
                            messageIds,
                            status: 'read'
                        });
                    }
                }
            } catch (err) {
                console.error('MARK AS READ ERROR:', err);
            }
        });

        // =========================
        // ADD REACTION
        // =========================
        socket.on('addReaction', async ({ messageId, receiver, emoji }) => {
            try {
                if (!messageId || !receiver || !emoji) return;

                const message = await Message.findById(messageId);
                if (!message) return;

                // Ensure the reaction sender is part of this conversation
                const isParticipant =
                    message.sender?.toString?.() === userId?.toString?.() ||
                    message.receiver?.toString?.() === userId?.toString?.();
                if (!isParticipant) return;

                const userIdStr = userId.toString();

                // Replace existing reaction from this user for same emoji
                // (We allow only one reaction per user per message per this schema pattern.)
                const current = message.reactions || [];

                const hasAnyReactionFromUser = current.some((r) => r.userId?.toString?.() === userIdStr);
                const updatedReactions = [];

                for (const r of current) {
                    if (r.userId?.toString?.() === userIdStr) continue; // remove previous reaction(s) by this user
                    updatedReactions.push(r);
                }

                if (!hasAnyReactionFromUser || !current.some((r) => r.userId?.toString?.() === userIdStr && r.emoji === emoji)) {
                    updatedReactions.push({ emoji, userId });
                }

                message.reactions = updatedReactions;
                await message.save();

                const payload = {
                    messageId,
                    reactions: message.reactions || []
                };

                // Emit updated reactions to both sender and receiver devices
                const senderSockets = onlineUsers.get(message.sender.toString());
                if (senderSockets) {
                    for (const socketId of senderSockets) {
                        io.to(socketId).emit('messageReaction', payload);
                    }
                }

                const receiverSockets = onlineUsers.get(receiver.toString());
                if (receiverSockets) {
                    for (const socketId of receiverSockets) {
                        io.to(socketId).emit('messageReaction', payload);
                    }
                }
            } catch (err) {
                console.error('ADD REACTION ERROR:', err);
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

