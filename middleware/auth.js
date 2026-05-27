const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
    const tokenHeader = req.header('Authorization') || '';
    // Accept both: "Bearer <token>" and raw token.
    const token = tokenHeader.startsWith('Bearer ')
        ? tokenHeader.replace('Bearer ', '').trim()
        : tokenHeader.trim();


    if (!token) {
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};

module.exports = auth;