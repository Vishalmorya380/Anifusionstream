const express = require('express');
const router = express.Router();

/*
// ============================================================================
// FUTURE USER AUTHENTICATION & SECURITY ROUTES
// ============================================================================
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

// 🚨 STRICT OTP LIMITER: Maximum 3 OTP requests per 15 minutes per IP
const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 3, 
    message: 'Too many OTP requests from this IP, please try again after 15 minutes.',
    handler: (req, res) => {
        req.flash('error', 'Too many OTP requests. Please wait 15 minutes.');
        res.redirect('back');
    }
});


// ==========================================
// 1. REGISTRATION ROUTES
// ==========================================
router.get('/register', (req, res) => {
    res.render('user-register');
});

// otpLimiter lagaya gaya hai taaki bots fake accounts na banayein
router.post('/register', otpLimiter, async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // 1. DATABASE CHECK: Email ya Username pehle se to nahi hai?
        const existingUser = await User.findOne({ 
            $or: [{ email: email.toLowerCase() }, { username: username }] 
        });

        if (existingUser) {
            req.flash('error', 'Email or Username already exists!');
            return res.redirect('/user/register');
        }

        // Generate OTP & Send Email Logic Here
        
        req.flash('success', 'OTP sent to your email.');
        res.redirect('/user/register-verify-otp');
    } catch (err) {
        console.error('Registration Error:', err);
        req.flash('error', 'An error occurred during registration.');
        res.redirect('/user/register');
    }
});

router.get('/register-verify-otp', (req, res) => {
    res.render('user-register-verify-otp');
});

router.post('/register-verify-otp', async (req, res) => {
    try {
        const { otp } = req.body;
        
        // Match OTP Logic Here
        
        res.redirect('/home');
    } catch (err) {
        console.error('OTP Verification Error:', err);
        req.flash('error', 'Invalid verification code.');
        res.redirect('/user/register-verify-otp');
    }
});

// otpLimiter is route par bhi zaroori hai
router.post('/resend-register-otp', otpLimiter, async (req, res) => {
    try {
        // Resend OTP Logic Here

        req.flash('success', 'Verification code resent successfully.');
        res.redirect('/user/register-verify-otp');
    } catch (err) {
        console.error('OTP Resend Error:', err);
        req.flash('error', 'Failed to resend code.');
        res.redirect('/user/register-verify-otp');
    }
});


// ==========================================
// 2. LOGIN & LOGOUT ROUTES
// ==========================================
router.get('/login', (req, res) => {
    res.render('user-login');
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // DB Check & bcrypt compare Logic Here

        res.redirect('/home');
    } catch (err) {
        console.error('Login Error:', err);
        req.flash('error', 'Invalid email or password.');
        res.redirect('/user/login');
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('anifusion.sid', { path: '/' });
        res.redirect('/home');
    });
});


// ==========================================
// 3. FORGOT PASSWORD & SECURITY ROUTES
// ==========================================
router.get('/forgot-password', (req, res) => {
    res.render('user-forgot-password');
});

// otpLimiter ensures no one spams email sending
router.post('/forgot-password', otpLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        
        // 1. DATABASE CHECK: Kya user sach mein exist karta hai?
        const user = await User.findOne({ email: email.toLowerCase() });
        
        if (!user) {
            // Generic message to prevent email enumeration (hacker shouldn't know if email exists)
            req.flash('success', 'If this email exists, an OTP will be sent.');
            return res.redirect('/user/forgot-password-verify-otp');
        }

        // Generate Reset OTP & Send Email Logic Here
        
        req.flash('success', 'If this email exists, an OTP will be sent.');
        res.redirect('/user/forgot-password-verify-otp');
    } catch (err) {
        console.error('Forgot Password Error:', err);
        req.flash('error', 'Error generating reset code.');
        res.redirect('/user/forgot-password');
    }
});

// UPDATED: Route and View Name matching your new file name
router.get('/forgot-password-verify-otp', (req, res) => {
    res.render('user-forgot-password-verify-otp');
});

// UPDATED: Route name adjusted
router.post('/forgot-password-verify-otp', async (req, res) => {
    try {
        const { otp } = req.body;
        
        // Match OTP Logic Here

        res.redirect('/user/reset-password');
    } catch (err) {
        console.error('Reset OTP Error:', err);
        req.flash('error', 'Invalid reset code.');
        res.redirect('/user/forgot-password-verify-otp');
    }
});

// UPDATED: Route name adjusted & otpLimiter added
router.post('/forgot-password-resend-otp', otpLimiter, async (req, res) => {
    try {
        // Resend Reset OTP Logic Here

        req.flash('success', 'Reset code resent successfully.');
        res.redirect('/user/forgot-password-verify-otp');
    } catch (err) {
        console.error('Resend Reset OTP Error:', err);
        req.flash('error', 'Failed to resend reset code.');
        res.redirect('/user/forgot-password-verify-otp');
    }
});

router.get('/reset-password', (req, res) => {
    res.render('user-reset-password');
});

router.post('/reset-password', async (req, res) => {
    try {
        const { newPassword, confirmPassword } = req.body;

        // Backend Match Check (Frontend bypass hone par bhi fail hoga)
        if (newPassword !== confirmPassword) {
            req.flash('error', 'Passwords do not match.');
            return res.redirect('/user/reset-password');
        }

        // Update DB Password Logic Here

        req.flash('success', 'Password updated successfully! Please login.');
        res.redirect('/user/login');
    } catch (err) {
        console.error('Reset Password Error:', err);
        req.flash('error', 'Error updating password.');
        res.redirect('/user/reset-password');
    }
});
*/

module.exports = router;