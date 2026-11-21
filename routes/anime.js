const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');

// Models
const Anime = require('../models/Anime');
const Episode = require('../models/Episode');
const Comment = require('../models/Comment');

// Rate limiter for comments - 5 comments per minute per IP/Visitor
const commentLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 5,
    message: 'Too many comments. Please wait.',
    keyGenerator: (req) => req.visitorId
});

// Helper: Validate MongoDB ID
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Helper: Sanitize comment - no HTML allowed
const cleanComment = (text) => sanitizeHtml(text.trim(), {
    allowedTags: [],
    allowedAttributes: {}
});

// Helper: Resolve slug redirect URL from animeId
async function getAnimeUrl(animeId) {
    const anime = await Anime.findById(animeId).select('slug').lean();
    return anime && anime.slug ? `/anime/${anime.slug}` : '/';
}

// ==========================================
// PUBLIC VIEWS
// ==========================================

/**
 * GET /
 * Latest Releases Feed - PUBLIC
 */
router.get('/', async (req, res) => {
    try {
        const latestEpisodesData = await Episode.find()
            .sort({ createdAt: -1 })
            .limit(12)
            .populate('anime', 'name slug imageUrl type')
            .lean();

        const latestEpisodes = latestEpisodesData.map(episode => ({
            ...episode,
            animeId: episode.anime ? episode.anime._id : null,
            animeSlug: episode.anime ? episode.anime.slug : '',
            animeTitle: episode.anime ? episode.anime.name : 'Unknown',
            animeImage: episode.anime ? episode.anime.imageUrl : '',
            seasonNumber: episode.seasonNumber,
            type: episode.anime ? episode.anime.type : 'series'
        }));

        res.render('latest-episodes', { latestEpisodes });
    } catch (error) {
        console.error('Latest episodes error:', error);
        res.status(500).render('404');
    }
});

/**
 * GET /:slug
 * View Anime Details - PUBLIC: No login required
 */
router.get('/:slug', async (req, res) => {
    try {
        const slug = req.params.slug.toLowerCase();

        const anime = await Anime.findOne({ slug })
            .populate('genres')
            .populate({
                path: 'seasons.episodes',
                model: 'Episode'
            });

        if (!anime) return res.status(404).render('404');

        const comments = await Comment.find({ anime: anime._id, parentComment: null })
            .populate('replies')
            .sort({ createdAt: -1 })
            .lean();

        const randomAnimes = await Anime.aggregate([
            { $match: { _id: { $ne: anime._id } } },
            { $sample: { size: 8 } }
        ]);

        res.render('anime-detail', {
            anime,
            comments,
            session: req.session,
            randomAnimes,
            guestId: req.session?.userId || req.visitorId
        });

    } catch (error) {
        console.error('View Anime Error:', error);
        res.status(500).render('404');
    }
});

// ==========================================
// USER INTERACTIONS (COMMENTS & RATINGS)
// ==========================================

/**
 * POST /rate/:id
 * Handle Anime Ratings
 */
router.post('/rate/:id', async (req, res) => {
    try {
        const { rating } = req.body;
        const animeId = req.params.id;
        const voterId = req.session?.userId || req.visitorId;

        if (!voterId) {
            return res.status(400).json({ success: false, message: 'Could not verify visitor identity.' });
        }

        if (!rating || rating < 2 || rating > 10) {
            return res.status(400).json({ success: false, message: 'Invalid rating value.' });
        }

        const anime = await Anime.findById(animeId);
        if (!anime) return res.status(404).json({ success: false, message: 'Anime not found.' });

        if (!anime.votedUsers) anime.votedUsers = [];
        if (typeof anime.ratingCount !== 'number') anime.ratingCount = 0;
        if (typeof anime.totalRatingSum !== 'number') anime.totalRatingSum = 0;

        if (anime.votedUsers.includes(voterId)) {
            return res.json({ success: false, message: 'You have already voted for this anime!' });
        }

        anime.votedUsers.push(voterId);
        anime.ratingCount += 1;
        anime.totalRatingSum += rating;
        anime.ratingScore = anime.totalRatingSum / anime.ratingCount;

        await anime.save();

        const newPercentage = Math.round((anime.ratingScore / 10) * 100);

        res.json({
            success: true,
            newAverage: anime.ratingScore,
            newCount: anime.ratingCount,
            newPercentage: newPercentage
        });

    } catch (err) {
        console.error('Rating Error:', err);
        res.status(500).json({ success: false, message: 'Server error. Failed to save vote.' });
    }
});

/**
 * POST /comment/:animeId
 * Guest can comment - max 5 per anime
 */
router.post('/comment/:animeId', commentLimiter, async (req, res) => {
    const { animeId } = req.params;
    const { content, guestName, guestEmail } = req.body;

    if (!isValidId(animeId)) {
        req.flash('error', 'Invalid anime.');
        return res.redirect('/');
    }

    const redirectUrl = await getAnimeUrl(animeId);
    const cleanContent = cleanComment(content || '');
    const cleanName = cleanComment(guestName || '').substring(0, 50);
    const cleanEmail = (guestEmail || '').trim().toLowerCase();

    if (!cleanContent || cleanContent.length < 2) {
        req.flash('error', 'Comment too short.');
        return res.redirect(redirectUrl);
    }

    if (!cleanName || cleanName.length < 2) {
        req.flash('error', 'Name is required.');
        return res.redirect(redirectUrl);
    }

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        req.flash('error', 'Valid email is required.');
        return res.redirect(redirectUrl);
    }

    if (cleanContent.length > 500) {
        req.flash('error', 'Comment too long. Max 500 characters.');
        return res.redirect(redirectUrl);
    }

    try {
        const activeUserId = req.session?.userId || req.visitorId;

        const userCommentCount = await Comment.countDocuments({
            anime: animeId,
            guestId: activeUserId,
            parentComment: null
        });

        if (userCommentCount >= 5) {
            req.flash('error', 'Comment limit reached at max 5. If you want to make another comment, delete an old comment first.');
            return res.redirect(redirectUrl);
        }

        const comment = new Comment({
            anime: animeId,
            guestId: activeUserId,
            username: cleanName,
            guestEmail: cleanEmail,
            content: cleanContent,
            isAdmin: !!req.session.isAdminAuthenticated
        });

        await comment.save();
        req.flash('success', 'Comment posted.');
        res.redirect(redirectUrl);
    } catch (error) {
        console.error('Comment post error:', error);
        req.flash('error', 'Failed to post comment.');
        res.redirect(redirectUrl);
    }
});

/**
 * POST /comment/reply/:animeId/:commentId
 * Guest can reply
 */
router.post('/comment/reply/:animeId/:commentId', commentLimiter, async (req, res) => {
    const { animeId, commentId } = req.params;
    const { content, guestName, guestEmail } = req.body;

    if (!isValidId(animeId) || !isValidId(commentId)) {
        req.flash('error', 'Invalid ID.');
        return res.redirect('/');
    }

    const redirectUrl = await getAnimeUrl(animeId);
    const cleanContent = cleanComment(content || '');
    const cleanName = cleanComment(guestName || '').substring(0, 50);
    const cleanEmail = (guestEmail || '').trim().toLowerCase();

    if (!cleanContent || cleanContent.length < 2) {
        req.flash('error', 'Reply too short.');
        return res.redirect(redirectUrl);
    }

    if (!cleanName || cleanName.length < 2) {
        req.flash('error', 'Name is required.');
        return res.redirect(redirectUrl);
    }

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        req.flash('error', 'Valid email is required.');
        return res.redirect(redirectUrl);
    }

    try {
        const parent = await Comment.findById(commentId);
        if (!parent) {
            req.flash('error', 'Parent comment not found.');
            return res.redirect(redirectUrl);
        }

        const activeUserId = req.session?.userId || req.visitorId;

        const reply = new Comment({
            anime: animeId,
            guestId: activeUserId,
            username: cleanName,
            guestEmail: cleanEmail,
            content: cleanContent,
            parentComment: commentId,
            isAdmin: !!req.session.isAdminAuthenticated
        });

        const savedReply = await reply.save();
        parent.replies.push(savedReply._id);
        await parent.save();

        req.flash('success', 'Reply posted.');
        res.redirect(redirectUrl);
    } catch (error) {
        console.error('Reply error:', error);
        res.redirect(redirectUrl);
    }
});

/**
 * POST /comment/delete/:animeId/:commentId
 * Guest can only delete their own comments - Admin can delete any
 */
router.post('/comment/delete/:animeId/:commentId', async (req, res) => {
    const { animeId, commentId } = req.params;

    if (!isValidId(animeId) || !isValidId(commentId)) {
        req.flash('error', 'Invalid ID.');
        return res.redirect('/');
    }

    const redirectUrl = await getAnimeUrl(animeId);

    try {
        const comment = await Comment.findById(commentId);
        if (!comment) return res.redirect(redirectUrl);

        const isAdmin = !!req.session.isAdminAuthenticated;
        const activeUserId = req.session?.userId || req.visitorId;
        const isOwner = comment.guestId === activeUserId;

        if (!isAdmin && !isOwner) {
            req.flash('error', 'You can only delete your own comments.');
            return res.redirect(redirectUrl);
        }

        const cleanDelete = async (id) => {
            const replies = await Comment.find({ parentComment: id });
            for (const r of replies) {
                await cleanDelete(r._id);
                await Comment.findByIdAndDelete(r._id);
            }
        };

        await cleanDelete(commentId);

        if (comment.parentComment) {
            await Comment.findByIdAndUpdate(comment.parentComment, { $pull: { replies: commentId } });
        }

        await Comment.findByIdAndDelete(commentId);
        req.flash('success', 'Comment removed.');
        res.redirect(redirectUrl);

    } catch (error) {
        console.error('Delete Comment Error:', error);
        res.redirect(redirectUrl);
    }
});

module.exports = router;