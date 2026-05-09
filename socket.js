const Message = require('./models/Message');

let onlineUsers = new Map(); // userId -> socketId

module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);

        // User joins with their ID
        socket.on('join', (userId) => {
            onlineUsers.set(userId.toString(), socket.id);
            socket.userId = userId.toString();
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

                const receiverSocket = onlineUsers.get(data.receiver);

                // Send to receiver only
                if (receiverSocket) {
                    io.to(receiverSocket).emit('receiveMessage', savedMessage);
                }

                // Send back to sender
                socket.emit('receiveMessage', savedMessage);

            } catch (err) {
                console.error(err);
            }
        });

        socket.on('disconnect', () => {
            if (socket.userId) {
                onlineUsers.delete(socket.userId);
            }
        });
    });
};