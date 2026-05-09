const Message = require('./models/Message');
const User = require('./models/User');

let onlineUsers = new Map(); // userId -> socketId

module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);

        // User joins with their ID
        socket.on('join', (userId) => {
            onlineUsers.set(userId.toString(), socket.id);
            socket.userId = userId.toString();
            console.log(`User ${userId} joined`);
        });

        // Send Message
        socket.on('sendMessage', async (data) => {
            try {
                const message = new Message({
                    sender: data.sender,
                    receiver: data.receiver,
                    text: data.text,
                    mediaType: data.mediaType || 'text'
                });

                await message.save();

                const savedMessage = await message.populate('sender receiver');

                console.log("ONLINE USERS MAP:", onlineUsers);
                console.log("RECEIVER ID:", data.receiver);

                // Send to receiver if online
                io.emit('receiveMessage', savedMessage);

                // Send back to sender
                socket.emit('receiveMessage', savedMessage);

            } catch (err) {
                console.error("Message save error:", err);
            }
        });

        socket.on('disconnect', () => {
            if (socket.userId) {
                onlineUsers.delete(socket.userId);
            }
        });
    });
};