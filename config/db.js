const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        if (!process.env.MONGO_URI) {
            throw new Error('MONGO_URI is not configured. Please set it in .env.');
        }

        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected');
    } catch (err) {
        console.error('MongoDB Connection Error:', err.message);
        if (process.env.NODE_ENV === 'production') {
            throw err;
        }
        console.warn('Continuing without MongoDB connection in non-production mode. Some features may not work.');
    }
};

module.exports = connectDB;