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
    "https://whatsapp-clone-frontend-one.vercel.app"
];

const corsOptions = {
    origin: (origin, callback) => {
        // allow requests from any localhost port during development
        if (!origin || origin.startsWith('http://localhost')) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        return res.status(204).send();
    }
    next();
});
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/groups', require('./routes/groups'));

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

const PORT = parseInt(process.env.PORT, 10) || 5001;
const fallbackPort = PORT + 1;
const bindPorts = [PORT, fallbackPort];
let attemptIndex = 0;

const startServer = () => {
    const port = bindPorts[attemptIndex];
    server.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
};

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        if (attemptIndex === 0) {
            console.error(`Port ${bindPorts[0]} is already in use. Trying port ${bindPorts[1]}...`);
            attemptIndex = 1;
            server.listen(bindPorts[1]);
            return;
        }

        console.error(`Port ${bindPorts[1]} is already in use. Cannot start server.`);
        process.exit(1);
    }

    console.error('Server error:', error);
    process.exit(1);
});

// Start server AFTER DB connects
connectDB().then(() => {
    startServer();
}).catch((err) => {
    console.error('DB error:', err);
});