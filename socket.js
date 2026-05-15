const jwt = require('jsonwebtoken');
const Message = require('./models/Message');
const User = require('./models/User');

let onlineUsers = new Map();

module.exports = (io) => {

    io.use((socket, next) => {
        try {
            const token = socket.handshake.auth.token;

            if (!token) {
                return next(new Error('Authentication error'));
            }

            const decoded = jwt.verify(
                token,
                process.env.JWT_SECRET
            );

            socket.user = decoded;

            next();

        } catch (err) {
            next(new Error('Authentication error'));
        }
    });

    io.on('connection', (socket) => {

        console.log('User connected:', socket.id);

        socket.on('join', async (userId) => {

    onlineUsers.set(userId.toString(), socket.id);

    socket.userId = userId.toString();

    // Update DB
    await User.findByIdAndUpdate(userId, {
        isOnline: true
    });

    // Notify everyone
    io.emit('userStatusChanged', {
        userId,
        isOnline: true
    });

    console.log("JOINED:", userId);
});

        socket.on('sendMessage', async (data) => {

            try {

                if (!data.text || !data.text.trim()) {
                    return;
                }

                const message = new Message({
                    sender: socket.user.id,
                    receiver: data.receiver,
                    text: data.text.trim(),
                    mediaType: data.mediaType || 'text'
                });

                await message.save();

                const savedMessage = await Message.findById(message._id);

                const receiverSocket =
                    onlineUsers.get(data.receiver.toString());

                // Send to receiver
                if (receiverSocket) {
                    io.to(receiverSocket)
                      .emit('receiveMessage', savedMessage);
                }

                // Send back to sender
                socket.emit('receiveMessage', savedMessage);

            } catch (err) {
                console.error(err);
            }
        });

        socket.on('disconnect', async () => {

    if (socket.userId) {

        onlineUsers.delete(socket.userId);

        const lastSeen = new Date();

        // Update DB
        await User.findByIdAndUpdate(socket.userId, {
            isOnline: false,
            lastSeen
        });

        // Notify everyone
        io.emit('userStatusChanged', {
            userId: socket.userId,
            isOnline: false,
            lastSeen
        });
    }

    console.log('Disconnected:', socket.id);
});
    });
};