const mongoose = require('mongoose');

function makeSlug(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const animeSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 200,
    index: true 
  },
  slug: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
    index: true
  },
  imageUrl: { type: String, maxlength: 500 },
  languageFormat: { type: String, trim: true, default: '', maxlength: 50 },
  // External API IDs (Season 1 / Main Series)
  anilistId: { type: Number, unique: true, sparse: true, index: true },
  tmdbId: { type: Number, sparse: true, index: true },
  description: { type: String, maxlength: 5000 },
  specialInfo: { type: String, default: '', maxlength: 500 },
  genres: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Genre',
    index: true 
  }],
  seasons: [{
    seasonNumber: { type: Number, required: true, min: 1 },
    anilistId: { type: Number, sparse: true }, // Per-season AniList ID for VidSync & AniEmbed
    episodes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Episode' }]
  }],
  type: {
    type: String,
    enum: ['series', 'movie'],
    default: 'series',
    index: true 
  },
  ratingScore: { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 },
  totalRatingSum: { type: Number, default: 0 },
  votedUsers: [{ type: String }]

}, { timestamps: true });

// Auto-generate slug from name on create/rename
animeSchema.pre('save', function (next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = makeSlug(this.name);
  }
  next();
});

// Existing indexes
animeSchema.index({ name: 'text', description: 'text' });
animeSchema.index({ type: 1, updatedAt: -1 });

// Compound & sync indexes
animeSchema.index({ genres: 1, updatedAt: -1 });
animeSchema.index({ name: 1, type: 1 });
animeSchema.index({ 'seasons.anilistId': 1 }, { sparse: true });

module.exports = mongoose.model('Anime', animeSchema);