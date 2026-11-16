const rateLimit = require('express-rate-limit');
const VisitorBlock = require('../models/VisitorBlock');

// 1. Check if they are in the penalty box
const checkPenaltyBox = async (req, res, next) => {
    // FIXED: Skip admin dashboard actions so the owner is never locked out of the penalty box
    const adminPath = process.env.ADMIN_PATH || '/admin';
    if (req.path.startsWith(adminPath)) {
        return next();
    }

    // Skip static assets
    if (req.path.startsWith('/public') || req.path.startsWith('/uploads') || req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|mp3|woff|woff2|ttf)$/)) {
        return next();
    }

    try {
        const isBlocked = await VisitorBlock.findOne({ visitorId: req.visitorId });
        
        if (isBlocked) {
            return res.status(429).render('404', { 
                title: '429 - Too Many Requests',
                error: 'You are sending too many requests. Please wait 5 minutes and refresh the page.'
            });
        }
        next();
    } catch (err) {
        console.error('Penalty Box Error:', err);
        next();
    }
};

// 2. Count requests per cookie (100 per minute)
const visitorCounter = rateLimit({
    windowMs: 1 * 60 * 1000, //  Yahan TIME set hota hai (1 minute = 60000 milliseconds)
    max: 100, //  Yahan LIMIT set hoti hai (Maximum 100 requests)
    keyGenerator: (req) => req.visitorId, // Group by cookie, not IP
    
    handler: async (req, res, next, options) => {
        try {
            await VisitorBlock.findOneAndUpdate(
                { visitorId: req.visitorId },
                { reason: 'Exceeded 100 requests per minute' },
                { upsert: true, new: true }
            );
        } catch (err) {
            console.error('Error saving block to DB:', err);
        }
        
        res.status(429).render('404', { 
            title: '429 - Too Many Requests',
            error: 'You have been temporarily blocked for excessive requests. Please try again in 5 minutes.'
        });
    },
    skip: (req) => {
        // Skip all admin dashboard actions
        const adminPath = process.env.ADMIN_PATH || '/admin';
        if (req.path.startsWith(adminPath)) return true;

        return req.path.startsWith('/public') ||
               req.path.startsWith('/uploads') || 
               req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|mp3|woff|woff2|ttf)$/);
    }
});

module.exports = { checkPenaltyBox, visitorCounter };