const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { clearSessionCache } = require('../middleware/auth');

// Define the dynamic admin path for redirects
const adminBase = process.env.ADMIN_PATH || '/admin';

// Models
const Anime = require('../models/Anime');
const Episode = require('../models/Episode');
const Genre = require('../models/Genre');
const Admin = require('../models/Admin');
const Contact = require('../models/Contact');

// Middleware
const { ensureAuthenticatedAdmin } = require('../middleware/auth');

// Rate limiter for auth routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many attempts. Try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Helper: Validate MongoDB ID
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Helper: Escape regex special characters
const escapeRegex = (text) => {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
};

// ==========================================
// 1. AUTHENTICATION (LOGIN & REGISTER)
// ==========================================

//  Admin (LOGIN)
router.get('/login', (req, res) => {
    res.render('admin-login');
});

router.post('/login', authLimiter, async (req, res) => {
    try {
        let { username, password } = req.body;
        if (!username || !password) {
            req.flash('error', 'Administrator ID and Access Key are required.');
            return res.redirect(`${adminBase}/login`);
        }

        username = username.toLowerCase().trim();
        const admin = await Admin.findOne({ username });

        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            req.flash('error', 'Invalid security credentials.');
            return res.redirect(`${adminBase}/login`);
        }

        req.session.isAdminAuthenticated = true;
        req.session.adminId = admin._id.toString();
        req.session.adminUsername = admin.username;

        req.session.save(() => {
            req.flash('success', 'Authorization successful. Welcome back.');
            res.redirect(`${adminBase}/dashboard`);
        });
    } catch (err) {
        console.error("Admin Login Error:", err);
        req.flash('error', 'Security system failure.');
        res.redirect(`${adminBase}/login`);
    }
});

//  Admin (REGISTER)
/* ==========================================
   TEMPORARILY DISABLED FOR SECURITY
   ==========================================
router.get('/register', (req, res) => {
     res.render('admin-register');
});

router.post('/register', authLimiter, async (req, res) => {
     try {
         let { username, password, confirmPassword, adminCode } = req.body;

         if (!process.env.ADMIN_CODE || adminCode !== process.env.ADMIN_CODE) {
             req.flash('error', 'Access Denied: Invalid Master Admin Code.');
             return res.redirect(`${adminBase}/register`);
         }

         if (password !== confirmPassword) {
             req.flash('error', 'Security Alert: Passwords do not match.');
             return res.redirect(`${adminBase}/register`);
         }

         if (password.length < 8) {
             req.flash('error', 'Key Strength: Password must be at least 8 characters.');
             return res.redirect(`${adminBase}/register`);
         }

         username = username.toLowerCase().trim();
         if (await Admin.findOne({ username })) {
             req.flash('error', 'ID Conflict: Administrator already exists.');
             return res.redirect(`${adminBase}/register`);
         }

         const hashed = await bcrypt.hash(password, 12);
         await Admin.create({ username, password: hashed });

         req.flash('success', 'Registration authorized. Please login to your new console.');
         res.redirect(`${adminBase}/login`);
     } catch (err) {
         console.error("Admin Register Error:", err);
         req.flash('error', 'System registration failed.');
         res.redirect(`${adminBase}/register`);
     }
});
========================================== */

// ==========================================
// 2. PASSWORD RECOVERY (FORGOT/RESET)
// ==========================================

router.get('/forgot-password', (req, res) => {
    res.render('admin-forgot-password');
});

router.post('/forgot-password', authLimiter, async (req, res) => {
    try {
        const { username, adminCode } = req.body;
        if (!process.env.ADMIN_CODE || adminCode !== process.env.ADMIN_CODE) {
            req.flash('error', 'Security Violation: Invalid Master Code.');
            return res.redirect(`${adminBase}/forgot-password`);
        }

        const admin = await Admin.findOne({ username: username.toLowerCase().trim() });
        if (!admin) {
            req.flash('error', 'ID Not Found: Administrator does not exist.');
            return res.redirect(`${adminBase}/forgot-password`);
        }

        req.session.canResetAdminPassword = true;
        req.session.resetAdminUsername = admin.username;

        req.session.save(() => {
            req.flash('success', 'Identity confirmed. Proceeding to Key Reset.');
            res.redirect(`${adminBase}/reset-password`);
        });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.redirect(`${adminBase}/forgot-password`);
    }
});

router.get('/reset-password', (req, res) => {
    if (!req.session.canResetAdminPassword || !req.session.resetAdminUsername) {
        req.flash('error', 'Session expired. Start again.');
        return res.redirect(`${adminBase}/forgot-password`);
    }
    res.render('admin-reset-password');
});

router.post('/reset-password', async (req, res) => {
    try {
        if (!req.session.canResetAdminPassword || !req.session.resetAdminUsername) {
            req.flash('error', 'Session expired.');
            return res.redirect(`${adminBase}/forgot-password`);
        }

        const { password, confirmPassword } = req.body;
        const username = req.session.resetAdminUsername;

        if (password !== confirmPassword) {
            req.flash('error', 'Passwords do not match.');
            return res.redirect(`${adminBase}/reset-password`);
        }

        if (!password || password.length < 8) {
            req.flash('error', 'Key Insufficient: Security length not met.');
            return res.redirect(`${adminBase}/reset-password`);
        }

        const hashed = await bcrypt.hash(password, 12);
        await Admin.findOneAndUpdate({ username }, { password: hashed });

        delete req.session.canResetAdminPassword;
        delete req.session.resetAdminUsername;

        req.session.save(() => {
            req.flash('success', 'Master access key updated. System relogin required.');
            res.redirect(`${adminBase}/login`);
        });
    } catch (err) {
        console.error('Reset password error:', err);
        res.redirect(`${adminBase}/reset-password`);
    }
});

// ==========================================
// 3. DASHBOARD & SYSTEM MONITORING
// ==========================================

router.get('/dashboard', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 20; 
        const skip = (page - 1) * limit;
        
        const searchQuery = req.query.q ? req.query.q.trim() : '';
        const filterQuery = req.query.filter || 'all';

        let query = {};

        if (searchQuery) {
            query.name = { $regex: escapeRegex(searchQuery),$options: 'i' };
        }

        switch (filterQuery) {
            case 'series_all': query.type = 'series'; break;
            case 'series_with_ep': 
                query.type = 'series'; 
                query.seasons = { $elemMatch: { 'episodes.0': {$exists: true } } }; 
                break;
            case 'series_without_ep': 
                query.type = 'series'; 
                query.seasons = { $not: { $elemMatch: { 'episodes.0': {$exists: true } } } }; 
                break;
            case 'movie_all': query.type = 'movie'; break;
            case 'movie_with_ep': 
                query.type = 'movie'; 
                query.seasons = { $elemMatch: { 'episodes.0': {$exists: true } } }; 
                break;
            case 'movie_without_ep': 
                query.type = 'movie'; 
                query.seasons = { $not: { $elemMatch: { 'episodes.0': {$exists: true } } } }; 
                break;
        }

        const [totalAnimes, userMessages, animes] = await Promise.all([
            Anime.countDocuments(query),
            Contact.find().sort({ createdAt: -1 }).lean(),
            Anime.find(query)
                .populate('genres')
                .populate({ path: 'seasons.episodes', model: 'Episode' })
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean()
        ]);

        const totalPages = Math.ceil(totalAnimes / limit) || 1;

        animes.forEach(anime => {
            if (anime.seasons) {
                anime.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
                anime.seasons.forEach(season => {
                    if (season.episodes) {
                        season.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
                    }
                });
            }
        });

        res.render('admin-dashboard', {
            animes: animes || [],
            userMessages: userMessages || [],
            currentPage: page,
            totalPages,
            totalAnimes,
            searchQuery,
            currentFilter: filterQuery
        });
    } catch (err) {
        console.error("Dashboard Error:", err);
        res.status(500).send("Critical Core Failure");
    }
});

router.post('/delete-message/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid ID format.');
            return res.redirect(`${adminBase}/dashboard`);
        }
        await Contact.findByIdAndDelete(req.params.id);
        req.flash('success', 'Intelligence report cleared.');
    } catch (err) {
        req.flash('error', 'Protocol failure: Could not delete report.');
    }
    res.redirect(`${adminBase}/dashboard`);
});

// Helper to normalize form array fields
function toArray(val) {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
}

// ==========================================
// 4. ANIME MANAGEMENT (CRUD)
// ==========================================

router.get('/add-anime', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const genres = await Genre.find().lean();
        res.render('admin-add-anime', { genres });
    } catch (err) {
        res.redirect(`${adminBase}/dashboard`);
    }
});

router.post('/add-anime', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const {
            name, imageUrl, description, genres, specialInfo,
            type, languageFormat, anilistId, tmdbId,
            seasonNumbers, seasonAnilistIds
        } = req.body;

        if (!name || !name.trim()) {
            req.flash('error', 'Anime name is required.');
            return res.redirect(`${adminBase}/add-anime`);
        }

        const trimmedName = name.trim();
        const existingAnime = await Anime.findOne({
            name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') }
        });

        if (existingAnime) {
            req.flash('error', `Duplicate detected: "${trimmedName}" already exists in catalog.`);
            return res.redirect(`${adminBase}/add-anime`);
        }

        const animeData = {
            name: trimmedName,
            imageUrl: imageUrl?.trim() || '',
            description: description?.trim() || '',
            specialInfo: specialInfo?.trim() || '',
            languageFormat: languageFormat?.trim() || '',
            genres: toArray(genres),
            type: type || 'series',
            seasons: []
        };

        if (anilistId && !isNaN(Number(anilistId))) {
            animeData.anilistId = Number(anilistId);
        }
        if (tmdbId && !isNaN(Number(tmdbId))) {
            animeData.tmdbId = Number(tmdbId);
        }

        // Build per-season AniList IDs ONLY when an AniList ID is actually filled (0 = OVA/Specials allowed)
        const sNums = toArray(seasonNumbers);
        const sIds = toArray(seasonAnilistIds);
        const seenSeasons = new Set();

        for (let i = 0; i < sNums.length; i++) {
            if (sNums[i] === '' || sNums[i] === undefined || sNums[i] === null) continue;
            const sNum = Number(sNums[i]);
            const sAlId = sIds[i] && !isNaN(Number(sIds[i])) ? Number(sIds[i]) : undefined;
            if (!isNaN(sNum) && sNum >= 0 && sAlId && !seenSeasons.has(sNum)) {
                seenSeasons.add(sNum);
                animeData.seasons.push({
                    seasonNumber: sNum,
                    anilistId: sAlId,
                    episodes: []
                });
            }
        }

        // If Season 1 wasn't manually added but main anilistId exists, initialize Season 1
        if (animeData.type === 'series' && animeData.anilistId && !seenSeasons.has(1)) {
            animeData.seasons.unshift({
                seasonNumber: 1,
                anilistId: animeData.anilistId,
                episodes: []
            });
        }

        animeData.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);

        await Anime.create(animeData);

        req.flash('success', 'Catalog Updated: New anime title initialized.');
        res.redirect(`${adminBase}/dashboard`);

    } catch (err) {
        console.error('Add anime error:', err);
        if (err.code === 11000) {
            req.flash('error', `Protocol failure: Duplicate name or AniList ID already exists.`);
            return res.redirect(`${adminBase}/add-anime`);
        }
        req.flash('error', 'Protocol failure: Anime not added - ' + err.message);
        res.redirect(`${adminBase}/add-anime`);
    }
});

router.get('/edit-anime/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid anime ID.');
            return res.redirect(`${adminBase}/dashboard`);
        }
        const anime = await Anime.findById(req.params.id).populate('genres').lean();
        const genres = await Genre.find().lean();
        if (!anime) return res.redirect(`${adminBase}/dashboard`);

        if (anime.seasons && anime.seasons.length > 0) {
            anime.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
        }

        res.render('admin-edit-anime', { anime, genres });
    } catch (err) {
        res.redirect(`${adminBase}/dashboard`);
    }
});

router.post('/edit-anime/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid anime ID.');
            return res.redirect(`${adminBase}/dashboard`);
        }

        const anime = await Anime.findById(req.params.id);
        if (!anime) {
            req.flash('error', 'Anime not found.');
            return res.redirect(`${adminBase}/dashboard`);
        }

        const {
            name, imageUrl, description, genres, specialInfo,
            type, languageFormat, anilistId, tmdbId,
            seasonNumbers, seasonAnilistIds, bumpToTop
        } = req.body;
        const trimmedName = name.trim();

        const duplicate = await Anime.findOne({
            _id: { $ne: req.params.id },
            name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') }
        });

        if (duplicate) {
            req.flash('error', `Name conflict: "${trimmedName}" already used by another anime.`);
            return res.redirect(`${adminBase}/edit-anime/${req.params.id}`);
        }

        anime.name = trimmedName;
        anime.imageUrl = imageUrl?.trim() || '';
        anime.description = description?.trim() || '';
        anime.specialInfo = specialInfo?.trim() || '';
        anime.languageFormat = languageFormat?.trim() || '';
        anime.genres = toArray(genres);
        anime.type = type || 'series';
        anime.anilistId = (anilistId && !isNaN(Number(anilistId))) ? Number(anilistId) : undefined;
        anime.tmdbId = (tmdbId && !isNaN(Number(tmdbId))) ? Number(tmdbId) : undefined;

        // Update per-season AniList IDs WITHOUT wiping existing episodes (0 = OVA/Specials allowed)
        const sNums = toArray(seasonNumbers);
        const sIds = toArray(seasonAnilistIds);

        for (let i = 0; i < sNums.length; i++) {
            if (sNums[i] === '' || sNums[i] === undefined || sNums[i] === null) continue;
            const sNum = Number(sNums[i]);
            if (isNaN(sNum) || sNum < 0) continue;

            const sAlId = (sIds[i] && !isNaN(Number(sIds[i]))) ? Number(sIds[i]) : undefined;
            const existingSeason = anime.seasons.find(s => s.seasonNumber === sNum);

            if (existingSeason) {
                existingSeason.anilistId = sAlId;
            } else if (sAlId) {
                // Only create a new season if an AniList ID was actually entered
                anime.seasons.push({
                    seasonNumber: sNum,
                    anilistId: sAlId,
                    episodes: []
                });
            }
        }

        // If Season 1 doesn't exist yet but main AniList ID is provided, initialize Season 1
        if (anime.type === 'series' && anime.anilistId && !anime.seasons.some(s => s.seasonNumber === 1)) {
            anime.seasons.unshift({
                seasonNumber: 1,
                anilistId: anime.anilistId,
                episodes: []
            });
        }

        anime.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);

        if (bumpToTop) {
            anime.updatedAt = new Date();
            await anime.save();
        } else {
            await anime.save({ timestamps: false });
        }

        req.flash('success', 'Metadata Refined: Anime details & season IDs saved.');
        res.redirect(`${adminBase}/dashboard`);

    } catch (err) {
        console.error('Edit anime error:', err);
        if (err.code === 11000) {
            req.flash('error', 'Duplicate name or AniList ID detected.');
            return res.redirect(`${adminBase}/edit-anime/${req.params.id}`);
        }
        req.flash('error', 'Catalog Error: Update failed.');
        res.redirect(`${adminBase}/dashboard`);
    }
});

router.post('/delete-anime/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid anime ID.');
            return res.redirect(`${adminBase}/dashboard`);
        }
        const anime = await Anime.findById(req.params.id);
        if (anime) {
            for (const season of anime.seasons) {
                await Episode.deleteMany({ _id: { $in: season.episodes } });
            }
            await anime.deleteOne();
            req.flash('success', 'Wiped: Title and associated data removed.');
        }
        res.redirect(`${adminBase}/dashboard`);
    } catch (err) {
        console.error('Delete anime error:', err);
        req.flash('error', 'Wipe Protocol Failure.');
        res.redirect(`${adminBase}/dashboard`);
    }
});

// ==========================================
// 5. EPISODE MANAGEMENT (CRUD)
// ==========================================

router.get('/add-episode/:animeId', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.animeId)) {
            req.flash('error', 'Invalid anime ID.');
            return res.redirect(`${adminBase}/dashboard`);
        }
        const anime = await Anime.findById(req.params.animeId).lean();
        if (!anime) {
            req.flash('error', 'Anime not found');
            return res.redirect(`${adminBase}/dashboard`);
        }
        res.render('admin-add-episode', { anime });
    } catch (err) {
        console.error('Get Add Episode Error:', err);
        req.flash('error', 'Something went wrong');
        res.redirect(`${adminBase}/dashboard`);
    }
});

router.post('/add-episode/:animeId', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const { animeId } = req.params;
        let { seasonNumber, episodeNumber, title, mainServerName, videoUrl, imageUrl, embedCode, servers } = req.body;

        if (!isValidId(animeId)) {
            req.flash('error', 'Invalid anime ID in URL');
            return res.redirect(`${adminBase}/dashboard`);
        }

        const anime = await Anime.findById(animeId);
        if (!anime) {
            req.flash('error', 'Anime not found in database');
            return res.redirect(`${adminBase}/dashboard`);
        }

        title = title?.trim();
        mainServerName = mainServerName?.trim() || 'Server 1';
        videoUrl = videoUrl?.trim() || '';
        embedCode = embedCode?.trim() || '';
        imageUrl = imageUrl?.trim() || '';

        if (!title) {
            req.flash('error', 'Episode title is required');
            return res.redirect(`${adminBase}/add-episode/${animeId}`);
        }

        // Parse multi-servers (Max 13 strictly enforced by slice)
        let parsedServers = [];
        if (servers && typeof servers === 'object') {
            const serverArray = Array.isArray(servers) ? servers : Object.values(servers);
            parsedServers = serverArray
                .filter(s => s && (s.videoUrl?.trim() || s.embedCode?.trim()))
                .slice(0, 13)
                .map((s, idx) => ({
                    name: s.name?.trim() || `Server ${idx + 2}`,
                    videoUrl: s.videoUrl?.trim() || '',
                    embedCode: s.embedCode?.trim() || '',
                    type: s.embedCode?.trim() ? 'iframe' : 'direct'
                }));
        }

        if (!videoUrl && !embedCode && parsedServers.length === 0) {
            req.flash('error', 'At least one Video URL or Embed Code is required');
            return res.redirect(`${adminBase}/add-episode/${animeId}`);
        }

        const season = anime.type === 'movie' ? 1 : parseInt(seasonNumber, 10);
        const episode = anime.type === 'movie' ? 1 : parseInt(episodeNumber, 10);

        if (isNaN(season) || isNaN(episode) || season < 0 || episode < 0) {
            req.flash('error', 'Invalid season or episode number');
            return res.redirect(`${adminBase}/add-episode/${animeId}`);
        }

        const existingSeason = anime.seasons.find(s => s.seasonNumber === season);
        if (existingSeason) {
            const duplicateCheck = await Episode.findOne({
                _id: { $in: existingSeason.episodes },
                episodeNumber: episode
            });

            if (duplicateCheck) {
                req.flash('error', `Season ${season} Episode ${episode} already exists`);
                return res.redirect(`${adminBase}/add-episode/${animeId}`);
            }
        }

        const newEpisode = await Episode.create({
            title,
            mainServerName,
            seasonNumber: season,
            episodeNumber: episode,
            imageUrl,
            videoUrl,
            embedCode,
            servers: parsedServers,
            anime: animeId,
            animeType: anime.type
        });

        let seasonObj = anime.seasons.find(s => s.seasonNumber === season);

        if (!seasonObj) {
            anime.seasons.push({
                seasonNumber: season,
                episodes: [newEpisode._id]
            });
        } else {
            seasonObj.episodes.push(newEpisode._id);
        }

        anime.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
        await anime.save();

        req.flash('success', `Deployment Success: S${season} E${episode} with ${parsedServers.length + 1} servers is live.`);
        res.redirect(`${adminBase}/dashboard`);

    } catch (err) {
        console.error('Add Episode Error:', err);
        if (err.name === 'ValidationError') {
            const errors = Object.values(err.errors).map(e => e.message);
            req.flash('error', `Validation Error: ${errors.join(', ')}`);
        } else if (err.code === 11000) {
            req.flash('error', 'This episode already exists in this season');
        } else {
            req.flash('error', 'Deployment Failed: ' + err.message);
        }
        res.redirect(`${adminBase}/add-episode/${req.params.animeId}`);
    }
});

router.get('/edit-episode/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid episode ID.');
            return res.redirect(`${adminBase}/dashboard`);
        }
        const episodeId = req.params.id;
        const episode = await Episode.findById(episodeId).lean();
        if (!episode) {
            req.flash('error', 'Signal Lost: Episode not found.');
            return res.redirect(`${adminBase}/dashboard`);
        }

        const anime = await Anime.findOne({ "seasons.episodes": episodeId }).lean();
        const season = anime ? anime.seasons.find(s =>
            s.episodes.some(e => e.toString() === episodeId)
        ) : null;

        res.render('admin-edit-episode', { episode, anime, season });
    } catch (err) {
        console.error("Episode Edit GET Error:", err);
        res.redirect(`${adminBase}/dashboard`);
    }
});

router.post('/edit-episode/:episodeId', ensureAuthenticatedAdmin, async (req, res) => {
    const { episodeId } = req.params;
    const { title, mainServerName, videoUrl, imageUrl, embedCode, episodeNumber, seasonNumber, servers } = req.body;

    if (!isValidId(episodeId)) {
        req.flash('error', 'Invalid ID.');
        return res.redirect(`${adminBase}/dashboard`);
    }

    try {
        const epNum = Number(episodeNumber);
        const sNum = Number(seasonNumber);

        if (
            episodeNumber === '' || seasonNumber === '' ||
            episodeNumber === undefined || seasonNumber === undefined ||
            isNaN(epNum) || isNaN(sNum) || epNum < 0 || sNum < 0
        ) {
            req.flash('error', 'Invalid season or episode number.');
            return res.redirect(`${adminBase}/edit-episode/${episodeId}`);
        }

        const oldEpisode = await Episode.findById(episodeId);
        if (!oldEpisode) {
            req.flash('error', 'Episode not found.');
            return res.redirect(`${adminBase}/dashboard`);
        }

        const anime = await Anime.findOne({ 'seasons.episodes': episodeId });
        if (!anime) {
            req.flash('error', 'Parent anime not found.');
            return res.redirect(`${adminBase}/dashboard`);
        }

        // Parse servers securely
        let parsedServers = [];
        if (servers && typeof servers === 'object') {
            const serverArray = Array.isArray(servers) ? servers : Object.values(servers);
            parsedServers = serverArray
                .filter(s => s && (s.videoUrl?.trim() || s.embedCode?.trim()))
                .slice(0, 13)
                .map((s, idx) => ({
                    name: s.name?.trim() || `Server ${idx + 2}`,
                    videoUrl: s.videoUrl?.trim() || '',
                    embedCode: s.embedCode?.trim() || '',
                    type: s.embedCode?.trim() ? 'iframe' : 'direct'
                }));
        }

        const finalSeasonNum = anime.type === 'movie' ? 1 : sNum;
        const finalEpNum = anime.type === 'movie' ? 1 : epNum;

        if (anime.type !== 'movie' && (oldEpisode.seasonNumber !== finalSeasonNum || oldEpisode.episodeNumber !== finalEpNum)) {
            const targetSeason = anime.seasons.find(s => s.seasonNumber === finalSeasonNum);
            if (targetSeason) {
                const duplicate = await Episode.findOne({
                    _id: { $in: targetSeason.episodes, $ne: episodeId },
                    episodeNumber: finalEpNum
                });
                if (duplicate) {
                    req.flash('error', `Episode ${finalEpNum} already exists in Season ${finalSeasonNum}.`);
                    return res.redirect(`${adminBase}/edit-episode/${episodeId}`);
                }
            }
        }

        await Episode.findByIdAndUpdate(episodeId, {
            title: title.trim(),
            mainServerName: mainServerName?.trim() || 'Server 1',
            videoUrl: videoUrl?.trim() || '',
            imageUrl: imageUrl?.trim() || '',
            embedCode: embedCode?.trim() || '',
            episodeNumber: finalEpNum,
            seasonNumber: finalSeasonNum,
            servers: parsedServers
        });

        if (oldEpisode.seasonNumber !== finalSeasonNum) {
            anime.seasons.forEach(season => {
                season.episodes = season.episodes.filter(ep => ep.toString() !== episodeId);
            });
            anime.seasons = anime.seasons.filter(s => s.episodes.length > 0);

            let newSeason = anime.seasons.find(s => s.seasonNumber === finalSeasonNum);
            if (!newSeason) {
                anime.seasons.push({ seasonNumber: finalSeasonNum, episodes: [episodeId] });
            } else {
                if (!newSeason.episodes.includes(episodeId)) {
                    newSeason.episodes.push(episodeId);
                }
            }
            anime.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
            await anime.save();
        }

        req.flash('success', `${anime.type === 'movie' ? 'Movie' : 'Episode'} updated.`);
        res.redirect(`${adminBase}/dashboard`);
    } catch (error) {
        console.error('Edit episode error:', error);
        req.flash('error', 'Update failed.');
        res.redirect(`${adminBase}/edit-episode/${episodeId}`);
    }
});

router.post('/delete-episode/:episodeId', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const { episodeId } = req.params;

        if (!isValidId(episodeId)) {
            req.flash('error', 'Invalid ID format.');
            return res.redirect(`${adminBase}/dashboard`);
        }

        const episode = await Episode.findById(episodeId);
        if (!episode) {
            req.flash('error', 'Episode not found.');
            return res.redirect(`${adminBase}/dashboard`);
        }

        const anime = await Anime.findOne({ 'seasons.episodes': episodeId });
        if (anime) {
            anime.seasons.forEach(season => {
                season.episodes = season.episodes.filter(ep => ep.toString() !== episodeId);
            });
            anime.seasons = anime.seasons.filter(s => s.episodes.length > 0);
            await anime.save();
        }

        await Episode.findByIdAndDelete(episodeId);
        req.flash('success', 'Episode deleted successfully.');
        res.redirect(`${adminBase}/dashboard`);
    } catch (err) {
        console.error('Delete episode error:', err);
        req.flash('error', 'Operation failure: ' + err.message);
        res.redirect(`${adminBase}/dashboard`);
    }
});

router.post('/delete-season/:animeId/:seasonId', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const { animeId, seasonId } = req.params;

        if (!isValidId(animeId) || !isValidId(seasonId)) {
            req.flash('error', 'Invalid ID format.');
            return res.redirect(`${adminBase}/dashboard`);
        }

        const anime = await Anime.findById(animeId);
        if (!anime) {
            req.flash('error', 'Anime not found.');
            return res.redirect(`${adminBase}/dashboard`);
        }

        const season = anime.seasons.id(seasonId);
        if (!season) {
            req.flash('error', 'Season not found.');
            return res.redirect(`${adminBase}/dashboard`);
        }

        const seasonNumber = season.seasonNumber;
        const episodeCount = season.episodes.length;

        if (season.episodes && season.episodes.length > 0) {
            await Episode.deleteMany({ _id: { $in: season.episodes } });
        }

        anime.seasons = anime.seasons.filter(s => s._id.toString() !== seasonId);
        await anime.save();

        req.flash('success', `Season ${seasonNumber} and ${episodeCount} episodes deleted successfully.`);
        res.redirect(`${adminBase}/dashboard`);

    } catch (err) {
        console.error('Delete season error:', err);
        req.flash('error', 'Failed to delete season: ' + err.message);
        res.redirect(`${adminBase}/dashboard`);
    }
});

// ==========================================
// 6. GENRE MANAGEMENT (CATEGORIES)
// ==========================================

router.get('/manage-categories', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const genres = await Genre.aggregate([
            {
                $addFields: {
                    isLatest: {
                        $cond: {
                            if: { $regexMatch: { input: "$name", regex: /latest/i } },
                            then: 0,
                            else: 1
                        }
                    }
                }
            },
            {
                $sort: {
                    isLatest: 1,
                    sequence: 1,
                    name: 1
                }
            }
        ]);
        res.render('admin-manage-categories', { genres });
    } catch (err) {
        res.redirect(`${adminBase}/dashboard`);
    }
});

router.post('/add-genre', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const name = req.body.name?.trim();
        if (!name) {
            req.flash('error', 'Category name required.');
            return res.redirect(`${adminBase}/manage-categories`);
        }
        if (await Genre.findOne({ name })) {
            req.flash('error', 'Category already exists.');
            return res.redirect(`${adminBase}/manage-categories`);
        }
        await Genre.create({ name, sequence: 9999 });
        req.flash('success', 'New Category Blueprint added.');
    } catch (err) {
        req.flash('error', 'Failed to add category.');
    }
    res.redirect(`${adminBase}/manage-categories`);
});

router.post('/edit-genre/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid category ID.');
            return res.redirect(`${adminBase}/manage-categories`);
        }
        await Genre.findByIdAndUpdate(req.params.id, { name: req.body.name.trim() });
        req.flash('success', 'Category recalibrated.');
    } catch (err) {
        req.flash('error', 'Recalibration failed.');
    }
    res.redirect(`${adminBase}/manage-categories`);
});

router.post('/delete-genre/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid category ID.');
            return res.redirect(`${adminBase}/manage-categories`);
        }
        const id = req.params.id;
        await Genre.findByIdAndDelete(id);
        await Anime.updateMany({ genres: id }, { $pull: { genres: id } });
        req.flash('success', 'Category Updated from all linked titles.');
    } catch (err) {
        req.flash('error', 'Purge failed.');
    }
    res.redirect(`${adminBase}/manage-categories`);
});

router.post('/update-genre-sequence/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid category ID.');
            return res.redirect(`${adminBase}/manage-categories`);
        }
        const sequence = req.body.sequence ? parseInt(req.body.sequence) : 9999;

        if (sequence < 1 || sequence > 999) {
            req.flash('error', 'Sequence must be between 1-999.');
            return res.redirect(`${adminBase}/manage-categories`);
        }

        await Genre.findByIdAndUpdate(req.params.id, { sequence });
        req.flash('success', 'Category sequence updated.');
    } catch (err) {
        req.flash('error', 'Sequence update failed.');
    }
    res.redirect(`${adminBase}/manage-categories`);
});

// ==========================================
// 7. TERMINATE SESSION (LOGOUT)
// ==========================================

router.post('/logout', (req, res) => {
    const sessionId = req.session?.id;

    req.session.destroy((err) => {
        if (err) {
            console.error("Admin Session Deconstruction Error:", err);
        }
        clearSessionCache(sessionId);
        // FIXED: Clears custom cookie name 'anifusion.sid' instead of 'connect.sid'
        res.clearCookie('anifusion.sid', { path: '/' });
        res.redirect(`${adminBase}/login`);
    });
});

module.exports = router;