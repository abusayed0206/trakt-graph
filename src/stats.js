/**
 * Statistics calculations for Trakt watch history entries
 */

/**
 * Helper to get local YYYY-MM-DD date string
 */
function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculate the longest streak of consecutive days with items watched
 * @param {Array} entries - Array of diary entries with date property
 * @returns {Object} Streak info: { length, startDate, endDate }
 */
export function calculateStreak(entries) {
  if (!entries || entries.length === 0) {
    return { length: 0, startDate: null, endDate: null };
  }

  // Get unique dates, sorted
  const uniqueDates = [...new Set(
    entries.map(e => getLocalDateString(e.date))
  )].sort();

  if (uniqueDates.length === 0) {
    return { length: 0, startDate: null, endDate: null };
  }

  let maxStreak = 1;
  let currentStreak = 1;
  let maxStart = uniqueDates[0];
  let maxEnd = uniqueDates[0];
  let currentStart = uniqueDates[0];

  for (let i = 1; i < uniqueDates.length; i++) {
    const prevDate = new Date(uniqueDates[i - 1]);
    const currDate = new Date(uniqueDates[i]);
    
    // Calculate difference in days
    const diffTime = currDate.getTime() - prevDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      // Consecutive day
      currentStreak++;
      if (currentStreak > maxStreak) {
        maxStreak = currentStreak;
        maxStart = currentStart;
        maxEnd = uniqueDates[i];
      }
    } else {
      // Streak broken
      currentStreak = 1;
      currentStart = uniqueDates[i];
    }
  }

  return {
    length: maxStreak,
    startDate: maxStart,
    endDate: maxEnd
  };
}

/**
 * Calculate total number of unique active days
 * @param {Array} entries - Array of diary entries
 * @returns {number} Number of unique days with activity
 */
export function calculateDaysActive(entries) {
  if (!entries || entries.length === 0) return 0;
  
  const uniqueDates = new Set(
    entries.map(e => getLocalDateString(e.date))
  );
  
  return uniqueDates.size;
}

/**
 * Group entries by date string
 * @param {Array} entries - Array of diary entries
 * @returns {Map} Map of date string -> array of entries
 */
export function groupEntriesByDate(entries) {
  const grouped = new Map();
  
  for (const entry of entries) {
    const dateKey = getLocalDateString(entry.date);
    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, []);
    }
    grouped.get(dateKey).push({
      title: entry.title,
      year: entry.year,
      rating: entry.rating,
      type: entry.type,
      episode: entry.episode
    });
  }
  
  return grouped;
}

/**
 * Calculate average rating across all entries
 * @param {Array} entries - Array of diary entries
 * @returns {number|null} Average rating or null if no ratings
 */
export function calculateAverageRating(entries) {
  const rated = entries.filter(e => e.rating !== null && e.rating !== undefined);
  if (rated.length === 0) return null;
  
  const sum = rated.reduce((acc, e) => acc + e.rating, 0);
  return Math.round((sum / rated.length) * 10) / 10;
}
