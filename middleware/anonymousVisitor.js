const crypto = require('crypto');

function anonymousVisitor(req, res, next) {
    let visitorId = req.cookies?.visitor_id;

    if (!visitorId) {
        visitorId = crypto.randomUUID();
        
        res.cookie('visitor_id', visitorId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 10 * 365 * 24 * 60 * 60 * 1000, // 10 years
            path: '/'
        });
    }

    req.visitorId = visitorId;
    next();
}

module.exports = anonymousVisitor;