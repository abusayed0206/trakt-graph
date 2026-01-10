/**
 * Trakt Data Fetcher
 * Handles fetching watch history and profile data from Trakt API
 */

import fetch from 'node-fetch';

const TRAKT_API_KEY = process.env.TRAKT_API_KEY;
const TRAKT_API_BASE = 'https://api.trakt.tv';

/**
 * Make authenticated request to Trakt API
 */
async function traktFetch(endpoint, options = {}) {
  const response = await fetch(`${TRAKT_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': TRAKT_API_KEY,
      'User-Agent': 'TraktContributionGraph/1.0',
      ...options.headers
    }
  });
  
  if (!response.ok) {
    throw new Error(`Trakt API error: ${response.statusText} (${response.status})`);
  }
  
  return {
    data: await response.json(),
    headers: response.headers
  };
}

/**
 * Fetch user profile data from Trakt API
 * @param {string} username - Trakt username
 * @returns {Object} Profile data with displayName and profileImage
 */
export async function fetchProfileData(username) {
  try {
    const { data } = await traktFetch(`/users/${username}?extended=full`);
    return {
      displayName: data.name || username,
      profileImage: data.images?.avatar?.full || null,
      username: data.username
    };
  } catch (error) {
    return { displayName: username, profileImage: null, username };
  }
}

/**
 * Fetch user stats (All Time) from Trakt API
 * @param {string} username - Trakt username
 * @returns {Object} Stats data (movies, episodes, etc.)
 */
export async function fetchUserStats(username) {
  try {
    const { data } = await traktFetch(`/users/${username}/stats`);
    return {
      moviesAllTime: data.movies?.watched || 0,
      episodesAllTime: data.episodes?.watched || 0,
      followers: data.network?.followers || 0
    };
  } catch (error) {
    console.warn(`Error fetching stats for ${username}: ${error.message}. Using fallback zeros.`);
    return { moviesAllTime: 0, episodesAllTime: 0, followers: 0 };
  }
}

/**
 * Fetch user's watch history from Trakt API with pagination
 * @param {string} username - Trakt username
 * @param {string} type - Type of history: 'movies', 'shows', or 'all'
 * @param {number|null} targetYear - Filter to specific year (null for all)
 * @returns {Array} Array of history items
 */
export async function fetchTraktHistory(username, type = 'all', targetYear = null) {
  const allHistory = [];
  let page = 1;
  const perPage = 100;
  
  // Determine endpoint based on type
  const endpoint = type === 'movies' 
    ? `/users/${username}/history/movies`
    : type === 'shows' 
      ? `/users/${username}/history/shows` 
      : `/users/${username}/history`;

  console.log(`📡 Fetching Trakt ${type} history for ${username}...`);

  try {
    while (true) {
      const { data, headers } = await traktFetch(`${endpoint}?page=${page}&limit=${perPage}`);
      
      console.log(`   Page ${page}: ${data.length} items`);

      // If targeting a specific year and all items are before that year, stop
      if (targetYear && data.every(item => new Date(item.watched_at).getFullYear() < targetYear)) {
        break;
      }

      allHistory.push(...data);
      
      const pageCount = parseInt(headers.get('x-pagination-page-count'), 10);
      if (page >= pageCount || data.length === 0) break;

      page++;
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.error(`❌ Error fetching Trakt history: ${error.message}`);
  }

  console.log(`   ✓ Total items fetched: ${allHistory.length}`);
  return allHistory;
}

/**
 * Fetch watch history for specific years
 * @param {string} username - Trakt username
 * @param {Array<number>} years - Array of years to fetch
 * @param {string} type - Type of history: 'movies', 'shows', or 'all'
 * @returns {Array} Combined array of all entries
 */
export async function fetchSpecificYears(username, years, type = 'all') {
  const allHistory = await fetchTraktHistory(username, type, Math.min(...years));
  return allHistory;
}

/**
 * Process raw Trakt history into structured entries
 * @param {Array} history - Raw Trakt history items
 * @param {number|null} targetYear - Year to filter to (null for auto-detect)
 * @returns {Object} Processed entries and metadata
 */
export function processTraktHistory(history, targetYear = null) {
  // Count items per year
  const yearCount = new Map();
  history.forEach(entry => {
    const entryYear = new Date(entry.watched_at).getFullYear();
    yearCount.set(entryYear, (yearCount.get(entryYear) || 0) + 1);
  });

  // Select year (target or most active)
  const selectedYear = targetYear || Array.from(yearCount.keys()).reduce((a, b) => 
    yearCount.get(a) > yearCount.get(b) ? a : b, new Date().getFullYear()
  );

  console.log(`📅 Processing year: ${selectedYear}`);
  console.log(`   Year counts:`, Object.fromEntries(yearCount));

  const entries = [];
  let totalItemsWatched = 0;
  let moviesCount = 0;
  let episodesCount = 0;

  history.forEach(entry => {
    // Parse the date and use local methods to get year/date to match user's perspective
    const date = new Date(entry.watched_at);
    const entryYear = date.getFullYear(); // Local year
    if (entryYear !== selectedYear) return;

    let entryDetails = null;

    if (entry.type === 'episode') {
      const { episode, show } = entry;
      const episodeCode = `S${String(episode.season).padStart(2, '0')}E${String(episode.number).padStart(2, '0')}`;
      entryDetails = {
        date: date, // Keep the Date object (local)
        title: show.title,
        episodeTitle: episode.title,
        episode: episodeCode,
        year: show.year,
        type: 'episode',
        rating: episode.rating || null
      };
      episodesCount++;
    } else if (entry.type === 'movie') {
      const { movie } = entry;
      entryDetails = {
        date: date, // Keep the Date object (local)
        title: movie.title,
        year: movie.year,
        type: 'movie',
        rating: movie.rating || null
      };
      moviesCount++;
    }

    if (entryDetails) {
      entries.push(entryDetails);
      totalItemsWatched++;
    }
  });

  console.log(`   ✓ Processed: ${moviesCount} movies, ${episodesCount} episodes`);

  return {
    entries,
    year: selectedYear,
    totalItemsWatched,
    moviesCount,
    episodesCount
  };
}

/**
 * Convert image URL to Base64 data URI
 * @param {string} url - Image URL
 * @returns {string|null} Base64 data URI or null on error
 */
export async function imageToBase64(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = response.headers.get('content-type') || 'image/png';
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.warn(`Error converting ${url} to Base64: ${error.message}`);
    return null;
  }
}
