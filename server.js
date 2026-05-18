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

// CORS (important for Vercel frontend)
const allowedOrigins = [
    "http://localhost:5173",
    "https://whatsapp-clone-frontend-one.vercel.app"
];

app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/upload', require('./routes/upload'));

app.get('/', (req, res) => {
    res.send('Backend Running');
});

app.use((err, req, res, next) => {
    console.error('Express error:', err);

    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ msg: 'File too large. Max 10MB.' });
    }

    if (err.message?.includes('Invalid file type')) {
        return res.status(400).json({ msg: err.message });
    }

    res.status(500).json({ msg: err.message || 'Server error' });
});

// Socket
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    },

    transports: ['websocket', 'polling'],

    allowEIO3: true
});

// Initialize socket logic
require('./socket')(io);

const PORT = process.env.PORT || 5001

// Start server AFTER DB connects
connectDB().then(() => {
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}).catch(err => {
    console.error('DB error:', err);
});