require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const fetch = require('node-fetch');

const TRAKT_API_KEY = process.env.TRAKT_API_KEY;
const OUTPUT_DIR = 'images';

// Fetch user profile data from Trakt API
async function fetchProfileData(username) {
  const url = `https://api.trakt.tv/users/${username}?extended=full`;
  try {
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': TRAKT_API_KEY,
      },
    });
    return {
      displayName: response.data.name || username,
      profileImage: response.data.images?.avatar?.full || null,
    };
  } catch (error) {
    console.warn(`Error fetching profile data for ${username}: ${error.message}. Using fallback values.`);
    return { displayName: username, profileImage: null };
  }
}

// Convert an image URL to Base64 format
async function imageToBase64(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    const buffer = await response.buffer();
    const mimeType = response.headers.get('content-type') || 'image/svg+xml';
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.warn(`Error converting ${url} to Base64: ${error.message}`);
    return null;
  }
}

// Fetch user's watch history from Trakt API with pagination
async function fetchTraktHistory(username, type = 'all', targetYear = null) {
  const allHistory = [];
  let page = 1;
  const perPage = 100;
  const endpoint = type === 'movies' ? '/history/movies' : type === 'shows' ? '/history/shows' : '/history';

  try {
    while (true) {
      const response = await axios.get(`https://api.trakt.tv/users/${username}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': TRAKT_API_KEY,
        },
        params: { page, limit: perPage },
      });

      const pageItems = response.data;
      console.log(`Fetched page ${page}: ${response.data.length} items`);

      if (targetYear && pageItems.every(item => new Date(item.watched_at).getFullYear() < targetYear)) {
        break;
      }

      allHistory.push(...pageItems);
      const pageCount = parseInt(response.headers['x-pagination-page-count'], 10);
      if (page >= pageCount || pageItems.length === 0) break;

      page++;
      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting delay
    }
  } catch (error) {
    console.error('Error fetching Trakt history:', error.response ? error.response.data : error.message);
  }
  return allHistory;
}

// Calculate color intensity based on watch frequency percentiles
function calculateColorIntensity(dayCount, stats) {
  if (dayCount === 0) return 0;
  const { p25, p50, p75, p90 } = stats;
  if (dayCount <= p25) return 1;
  if (dayCount <= p50) return 2;
  if (dayCount <= p75) return 3;
  if (dayCount <= p90) return 4;
  return 4;
}

// Compute statistical percentiles for daily watch counts
function calculateDayCountStats(itemsPerDay) {
  const dayCounts = Array.from(itemsPerDay.values()).map(items => items.length);
  const sortedCounts = dayCounts.sort((a, b) => a - b);
  return {
    p25: sortedCounts[Math.floor(sortedCounts.length * 0.25)] || 0,
    p50: sortedCounts[Math.floor(sortedCounts.length * 0.5)] || 0,
    p75: sortedCounts[Math.floor(sortedCounts.length * 0.75)] || 0,
    p90: sortedCounts[Math.floor(sortedCounts.length * 0.9)] || 0,
  };
}

// Process watch history into structured entries for a specific year
function processTraktHistory(history, targetYear = null) {
  const yearCount = new Map();
  history.forEach(entry => {
    const entryYear = new Date(entry.watched_at).getFullYear();
    yearCount.set(entryYear, (yearCount.get(entryYear) || 0) + 1);
  });

  const selectedYear = targetYear || Array.from(yearCount.keys()).reduce((a, b) => 
    yearCount.get(a) > yearCount.get(b) ? a : b, new Date().getFullYear()
  );

  console.log(`Processing year: ${selectedYear}`);
  console.log('Year-wise item counts:', Object.fromEntries(yearCount));

  const entries = [];
  const itemsPerDay = new Map();
  let totalItemsWatched = 0;

  history.forEach(entry => {
    const date = new Date(entry.watched_at);
    if (date.getFullYear() !== selectedYear) return;

    const dateStr = date.toISOString().split('T')[0];
    if (!itemsPerDay.has(dateStr)) itemsPerDay.set(dateStr, []);

    const dayItems = itemsPerDay.get(dateStr);
    let entryDetails = null;

    if (entry.type === 'episode') {
      const { episode, show } = entry;
      entryDetails = {
        date: new Date(date),
        title: `${show.title} - S${String(episode.season).padStart(2, '0')}E${String(episode.number).padStart(2, '0')}`,
        year: show.year,
        type: 'episode',
      };
      dayItems.push({ title: show.title, episode: `S${String(episode.season).padStart(2, '0')}E${String(episode.number).padStart(2, '0')}`, year: show.year });
    } else if (entry.type === 'movie') {
      const { movie } = entry;
      entryDetails = {
        date: new Date(date),
        title: movie.title,
        year: movie.year,
        type: 'movie',
      };
      dayItems.push({ title: movie.title, year: movie.year });
    }

    if (entryDetails) {
      entries.push(entryDetails);
      totalItemsWatched++;
    }
  });

  const dayCountStats = calculateDayCountStats(itemsPerDay);
  console.log(`Total items in ${selectedYear}: ${totalItemsWatched}`);
  console.log('Day count statistics:', dayCountStats);

  return { entries, itemsPerDay, year: selectedYear, totalItemsWatched, dayCountStats };
}

// Escape special characters for safe SVG rendering
function escapeXml(unsafe) {
  return String(unsafe || '')
    .replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c] || c));
}

// Generate SVG heatmap visualization
function generateSvg(entries, itemsPerDay, options = {}) {
  const { 
    theme = 'dark', 
    year = new Date().getFullYear(), 
    weekStart = 'sunday',
    username,
    profileImage = null,
    displayName = username,
    logoBase64 = null,
    totalItemsWatched = 0,
    dayCountStats = {},
  } = options;

  const sortedEntries = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime());
  const startDate = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  const startDay = startDate.getUTCDay();
  const dayShift = weekStart === 'monday' ? (startDay + 6) % 7 : startDay;
  if (dayShift > 0) startDate.setUTCDate(startDate.getUTCDate() - dayShift);

  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const totalWeeks = Math.ceil(totalDays / 7);
  const grid = Array(7).fill().map(() => Array(totalWeeks).fill(0));

  sortedEntries.forEach(entry => {
    const entryDate = new Date(Date.UTC(entry.date.getUTCFullYear(), entry.date.getUTCMonth(), entry.date.getUTCDate()));
    const daysSinceStart = Math.floor((entryDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const weekIndex = Math.floor(daysSinceStart / 7);
    const dayIndex = weekStart === 'monday' ? (entryDate.getUTCDay() + 6) % 7 : entryDate.getUTCDay();

    if (weekIndex >= 0 && weekIndex < totalWeeks && dayIndex >= 0 && dayIndex < 7) {
      grid[dayIndex][weekIndex]++;
    }
  });

  const themes = {
    dark: {
      bg: '#0d1117', text: '#c9d1d9', title: '#e6edf3', subtitle: '#8b949e',
      tooltipBg: '#21262d', tooltipText: '#ffffff', tooltipBorder: '#ffffff',
      colors: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
    },
    light: {
      bg: '#ffffff', text: '#24292e', title: '#000000', subtitle: '#6a737d',
      tooltipBg: '#f6f8fa', tooltipText: '#24292e', tooltipBorder: '#d1d5da',
      colors: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
    },
  };

  const currentTheme = themes[theme] || themes.dark;
  const getColor = count => currentTheme.colors[calculateColorIntensity(count, dayCountStats)];

  const CELL_SIZE = 11;
  const CELL_MARGIN = 2;
  const GRID_WIDTH = totalWeeks * (CELL_SIZE + CELL_MARGIN);
  const GRID_HEIGHT = 7 * (CELL_SIZE + CELL_MARGIN);
  const SVG_WIDTH = GRID_WIDTH + 60;
  const SVG_HEIGHT = GRID_HEIGHT + 70;

  const DAYS = weekStart === 'monday' 
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] 
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let svg = `<svg width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <style>
      text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 11px; fill: ${currentTheme.text}; }
      .title-text { font-size: 13px; font-weight: bold; fill: ${currentTheme.title}; }
      .username-text { font-size: 13px; font-weight: bold; fill: ${currentTheme.title}; }
      .subtitle-text { font-size: 11px; fill: ${currentTheme.subtitle}; }
      .tooltip { opacity: 0; pointer-events: none; }
      .tooltip text { font-size: 12px; fill: ${currentTheme.tooltipText}; }
      rect[opacity="1"]:hover + .tooltip { opacity: 1; }
    </style>
    <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="${currentTheme.bg}" rx="6" ry="6"/>
    <g transform="translate(${(SVG_WIDTH - (profileImage ? 18 + displayName.length * 8 : displayName.length * 8)) / 2}, 10)">
      ${profileImage ? `<image href="${profileImage}" x="0" y="0" width="13" height="13" preserveAspectRatio="xMidYMid slice" clip-path="circle(6.5px at 6.5px 6.5px)"/>` : ''}
      <text x="${profileImage ? 18 : 0}" y="11" class="username-text">${escapeXml(displayName)}</text>
    </g>
    <g transform="translate(10, 17)">
      ${logoBase64 ? `<image href="${logoBase64}" x="0" y="-12" width="15" height="15"/>` : ''}
      <text x="${logoBase64 ? 20 : 0}" y="0" class="title-text">Trakt ${year}</text>
    </g>
    <text x="30" y="30" class="subtitle-text">${totalItemsWatched} ${options.watchedLabel || 'items'} watched</text>
    <g transform="translate(${SVG_WIDTH - 160}, 10)">
      <text x="0" y="10">Less</text>`;

  for (let i = 0; i < 5; i++) {
    svg += `<rect x="${40 + i * 15}" y="2" width="10" height="10" rx="2" ry="2" fill="${currentTheme.colors[i]}"/>`;
  }
  svg += `<text x="${40 + 5 * 15 + 5}" y="10">More</text></g>
    <g transform="translate(30, 50)">`;

  for (let i = 0; i < 12; i++) {
    const firstDayOfMonth = new Date(Date.UTC(year, i, 1));
    const daysSinceStart = Math.floor((firstDayOfMonth.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceStart < 0) continue;
    const weekIndex = Math.floor(daysSinceStart / 7);
    svg += `<text x="${weekIndex * (CELL_SIZE + CELL_MARGIN)}" y="0">${MONTHS[i]}</text>`;
  }

  svg += `</g><g transform="translate(10, 60)">`;
  for (let i = 0; i < 7; i++) {
    svg += `<text x="0" y="${i * (CELL_SIZE + CELL_MARGIN) + CELL_SIZE / 2 + 4}">${DAYS[i][0]}</text>`;
  }

  svg += `</g><g transform="translate(30, 60)">`;
  for (let day = 0; day < 7; day++) {
    for (let week = 0; week < totalWeeks; week++) {
      const count = grid[day][week];
      const color = getColor(count);
      const cellDate = new Date(startDate);
      cellDate.setUTCDate(cellDate.getUTCDate() + week * 7 + day);
      const tooltipDate = cellDate.toISOString().split('T')[0];
      const x = week * (CELL_SIZE + CELL_MARGIN);
      const y = day * (CELL_SIZE + CELL_MARGIN);
      const isOutsideYear = cellDate < new Date(Date.UTC(year, 0, 1)) || cellDate > new Date(Date.UTC(year, 11, 31));
      const opacity = isOutsideYear ? '0' : '1';
      const itemsForDay = itemsPerDay.get(tooltipDate) || [];
      let tooltipLines = [`${tooltipDate}: ${count} item${count !== 1 ? 's' : ''} watched`];

      if (itemsForDay.length > 0) {
        const seriesCount = new Map();
        const movies = [];
        itemsForDay.forEach(item => {
          if (item.episode) seriesCount.set(item.title, (seriesCount.get(item.title) || 0) + 1);
          else movies.push(item);
        });
        seriesCount.forEach((count, title) => {
          const year = itemsForDay.find(item => item.title === title).year;
          tooltipLines.push(`• ${count}x ${title} (${year})`);
        });
        movies.forEach(movie => tooltipLines.push(`• ${movie.title} (${movie.year})`));
      }

      const lineHeight = 18;
      const padding = 10;
      const tooltipHeight = tooltipLines.length * lineHeight + padding * 2;
      const maxLineLength = Math.max(...tooltipLines.map(line => line.length));
      const tooltipWidth = Math.min(Math.max(maxLineLength * 7, 150), 300);

      svg += `
        <rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" rx="2" ry="2" fill="${color}" opacity="${opacity}" data-date="${tooltipDate}" data-count="${count}"/>
        <g class="tooltip" transform="translate(${x - tooltipWidth / 2 + CELL_SIZE / 2}, ${y - tooltipHeight - 10})">
          <rect x="0" y="0" width="${tooltipWidth}" height="${tooltipHeight}" rx="4" fill="${currentTheme.tooltipBg}" stroke="${currentTheme.tooltipBorder}" stroke-width="0.5" opacity="0.95"/>
          <text x="${padding}" y="${padding + 12}">` +
          tooltipLines.map((line, i) => `<tspan x="${padding}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join('') +
          `</text></g>`;
    }
  }

  svg += `</g></svg>`;
  return svg;
}

// Main execution function with command-line argument parsing
async function main() {
  const args = process.argv.slice(2);
  let type = 'all';
  let targetYear = new Date().getFullYear();
  let weekStart = 'sunday';
  let username = null;

  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('-')) continue;
    const flag = args[i].slice(1).toLowerCase();
    const nextArg = args[i + 1];
    switch (flag) {
      case 'm': type = 'movies'; break;
      case 's': type = 'shows'; break;
      case 'y': 
        const year = parseInt(nextArg, 10);
        if (!isNaN(year)) { targetYear = year; i++; }
        break;
      case 'w':
        if (['monday', 'sunday'].includes(nextArg?.toLowerCase())) { weekStart = nextArg.toLowerCase(); i++; }
        break;
      case 'u':
        if (nextArg) { username = nextArg; i++; }
        break;
      case 'a':
        type = 'all'; // We'll handle this below
        break;
      default: console.warn(`Unknown flag "-${flag}", ignoring`);
    }
  }

  if (!username) throw new Error('Username is required. Use -u flag to specify.');

  const renderAll = args.includes('-a') || args.includes('--all');
  const typesToRender = renderAll ? ['movies', 'shows', 'all'] : [type];

  console.log(`Configuration: Username=${username}, Types=${typesToRender.join(', ')}, Year=${targetYear}, Week Start=${weekStart}`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const { displayName, profileImage } = await fetchProfileData(username);
  const profileImageBase64 = profileImage ? await imageToBase64(profileImage) : null;
  const logoBase64 = await imageToBase64('https://trakt.tv/assets/logos/logomark.square.gradient-b644b16c38ff775861b4b1f58c1230f6a097a2466ab33ae00445a505c33fcb91.svg');

  for (const t of typesToRender) {
    const history = await fetchTraktHistory(username, t, targetYear);
    const { entries, itemsPerDay, year, totalItemsWatched, dayCountStats } = processTraktHistory(history, targetYear);

    const watchedLabel = t === 'movies' ? 'movies' : t === 'shows' ? 'episodes' : 'items';

    const svgOptions = {
      year,
      weekStart,
      username,
      profileImage: profileImageBase64,
      displayName,
      logoBase64,
      totalItemsWatched,
      dayCountStats,
      watchedLabel,
    };

    // Default filenames for "all"
    const baseName = t === 'all' ? 'github-trakt' : `github-trakt-${t}`;
    fs.writeFileSync(`${OUTPUT_DIR}/${baseName}-dark.svg`, generateSvg(entries, itemsPerDay, { ...svgOptions, theme: 'dark' }));
    fs.writeFileSync(`${OUTPUT_DIR}/${baseName}-light.svg`, generateSvg(entries, itemsPerDay, { ...svgOptions, theme: 'light' }));

    console.log(`SVGs generated for ${t}: ${baseName}-dark.svg & -light.svg`);
  }
}


main().catch(err => console.error('Error:', err));