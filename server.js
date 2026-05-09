const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['1.1.1.1', '8.8.8.8', '8.8.4.4']);

const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const { Server } = require('socket.io');

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join", (userId) => {
        socket.join(userId);
    })

    socket.on("sendMesssage", (data) => {
        io.to(data.receiver).emit("receiveMessage", data);
    })

    socket.on("disconnet", () => {
        console.log("User disconnected");
    });
});

server.listen(5001, () => {
    console.log("Server running on port 5001");
});

app.use(cors());
app.use(express.json());

//Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/messages', require('./routes/messages'));

//Basic route
app.get('/', (req, res) => {
    res.send('WhatsApp Clone Backend Running')
});

//Initialize Socket
const initializeSocket = require('./socket');
initializeSocket(io);

const PORT = process.env.PORT || 5001;

// Connect to MongoDB then start server
connectDB().then(() => {
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}).catch(err => {
    console.error('Failed to connect to database', err);
});

module.exports = { io };