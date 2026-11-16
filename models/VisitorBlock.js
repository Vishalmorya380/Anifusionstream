const mongoose = require('mongoose');

const visitorBlockSchema = new mongoose.Schema({
    visitorId: { 
        type: String, 
        required: true, 
        unique: true 
    },
    reason: { 
        type: String, 
        default: 'Excessive requests' 
    },
    createdAt: { 
        type: Date, 
        default: Date.now, 
        expires: 300 // MongoDB automatically deletes this after 5 minutes
    } 
});

module.exports = mongoose.model('VisitorBlock', visitorBlockSchema);