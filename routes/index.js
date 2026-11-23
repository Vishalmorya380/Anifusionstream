const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Anime = require('../models/Anime');
const Genre = require('../models/Genre');
const Episode = require('../models/Episode');
const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 1800 });
const trendingCache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache
const anilistStatusCache = new NodeCache({ stdTTL: 21600 }); // 6 hours cache

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function escapeRegex(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

/**
 * Fetches AniList status & episode count in batches of 50 (with 6h cache & 3s timeout)
 * and sets `anime.cardStatus` & `anime.status` to 'Ongoing', 'Completed', or null.
 */
async function attachCardStatuses(animes) {
    if (!Array.isArray(animes) || animes.length === 0) return animes;

    const targetMap = new Map(); // anime._id -> { alId, dbEpCount }
    const missingIds = new Set();

    for (const anime of animes) {
        if (anime.type === 'movie') {
            anime.cardStatus = null;
            anime.status = null;
            delete anime.seasons;
            continue;
        }

        const seasons = Array.isArray(anime.seasons) ? anime.seasons : [];
        let targetAlId = anime.anilistId || null;
        let dbEpCount = 0;

        if (seasons.length > 0) {
            // Find the latest season that has an anilistId
            const sortedSeasons = [...seasons].sort((a, b) => (b.seasonNumber || 0) - (a.seasonNumber || 0));
            const latestWithId = sortedSeasons.find(s => s.anilistId);

            if (latestWithId) {
                targetAlId = latestWithId.anilistId;
                // Sum episodes across all seasons sharing this AniList ID (handles Naruto/Shippuden split seasons)
                dbEpCount = seasons
                    .filter(s => s.anilistId === targetAlId)
                    .reduce((sum, s) => sum + (Array.isArray(s.episodes) ? s.episodes.length : 0), 0);
            } else {
                dbEpCount = seasons.reduce((sum, s) => sum + (Array.isArray(s.episodes) ? s.episodes.length : 0), 0);
            }
        }

        targetMap.set(anime._id.toString(), { alId: targetAlId, dbEpCount });

        if (targetAlId && anilistStatusCache.get(String(targetAlId)) === undefined) {
            missingIds.add(Number(targetAlId));
        }
    }

    // Batch fetch uncached AniList IDs (50 per request, 3s timeout)
    const idsToFetch = [...missingIds];
    for (let i = 0; i < idsToFetch.length; i += 50) {
        const chunk = idsToFetch.slice(i, i + 50);
        try {
            const query = `
                query ($ids: [Int]) {
                    Page(page: 1, perPage: 50) {
                        media(id_in: $ids, type: ANIME) {
                            id
                            status
                            episodes
                        }
                    }
                }
            `;
            const { data } = await axios.post(
                'https://graphql.anilist.co',
                { query, variables: { ids: chunk } },
                {
                    headers: { 'Content-Type': 'application/json', 'User-Agent': 'AniFusionStream/1.0' },
                    timeout: 3000
                }
            );

            const mediaList = data?.data?.Page?.media || [];
            const foundIds = new Set();

            for (const m of mediaList) {
                foundIds.add(m.id);
                anilistStatusCache.set(String(m.id), {
                    status: m.status,     // RELEASING, FINISHED, NOT_YET_RELEASED, etc.
                    episodes: m.episodes  // total episodes or null
                });
            }

            // Cache misses as null so we don't re-query invalid IDs repeatedly
            for (const id of chunk) {
                if (!foundIds.has(id)) {
                    anilistStatusCache.set(String(id), null);
                }
            }
        } catch (err) {
            console.error('AniList Batch Status Error:', err.message);
        }
    }

    const now = Date.now();

    for (const anime of animes) {
        if (anime.type === 'movie') continue;

        const info = targetMap.get(anime._id.toString());
        const alData = info?.alId ? anilistStatusCache.get(String(info.alId)) : null;

        let cardStatus = null;

        if (alData) {
            if (alData.status === 'RELEASING') {
                cardStatus = 'Ongoing';
            } else if (alData.status === 'FINISHED') {
                if (alData.episodes && info.dbEpCount < alData.episodes) {
                    // AniList par finish ho gaya, par hamari site par saare episodes abhi add nahi hue
                    cardStatus = 'Ongoing';
                } else if (info.dbEpCount > 0) {
                    // Saare episodes add ho chuke hain -> 3 din tak 'Completed' dikhao, phir gayab
                    const updatedTime = anime.updatedAt ? new Date(anime.updatedAt).getTime() : 0;
                    if (updatedTime && (now - updatedTime) <= THREE_DAYS_MS) {
                        cardStatus = 'Completed';
                    }
                }
            }
        }

        anime.cardStatus = cardStatus;
        anime.status = cardStatus;
        delete anime.seasons; // Frontend ko heavy seasons array bhejne ki zaroorat nahi
    }

    return animes;
}

/**
 * GET /
 * Root - redirect to welcome page
 */
router.get('/', (req, res) => {
    res.redirect('/welcome');
});

/**
 * GET /welcome
 * New landing page - no auth required
 */
router.get('/welcome', (req, res) => {
    res.render('welcome');
});

/**
 * GET /home
 * Homepage - now public, no login required
 */
router.get('/home', async (req, res) => {
    const searchQuery = req.query.q ? escapeRegex(req.query.q.trim()) : '';
    const selectedGenre = req.query.genre || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;

    const renderData = {
        searchQuery: req.query.q || '',
        selectedGenre,
        isSearchResult: !!(searchQuery || selectedGenre),
        currentPage: page,
        totalPages: 0,
        totalResults: 0,
        animes: [],
        genres: [],
        latestGenres: [],
        normalGenres: [],
        movieGenres: [],
        latestEpisodes: []
    };

    try {
        const genres = await Genre.aggregate([
            {
                $addFields: {
                    isLatest: { $cond: { if: { $regexMatch: { input: "$name", regex: /latest/i } }, then: 0, else: 1 } },
                    isMovie: { $cond: { if: { $regexMatch: { input: "$name", regex: /movie/i } }, then: 1, else: 0 } },
                    sortSeq: { $ifNull: ["$sequence", 9999] }
                }
            },
            { $sort: { isMovie: 1, isLatest: 1, sortSeq: 1, name: 1 } }
        ]);

        let sortedGenres = [...genres];
        if (selectedGenre) {
            const index = sortedGenres.findIndex(g => g._id.toString() === selectedGenre);
            if (index !== -1) {
                const [selected] = sortedGenres.splice(index, 1);
                sortedGenres.unshift(selected);
            }
        }
        renderData.genres = sortedGenres;

        // SEARCH OR GENRE FILTER PAGE (Paginated)
        if (renderData.isSearchResult) {
            if (searchQuery) {
                const exactMatch = await Anime.findOne({ name: new RegExp(`^${searchQuery}$`, 'i') })
                    .select('slug _id')
                    .lean();
                if (exactMatch) return res.redirect(`/anime/${exactMatch.slug || exactMatch._id}`);
            }

            const animeQuery = {};
            if (searchQuery) animeQuery.name = { $regex: searchQuery, $options: 'i' };

            if (selectedGenre && mongoose.Types.ObjectId.isValid(selectedGenre)) {
                animeQuery.genres = selectedGenre;
            }

            const [animes, totalAnimes] = await Promise.all([
                Anime.find(animeQuery)
                    .select('name slug imageUrl updatedAt type anilistId seasons.seasonNumber seasons.anilistId seasons.episodes')
                    .sort({ updatedAt: -1, _id: -1 })
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .lean(),
                Anime.countDocuments(animeQuery)
            ]);

            await attachCardStatuses(animes);

            renderData.animes = animes;
            renderData.totalResults = totalAnimes;
            renderData.totalPages = Math.ceil(totalAnimes / limit);
        }
        // STANDARD HOMEPAGE (Lazy Seeded - ONLY fetches 6 per genre initially)
        else {
            let latestGenres = genres.filter(g => /latest/i.test(g.name));
            let movieGenres = genres.filter(g => /movie/i.test(g.name) && !/latest/i.test(g.name));
            let normalGenres = genres.filter(g => !/latest/i.test(g.name) && !/movie/i.test(g.name));

            const fetchInitialAnimes = (genreId) => {
                return Anime.find({ genres: genreId })
                    .select('name slug imageUrl updatedAt type anilistId seasons.seasonNumber seasons.anilistId seasons.episodes')
                    .sort({ updatedAt: -1, _id: -1 })
                    .limit(6)
                    .lean();
            };

            const allGroups = [...latestGenres, ...normalGenres, ...movieGenres];
            await Promise.all(allGroups.map(async (g) => {
                g.initialAnimes = await fetchInitialAnimes(g._id);
            }));

            // Attach AniList-based Ongoing / Completed status in one batch pass
            const allHomepageAnimes = allGroups.flatMap(g => g.initialAnimes || []);
            await attachCardStatuses(allHomepageAnimes);

            renderData.latestGenres = latestGenres.filter(g => g.initialAnimes.length > 0);
            renderData.normalGenres = normalGenres.filter(g => g.initialAnimes.length > 0);
            renderData.movieGenres = movieGenres.filter(g => g.initialAnimes.length > 0);

            const latestEpisodesData = await Episode.find({ anime: { $exists: true, $ne: null } })
                .sort({ createdAt: -1 })
                .limit(20)
                .lean();

            const animeIds = [...new Set(latestEpisodesData.map(ep => ep.anime.toString()))];
            const animeMap = await Anime.find({ _id: { $in: animeIds } })
                .select('name slug imageUrl type')
                .lean();
            const animeLookup = Object.fromEntries(animeMap.map(a => [a._id.toString(), a]));

            renderData.latestEpisodes = latestEpisodesData
                .filter(ep => animeLookup[ep.anime.toString()])
                .map(ep => ({ ...ep, anime: animeLookup[ep.anime.toString()] }));
        }

        res.render('index', renderData);
    } catch (err) {
        console.error('Core Index Error:', err);
        req.flash('error', 'System was unable to synchronize the catalog.');
        res.render('index', renderData);
    }
});

router.get('/search', (req, res) => {
    const { q = '', genre = '' } = req.query;
    const params = new URLSearchParams();
    if (q) params.append('q', q);
    if (genre) params.append('genre', genre);
    res.redirect(`/home?${params.toString()}`);
});

// Debounced backend search for dropdown UI
router.get('/api/search-suggestions', async (req, res) => {
    try {
        const q = req.query.q ? escapeRegex(req.query.q.trim()) : '';
        if (!q || q.length < 2) return res.json([]);

        const animes = await Anime.find({ name: { $regex: q, $options: 'i' } })
            .select('name slug _id')
            .limit(6)
            .lean();

        res.json(animes);
    } catch (err) {
        console.error('Search API Error:', err);
        res.status(500).json([]);
    }
});

// Infinite Horizontal Scroll Batch Loader
router.get('/api/genre/:id/load', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 8;
        const skip = parseInt(req.query.skip) || 6;
        const genreId = req.params.id;

        if (!genreId || genreId === 'undefined' || !mongoose.Types.ObjectId.isValid(genreId)) {
            return res.json([]);
        }

        const animes = await Anime.find({ genres: genreId })
            .select('name slug imageUrl updatedAt type anilistId seasons.seasonNumber seasons.anilistId seasons.episodes')
            .sort({ updatedAt: -1, _id: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        await attachCardStatuses(animes);

        res.json(animes);
    } catch (err) {
        console.error('Lazy Load Error:', err);
        res.status(500).json([]);
    }
});

// AniList IST Schedule
router.get('/api/upcoming-schedule', async (req, res) => {
    try {
        const cached = cache.get('anilistScheduleIST');
        if (cached) return res.json(cached);

        const query = `
        query {
            Page(page: 1, perPage: 50) {
                media(status: RELEASING, type: ANIME, sort: POPULARITY_DESC) {
                    id title { romaji english } coverImage { large } nextAiringEpisode { airingAt episode }
                }
            }
        }`;

        const { data } = await axios.post('https://graphql.anilist.co', { query }, {
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'AniFusionStream/1.0' },
            timeout: 15000
        });

        if (!data || !data.data || !data.data.Page || !data.data.Page.media) throw new Error('Invalid response');

        const scheduleByDay = { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] };
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        data.data.Page.media.filter(a => a.nextAiringEpisode).forEach(anime => {
            const utcDate = new Date(anime.nextAiringEpisode.airingAt * 1000);
            const istDate = new Date(utcDate.getTime() + (5.5 * 60 * 60 * 1000));
            const dayName = dayNames[istDate.getUTCDay()];
            const hours = istDate.getUTCHours();
            const minutes = istDate.getUTCMinutes();
            const period = hours >= 12 ? 'pm' : 'am';
            const displayHours = hours % 12 || 12;
            const timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;

            scheduleByDay[dayName].push({
                id: anime.id, title: anime.title.english || anime.title.romaji,
                image: anime.coverImage.large, episode: anime.nextAiringEpisode.episode,
                time: timeStr, timestamp: istDate.getTime()
            });
        });

        Object.keys(scheduleByDay).forEach(day => scheduleByDay[day].sort((a, b) => a.timestamp - b.timestamp));
        cache.set('anilistScheduleIST', scheduleByDay);
        res.json(scheduleByDay);
    } catch (err) {
        console.error('AniList API error:', err.message);
        cache.del('anilistScheduleIST');
        res.json({ Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] });
    }
});

// GET Trending Anime from AniList
router.get('/api/trending-picks', async (req, res) => {
    try {
        const cached = trendingCache.get('trendingPicks');
        if (cached) return res.json(cached);

        const query = `
        query {
            series: Page(page: 1, perPage: 5) {
                media(type: ANIME, format: TV, sort: TRENDING_DESC) {
                    id
                    title { romaji english }
                    coverImage { large }
                    averageScore
                    duration
                    seasonYear
                    episodes
                    status
                }
            }
            movies: Page(page: 1, perPage: 5) {
                media(type: ANIME, format: MOVIE, sort: TRENDING_DESC) {
                    id
                    title { romaji english }
                    coverImage { large }
                    averageScore
                    duration
                    seasonYear
                    episodes
                    status
                }
            }
        }`;

        const { data } = await axios.post('https://graphql.anilist.co',
            { query },
            {
                headers: { 'Content-Type': 'application/json', 'User-Agent': 'AniFusionStream/1.0' },
                timeout: 15000
            }
        );

        const formatMedia = (media) => ({
            id: media.id,
            title: media.title.english || media.title.romaji,
            rating: media.averageScore ? (media.averageScore / 10).toFixed(1) : 'N/A',
            duration: media.duration ? `${media.duration} min.` : (media.episodes ? `${media.episodes} eps` : 'N/A'),
            year: media.seasonYear || 'TBA',
            img: media.coverImage.large,
            status: media.status ? media.status.replace(/_/g, ' ') : 'UNKNOWN'
        });

        const result = {
            series: data.data.series.media.map(formatMedia),
            movies: data.data.movies.media.map(formatMedia)
        };

        trendingCache.set('trendingPicks', result);
        res.json(result);
    } catch (err) {
        console.error('Trending API error:', err.message);
        trendingCache.del('trendingPicks');
        res.json({ series: [], movies: [] });
    }
});

module.exports = router;