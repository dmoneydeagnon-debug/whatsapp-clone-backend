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

        // update pending 1:1 messages that were sent while offline
        const pendingMessages = await Message.find({
            receiver: userId,
            status: 'sent',
            groupId: { $exists: false }
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
        // SEND MESSAGE (TEXT + IMAGE + VOICE) [1:1 + GROUP]
        // =========================
        socket.on('sendMessage', async (data) => {
            try {
                const hasText = data.text && data.text.trim();
                const hasMedia = data.mediaUrl && data.mediaUrl.trim();

                // block only if completely empty
                if (!hasText && !hasMedia) return;

                // -------------------------
                // GROUP MESSAGE
                // -------------------------
                if (data.groupId) {
                    const Group = require('./models/Group');
                    const group = await Group.findById(data.groupId).lean();
                    if (!group) return;

                    const isMember = (group.members || []).some((m) => m.toString() === userId.toString());
                    if (!isMember) return;

                    const message = await Message.create({
                        sender: userId,
                        groupId: data.groupId,
                        text: data.text?.trim() || '',
                        mediaUrl: data.mediaUrl || '',
                        mediaType: data.mediaType || 'text',
                        status: 'sent'
                    });

                    const cleanMessage = {
                        _id: message._id,
                        sender: userId,
                        groupId: data.groupId,
                        text: message.text,
                        mediaUrl: message.mediaUrl,
                        mediaType: message.mediaType,
                        createdAt: message.createdAt,
                        status: message.status
                    };

                    // broadcast to all online members
                    const memberIds = (group.members || []).map((id) => id.toString());
                    const onlineMemberIds = memberIds.filter((id) => onlineUsers.get(id) && onlineUsers.get(id).size > 0);

                    for (const memberId of onlineMemberIds) {
                        const memberSockets = onlineUsers.get(memberId);
                        if (!memberSockets) continue;
                        for (const socketId of memberSockets) {
                            io.to(socketId).emit('receiveMessage', cleanMessage);
                        }
                    }

                    // sender should already receive via broadcast, but keep consistent
                    socket.emit('receiveMessage', cleanMessage);
                    return;
                }

                // -------------------------
                // 1:1 MESSAGE
                // -------------------------
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
        socket.on('markAsRead', async ({ chatId, groupId }) => {
            try {
                // -------------------------
                // GROUP mark-as-read
                // -------------------------
                if (groupId) {
                    // When a member opens the group, mark all unread group messages as read
                    const unreadMessages = await Message.find({
                        groupId,
                        read: false
                    });

                    if (unreadMessages.length === 0) return;

                    const messageIds = unreadMessages.map((m) => m._id);
                    await Message.updateMany(
                        { _id: { $in: messageIds } },
                        { $set: { read: true, status: 'read' } }
                    );

                    // notify all online group members except sender is not known here, just broadcast
                    const Group = require('./models/Group');
                    const group = await Group.findById(groupId).lean();
                    if (!group) return;

                    for (const memberId of (group.members || []).map((id) => id.toString())) {
                        const memberSockets = onlineUsers.get(memberId);
                        if (!memberSockets) continue;
                        for (const socketId of memberSockets) {
                            io.to(socketId).emit('messageStatusUpdate', {
                                messageIds,
                                status: 'read'
                            });
                        }
                    }

                    return;
                }

                // -------------------------
                // 1:1 mark-as-read
                // -------------------------
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
        // DELETE MESSAGE (soft delete)
        // =========================
        socket.on('deleteMessage', async ({ messageId, scope }) => {
            try {
                if (!messageId || !scope) return;

                const message = await Message.findById(messageId);
                if (!message) return;

                const isParticipant =
                    message.sender?.toString?.() === userId?.toString?.() ||
                    message.receiver?.toString?.() === userId?.toString?.();
                if (!isParticipant) return;

                const scopeSafe = scope === 'everyone' ? 'everyone' : 'me';

                if (scopeSafe === 'me') {
                    message.deletedForMe = Array.isArray(message.deletedForMe) ? message.deletedForMe : [];
                    const already = message.deletedForMe.some((id) => id?.toString?.() === userId.toString());
                    if (!already) message.deletedForMe.push(userId);
                    message.deletedAt = message.deletedAt || new Date();
                    await message.save();

                    io.to(socket.id).emit('messageDeleted', {
                        messageId,
                        scope: 'me'
                    });
                    return;
                }

                // everyone
                message.deletedForEveryone = true;
                message.deletedAt = message.deletedAt || new Date();
                await message.save();

                const payload = {
                    messageId,
                    scope: 'everyone'
                };

                const senderSockets = onlineUsers.get(message.sender.toString());
                if (senderSockets) {
                    for (const sid of senderSockets) io.to(sid).emit('messageDeleted', payload);
                }

                const receiverSockets = message.receiver
                    ? onlineUsers.get(message.receiver.toString())
                    : null;
                if (receiverSockets) {
                    for (const sid of receiverSockets) io.to(sid).emit('messageDeleted', payload);
                }
            } catch (err) {
                console.error('DELETE MESSAGE ERROR:', err);
            }
        });

        // =========================
        // FORWARD MESSAGE
        // =========================
        socket.on('forwardMessage', async ({ message, recipientIds }) => {
            try {
                if (!message || !Array.isArray(recipientIds) || recipientIds.length === 0) return;

                const safeRecipientIds = recipientIds
                    .map((id) => id?.toString?.())
                    .filter(Boolean)
                    .slice(0, 5);

                if (safeRecipientIds.length === 0) return;

                const original = await Message.findById(message._id);
                if (!original) return;

                const isParticipant =
                    original.sender?.toString?.() === userId?.toString?.() ||
                    original.receiver?.toString?.() === userId?.toString?.();
                if (!isParticipant) return;

                // Forward for 1:1 only in this app
                const textToForward = original.text || '';
                const mediaUrlToForward = original.mediaUrl || '';
                const mediaTypeToForward = original.mediaType || 'text';

                const createdMessages = [];

                for (const rid of safeRecipientIds) {
                    // do not forward to self
                    if (rid === userId?.toString?.()) continue;

                    // Receiver must be valid participant in 1:1 conversation? For now allow forwarding to any existing user.
                    const receiverSockets = onlineUsers.get(rid);
                    const isReceiverOnline = receiverSockets && receiverSockets.size > 0;
                    const status = isReceiverOnline ? 'delivered' : 'sent';

                    const fwdMsg = await Message.create({
                        sender: userId,
                        receiver: rid,
                        text: textToForward,
                        mediaUrl: mediaUrlToForward,
                        mediaType: mediaTypeToForward,
                        status
                    });

                    createdMessages.push({ fwdMsg, receiverId: rid });

                    const payload = {
                        _id: fwdMsg._id,
                        sender: userId,
                        receiver: rid,
                        text: textToForward,
                        mediaUrl: mediaUrlToForward,
                        mediaType: mediaTypeToForward,
                        createdAt: fwdMsg.createdAt,
                        status: fwdMsg.status,
                        isForwarded: true
                    };

                    if (isReceiverOnline) {
                        for (const socketId of receiverSockets) {
                            io.to(socketId).emit('receiveMessage', payload);
                        }
                    }

                    socket.emit('receiveMessage', payload);

                    // update sender status delivered when receiver is online
                    if (isReceiverOnline) {
                        const senderSockets = onlineUsers.get(userId);
                        if (senderSockets) {
                            for (const socketId of senderSockets) {
                                io.to(socketId).emit('messageStatusUpdate', {
                                    messageId: fwdMsg._id,
                                    status: 'delivered'
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('FORWARD MESSAGE ERROR:', err);
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

