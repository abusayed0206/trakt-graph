/**
 * SVG Graph Generator for Trakt Activity
 * Adapted from letterboxd-graph with Trakt-specific branding
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import opentype from 'opentype.js';
import { calculateStreak, calculateDaysActive, groupEntriesByDate } from './stats.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FONTS_DIR = path.join(__dirname, '..', 'fonts');

/**
 * Load Inter font files as Base64 for embedding in SVG
 */
function loadFontsBase64() {
  const fonts = {};
  const fontFiles = {
    regular: 'Inter-Regular.woff2',
    medium: 'Inter-Medium.woff2',
    semibold: 'Inter-SemiBold.woff2',
    bold: 'Inter-Bold.woff2'
  };

  for (const [weight, filename] of Object.entries(fontFiles)) {
    const fontPath = path.join(FONTS_DIR, filename);
    if (fs.existsSync(fontPath)) {
      const fontData = fs.readFileSync(fontPath);
      fonts[weight] = `data:font/woff2;base64,${fontData.toString('base64')}`;
    }
  }
  return fonts;
}

// Load fonts once at module initialization
let embeddedFonts = null;
function getEmbeddedFonts() {
  if (!embeddedFonts) {
    embeddedFonts = loadFontsBase64();
  }
  return embeddedFonts;
}

/**
 * Generate @font-face CSS declarations for embedded fonts
 */
function generateFontFaceCSS() {
  const fonts = getEmbeddedFonts();
  if (Object.keys(fonts).length === 0) {
    return ''; // Fallback to system fonts if no embedded fonts available
  }

  return `
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 400;
        src: url('${fonts.regular}') format('woff2');
      }
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 500;
        src: url('${fonts.medium}') format('woff2');
      }
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 600;
        src: url('${fonts.semibold}') format('woff2');
      }
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 700;
        src: url('${fonts.bold}') format('woff2');
      }
  `;
}

/**
 * Escape XML special characters
 */
function escapeXml(unsafe) {
  if (unsafe === undefined || unsafe === null) return "";
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
    }
  });
}

// Load font once at module initialization
let loadedFont = null;
function getFont() {
  if (!loadedFont) {
    const fontPath = path.join(FONTS_DIR, 'Inter-SemiBold.ttf');
    if (fs.existsSync(fontPath)) {
      try {
        const fontBuffer = fs.readFileSync(fontPath);
        loadedFont = opentype.parse(fontBuffer.buffer);
      } catch (e) {
        console.warn('Could not load font for text measurement, using fallback');
        loadedFont = null;
      }
    }
  }
  return loadedFont;
}

/**
 * Calculate exact text width using opentype.js with kerning support
 */
function calculateTextWidth(text, fontSize, letterSpacing = 0) {
  if (!text) return 0;
  
  const font = getFont();
  if (font) {
    let width = font.getAdvanceWidth(text, fontSize, { kerning: true });
    if (letterSpacing > 0 && text.length > 1) {
      width += letterSpacing * (text.length - 1);
    }
    return width;
  }
  
  // Fallback to rough estimation
  return text.length * fontSize * 0.55;
}

/**
 * Generate the SVG contribution graph
 */
export function generateSvg(entries, options = {}) {
  const { 
    theme = 'dark', 
    year = new Date().getFullYear(),
    weekStart = 'sunday',
    profileImage = null,
    displayName = '',
    username = '',
    usernameGradient = true,
    logoBase64 = null,
    contentType = 'all', // 'movies', 'shows', or 'all'
    moviesCount = 0,
    episodesCount = 0,
    followers = 0
  } = options;

  // Filter entries for the requested year
  const sortedEntries = [...entries].filter(entry => {
    return entry.date.getFullYear() === year;
  }).sort((a, b) => a.date.getTime() - b.date.getTime());

  // Calculate stats
  const streak = calculateStreak(sortedEntries);
  const daysActive = calculateDaysActive(sortedEntries);
  const totalItems = sortedEntries.length;
  const itemsPerDay = groupEntriesByDate(sortedEntries);
  
  // item label based on content type
  const itemLabel = contentType === 'movies' ? 'Movies' 
    : contentType === 'shows' ? 'Episodes' 
    : 'Items';
  
  // Calculate weekly distribution
  const weeklyDistribution = [0, 0, 0, 0, 0, 0, 0];
  sortedEntries.forEach(entry => {
    const dayOfWeek = entry.date.getDay();
    weeklyDistribution[dayOfWeek]++;
  });
  const maxWeeklyCount = Math.max(...weeklyDistribution);

  // Calculate rating distribution (Trakt uses 1-10 scale)
  const ratingDistribution = {};
  const ratingLabels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  ratingLabels.forEach(r => ratingDistribution[r] = 0);
  ratingDistribution['unrated'] = 0;
  
  sortedEntries.forEach(entry => {
    if (entry.rating && entry.rating > 0) {
      const ratingKey = String(Math.round(entry.rating));
      if (ratingDistribution.hasOwnProperty(ratingKey)) {
        ratingDistribution[ratingKey]++;
      }
    } else {
      ratingDistribution['unrated']++;
    }
  });
  const maxRatingCount = Math.max(...ratingLabels.map(r => ratingDistribution[r]));

  // Setup date range
  const displayYear = year;
  const startDate = new Date(Date.UTC(displayYear, 0, 1));
  const endDate = new Date(Date.UTC(displayYear, 11, 31));
  
  const startDay = startDate.getUTCDay();
  const dayShift = weekStart === 'monday' ? (startDay + 6) % 7 : startDay;
  if (dayShift > 0) {
    startDate.setUTCDate(startDate.getUTCDate() - dayShift);
  }

  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const totalWeeks = Math.ceil(totalDays / 7);

  // Build activity grid
  const grid = Array(7).fill(0).map(() => Array(totalWeeks).fill(0));
  let maxCount = 0;

  sortedEntries.forEach((entry) => {
    const daysSinceStart = Math.floor((entry.date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const weekIndex = Math.floor(daysSinceStart / 7);
    const dayIndex = weekStart === 'monday' ? (entry.date.getUTCDay() + 6) % 7 : entry.date.getUTCDay();

    if (weekIndex >= 0 && weekIndex < totalWeeks) {
      grid[dayIndex][weekIndex]++;
      maxCount = Math.max(maxCount, grid[dayIndex][weekIndex]);
    }
  });

  // Dimensions
  const CELL_SIZE = 14;
  const CELL_GAP = 3;
  const GRID_WIDTH = totalWeeks * (CELL_SIZE + CELL_GAP);
  const GRID_HEIGHT = 7 * (CELL_SIZE + CELL_GAP);
  const SVG_WIDTH = Math.max(1000, GRID_WIDTH + 100);
  const SVG_HEIGHT = 290;
  const GRID_OFFSET_X = 51;
  const GRID_OFFSET_Y = 165;

  // Day/Month labels
  const DAYS_SUNDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DAYS_MONDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAYS = weekStart === 'monday' ? DAYS_MONDAY : DAYS_SUNDAY;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Theme colors - Trakt style (red accent)
  const themes = {
    dark: {
      bg: '#0d1117',
      cardBorder: '#21262d',
      text: '#e6edf3',
      textMuted: '#7d8590',
      tooltipBg: '#161b22',
      tooltipBorder: '#30363d',
      tooltipText: '#f0f6fc',
      colors: ['#161b22', '#5c1015', '#8b1a22', '#c41e2a', '#ed1c24']
    },
    light: {
      bg: '#ffffff',
      cardBorder: '#d1d9e0',
      text: '#1f2328',
      textMuted: '#656d76',
      tooltipBg: '#ffffff',
      tooltipBorder: '#d1d9e0',
      tooltipText: '#1f2328',
      colors: ['#ebedf0', '#ffc9cc', '#ff8a8f', '#ed4c55', '#ed1c24']
    }
  };

  const t = themes[theme] || themes.dark;

  function getColor(count) {
    if (count === 0) return t.colors[0];
    
    // Count mode
    if (maxCount === 0) return t.colors[0];
    const level = Math.ceil((count / maxCount) * 4);
    return t.colors[Math.min(level, 4)];
  }

  // Start building SVG
  let svg = `<svg width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.1"/>
    </filter>
    <clipPath id="profileClip">
      <circle cx="40" cy="40" r="40"/>
    </clipPath>
    <linearGradient id="usernameGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ED1C24"/>
      <stop offset="100%" stop-color="#FF6B6B"/>
    </linearGradient>
    <style type="text/css">
      <![CDATA[
      ${generateFontFaceCSS()}
      .tooltip-group {
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
      }
      .cell-group:hover .tooltip-group {
        opacity: 1;
      }
      .cell-group:hover .cell {
        filter: brightness(1.3);
      }
      .cell {
        transition: filter 0.2s ease;
      }
      .streak-tooltip {
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
      }
      .streak-group:hover .streak-tooltip {
        opacity: 1;
      }
      .streak-group:hover {
        cursor: pointer;
      }
      .streak-cell {
        transition: filter 0.2s ease, stroke 0.2s ease, stroke-width 0.2s ease;
      }
      svg:has(.streak-group:hover) .streak-cell {
        filter: brightness(1.4) saturate(1.2);
        stroke: #ed1c24;
        stroke-width: 2;
      }
      .days-active-tooltip {
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
      }
      .days-active-group:hover .days-active-tooltip {
        opacity: 1;
      }
      .days-active-group:hover {
        cursor: pointer;
      }
      .items-tooltip {
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
      }
      .items-group:hover .items-tooltip {
        opacity: 1;
      }
      .items-group:hover {
        cursor: pointer;
      }
      ]]>
    </style>
  </defs>
  
  <!-- Main Card -->
  <rect width="100%" height="100%" rx="12" fill="${t.bg}" stroke="${t.cardBorder}" stroke-width="1" filter="url(#shadow)"/>

  <!-- Header Section -->
  <g transform="translate(25, 20)">
    <!-- Profile Image (clickable) -->
    <a href="https://trakt.tv/users/${username}" target="_blank">
      <circle cx="40" cy="40" r="42" fill="${t.cardBorder}"/>
      ${profileImage ? `<image href="${profileImage}" x="0" y="0" width="80" height="80" clip-path="url(#profileClip)" style="cursor: pointer;"/>` : `<circle cx="40" cy="40" r="40" fill="${t.colors[2]}"/>`}
    </a>

    <!-- Name and Info (clickable) -->
    <a href="https://trakt.tv/users/${username}" target="_blank">
      <text x="100" y="35" font-family="'Segoe UI', Inter, Arial, sans-serif" font-size="28" font-weight="600" fill="${usernameGradient ? 'url(#usernameGradient)' : t.text}" style="cursor: pointer;">${escapeXml(displayName)}</text>
    </a>

    <text x="100" y="60" font-family="'Segoe UI', Inter, Arial, sans-serif" font-size="14" font-weight="500">
      <a href="https://trakt.tv/users/${username}" target="_blank" style="cursor: pointer;">
        <tspan fill="${t.textMuted}">@${escapeXml(username)}</tspan>
      </a>
      ${moviesCount > 0 ? `
      <tspan dx="5" fill="${t.textMuted}">•</tspan>
      <tspan dx="5" fill="${t.text}">${moviesCount}</tspan>
      <tspan fill="${t.textMuted}"> Movies</tspan>` : ''}
      ${episodesCount > 0 ? `
      <tspan dx="5" fill="${t.textMuted}">•</tspan>
      <tspan dx="5" fill="${t.text}">${episodesCount}</tspan>
      <tspan fill="${t.textMuted}"> Episodes</tspan>` : ''}
      ${followers > 0 ? `
      <tspan dx="5" fill="${t.textMuted}">•</tspan>
      <tspan dx="5" fill="${t.text}">${followers}</tspan>
      <tspan fill="${t.textMuted}"> Followers</tspan>` : ''}
    </text>

    <!-- Trakt Logo (clickable, links to main site) -->
    ${logoBase64 ? `<a href="https://trakt.tv/" target="_blank">
      <g transform="translate(${SVG_WIDTH - 117}, 0)">
        <image href="${logoBase64}" x="0" y="4" width="72" height="72" style="cursor: pointer;"/>
      </g>
    </a>` : ''}
  </g>

  <!-- Stats Row -->
  <g transform="translate(25, 115)" font-family="'Segoe UI', Inter, Arial, sans-serif">
    <text x="0" y="20" font-size="16" font-weight="600" fill="${t.text}">${displayYear}</text>
    

    <!-- Items count (static, no tooltip) -->
    <g transform="translate(60, 5)">
      <text x="0" y="15" font-size="14" font-weight="500" fill="${t.textMuted}">${totalItems} ${itemLabel}</text>
    </g>
    
    <!-- Days Active with hover tooltip -->
    <g class="days-active-group" transform="translate(180, 5)">
      <text x="0" y="15" font-size="14" font-weight="500" fill="${t.textMuted}">${daysActive} Days Active</text>
      <g class="days-active-tooltip" transform="translate(-20, -115)">
        <rect x="0" y="0" width="200" height="105" rx="6" fill="${t.tooltipBg}" stroke="${t.tooltipBorder}" stroke-width="1"/>
        <text x="100" y="18" font-size="11" font-weight="600" fill="${t.tooltipText}" text-anchor="middle">Weekly Distribution</text>
        ${(weekStart === 'monday' ? ['M','T','W','T','F','S','S'] : ['S','M','T','W','T','F','S']).map((day, i) => {
          const dayIndex = weekStart === 'monday' ? (i + 1) % 7 : i;
          const count = weeklyDistribution[dayIndex];
          const barHeight = maxWeeklyCount > 0 ? Math.round((count / maxWeeklyCount) * 45) : 0;
          const x = 20 + i * 24;
          return `
        <text x="${x + 7}" y="${80 - barHeight - 3}" font-size="9" fill="${t.tooltipText}" text-anchor="middle">${count}</text>
        <rect x="${x}" y="${80 - barHeight}" width="14" height="${barHeight}" rx="2" fill="${t.colors[3]}"/>
        <text x="${x + 7}" y="100" font-size="9" fill="${t.text}" text-anchor="middle">${day}</text>`;
        }).join('')}
      </g>
    </g>
    
    <!-- Streak with hover tooltip -->
    <g class="streak-group" transform="translate(320, 5)">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
            stroke="${streak.length > 0 ? '#ed1c24' : t.textMuted}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="${streak.length > 0 ? '#ed1c24' : 'none'}" fill-opacity="0.2" transform="scale(0.75)"/>
      <text x="18" y="13" font-size="14" font-weight="500" fill="${t.textMuted}">${streak.length} Day Streak</text>
      ${streak.length > 0 ? `<g class="streak-tooltip" transform="translate(0, -45)">
        <rect x="-10" y="0" width="180" height="36" rx="6" fill="${t.tooltipBg}" stroke="${t.tooltipBorder}" stroke-width="1"/>
        <text x="5" y="23" font-size="12" fill="${t.tooltipText}">${streak.startDate} → ${streak.endDate}</text>
      </g>` : ''}
    </g>

    <!-- Legend (right side) -->
    <g transform="translate(${SVG_WIDTH - 200}, 0)">
      <text x="0" y="20" font-size="12" fill="${t.textMuted}">Less</text>`;

  // Legend squares
  for (let i = 0; i < 5; i++) {
    svg += `
      <rect x="${35 + i * 18}" y="7" width="13" height="13" rx="2" fill="${t.colors[i]}"/>`;
  }

  svg += `
      <text x="${35 + 5 * 18 + 5}" y="20" font-size="12" fill="${t.textMuted}">More</text>
    </g>
  </g>

  <!-- Month Labels -->
  <g transform="translate(${GRID_OFFSET_X}, ${GRID_OFFSET_Y - 8})" font-family="'Segoe UI', Inter, Arial, sans-serif">`;

  for (let i = 0; i < 12; i++) {
    const firstDayOfMonth = new Date(Date.UTC(displayYear, i, 1));
    const daysSinceStart = Math.floor((firstDayOfMonth.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceStart < 0) continue;
    const weekIndex = Math.floor(daysSinceStart / 7);
    const x = weekIndex * (CELL_SIZE + CELL_GAP);
    svg += `<text x="${x}" y="0" font-size="11" fill="${t.textMuted}" font-weight="500">${MONTHS[i]}</text>`;
  }

  svg += `
  </g>

  <!-- Day Labels -->
  <g transform="translate(26, ${GRID_OFFSET_Y})" font-family="'Segoe UI', Inter, Arial, sans-serif">
    <text x="0" y="${0 * (CELL_SIZE + CELL_GAP) + 11}" font-size="10" fill="${t.textMuted}" text-anchor="end">${DAYS[0].charAt(0)}</text>
    <text x="0" y="${1 * (CELL_SIZE + CELL_GAP) + 11}" font-size="10" fill="${t.textMuted}" text-anchor="end">${DAYS[1].charAt(0)}</text>
    <text x="0" y="${2 * (CELL_SIZE + CELL_GAP) + 11}" font-size="10" fill="${t.textMuted}" text-anchor="end">${DAYS[2].charAt(0)}</text>
    <text x="0" y="${3 * (CELL_SIZE + CELL_GAP) + 11}" font-size="10" fill="${t.textMuted}" text-anchor="end">${DAYS[3].charAt(0)}</text>
    <text x="0" y="${4 * (CELL_SIZE + CELL_GAP) + 11}" font-size="10" fill="${t.textMuted}" text-anchor="end">${DAYS[4].charAt(0)}</text>
    <text x="0" y="${5 * (CELL_SIZE + CELL_GAP) + 11}" font-size="10" fill="${t.textMuted}" text-anchor="end">${DAYS[5].charAt(0)}</text>
    <text x="0" y="${6 * (CELL_SIZE + CELL_GAP) + 11}" font-size="10" fill="${t.textMuted}" text-anchor="end">${DAYS[6].charAt(0)}</text>
  </g>

  <!-- Activity Grid -->
  <g transform="translate(${GRID_OFFSET_X}, ${GRID_OFFSET_Y})">`;

  // Generate cells
  for (let day = 0; day < 7; day++) {
    for (let week = 0; week < totalWeeks; week++) {
      const cellDate = new Date(startDate);
      cellDate.setUTCDate(cellDate.getUTCDate() + week * 7 + day);
      
      // Use local date string for grouping/tooltips to fix timezone issues
      const year = cellDate.getFullYear();
      const month = String(cellDate.getMonth() + 1).padStart(2, '0');
      const dayOfMonth = String(cellDate.getDate()).padStart(2, '0');
      const tooltipDate = `${year}-${month}-${dayOfMonth}`;
      
      const itemsForDay = itemsPerDay.get(tooltipDate) || [];
      const count = itemsForDay.length;
      
      const color = getColor(count);
      const x = week * (CELL_SIZE + CELL_GAP);
      const y = day * (CELL_SIZE + CELL_GAP);

      const isOutsideYear = cellDate < new Date(Date.UTC(displayYear, 0, 1)) || cellDate > new Date(Date.UTC(displayYear, 11, 31));
      
      if (isOutsideYear) continue;

      const historyUrl = `https://trakt.tv/users/${username}/history`;

      // Tooltip content
      const dateObj = new Date(cellDate);
      const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateObj.getDay()];
      const dayNum = dateObj.getDate();
      const monthName = MONTHS[dateObj.getMonth()];
      const tooltipTitle = `${dayName}, ${dayNum}. ${monthName} ${year}: ${count} item${count !== 1 ? 's' : ''} watched`;
      
      const lineHeight = 18;
      const tooltipHeight = 38 + itemsForDay.length * lineHeight;
      
      // Format items for tooltip
      const formattedItems = itemsForDay.map(item => {
        if (item.type === 'episode' && item.episode) {
          return `• ${item.title} ${item.episode} (${item.year})`;
        }
        return `• ${item.title} (${item.year})`;
      });
      
      const tooltipWidth = Math.max(280, Math.max(...[tooltipTitle, ...formattedItems].map(s => s.length * 7)));

      // Position tooltip
      const tooltipX = Math.min(x, SVG_WIDTH - GRID_OFFSET_X - tooltipWidth - 10);
      
      // Check if this cell is part of the streak
      const isStreakCell = streak.length > 0 && streak.startDate && streak.endDate && 
        tooltipDate >= streak.startDate && tooltipDate <= streak.endDate;
      const cellClass = isStreakCell ? 'cell streak-cell' : 'cell';

      svg += `
    <g class="cell-group">
      <a href="${historyUrl}" target="_blank">
        <rect class="${cellClass}"
          x="${x}"
          y="${y}"
          width="${CELL_SIZE}"
          height="${CELL_SIZE}"
          rx="2"
          fill="${color}"
        />
        <g class="tooltip-group" transform="translate(${tooltipX}, ${y - tooltipHeight - 8})">
          <rect x="0" y="0" width="${tooltipWidth}" height="${tooltipHeight}" rx="6" fill="${t.tooltipBg}" stroke="${t.tooltipBorder}" stroke-width="1"/>
          <text font-family="'Segoe UI', Inter, Arial, sans-serif" font-size="12" fill="${t.tooltipText}">
            <tspan x="10" dy="22" font-weight="600">${escapeXml(tooltipTitle)}</tspan>`;
      
      itemsForDay.forEach((item) => {
        let displayText;
        if (item.type === 'episode' && item.episode) {
          displayText = `• ${item.title} ${item.episode} (${item.year})`;
        } else {
          displayText = `• ${item.title} (${item.year})`;
        }
        svg += `
            <tspan x="10" dy="${lineHeight}">${escapeXml(displayText)}</tspan>`;
      });

      svg += `
          </text>
        </g>
      </a>
    </g>`;
    }
  }

  svg += `
  </g>
</svg>`;

  return svg;
}

/**
 * Generate a multi-year SVG contribution graph
 * Shows multiple years stacked vertically with a shared header
 */
export function generateMultiYearSvg(entries, options = {}) {
  const { 
    theme = 'dark', 
    years = [new Date().getFullYear()],
    weekStart = 'sunday',
    username = '',
    profileImage = null,
    displayName = username,
    usernameGradient = true,
    logoBase64 = null,
    contentType = 'all',
    moviesCount = 0,
    episodesCount = 0,
    followers = 0
  } = options;

  // Sort years descending (newest first)
  const sortedYears = [...years].sort((a, b) => b - a);
  
  // Dimensions
  const CELL_SIZE = 14;
  const CELL_GAP = 3;
  const YEAR_HEIGHT = 180;
  const HEADER_HEIGHT = 75;
  const SVG_WIDTH = 1000;
  const SVG_HEIGHT = HEADER_HEIGHT + 40 + (sortedYears.length * YEAR_HEIGHT);

  // Day/Month labels
  const DAYS_SUNDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DAYS_MONDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAYS = weekStart === 'monday' ? DAYS_MONDAY : DAYS_SUNDAY;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Theme colors - Trakt style
  const themes = {
    dark: {
      bg: '#0d1117',
      cardBorder: '#21262d',
      text: '#e6edf3',
      textMuted: '#7d8590',
      tooltipBg: '#161b22',
      tooltipBorder: '#30363d',
      tooltipText: '#f0f6fc',
      colors: ['#161b22', '#5c1015', '#8b1a22', '#c41e2a', '#ed1c24']
    },
    light: {
      bg: '#ffffff',
      cardBorder: '#d1d9e0',
      text: '#1f2328',
      textMuted: '#656d76',
      tooltipBg: '#ffffff',
      tooltipBorder: '#d1d9e0',
      tooltipText: '#1f2328',
      colors: ['#ebedf0', '#ffc9cc', '#ff8a8f', '#ed4c55', '#ed1c24']
    }
  };

  const t = themes[theme] || themes.dark;

  // Item label based on total entries in the range
  // Item label
  const itemLabel = contentType === 'movies' ? 'Movies' 
    : contentType === 'shows' ? 'Episodes' 
    : 'Items';

  // Start building SVG
  let svg = `<svg width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.1"/>
    </filter>
    <clipPath id="profileClip">
      <circle cx="40" cy="40" r="40"/>
    </clipPath>
    <linearGradient id="usernameGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ED1C24"/>
      <stop offset="100%" stop-color="#FF6B6B"/>
    </linearGradient>
    <style type="text/css">
      <![CDATA[
      ${generateFontFaceCSS()}
      .tooltip-group { opacity: 0; transition: opacity 0.2s ease; pointer-events: none; }
      .cell-group:hover .tooltip-group { opacity: 1; }
      .cell-group:hover .cell { filter: brightness(1.3); }
      .cell { transition: filter 0.2s ease; }
      .streak-tooltip { opacity: 0; transition: opacity 0.2s ease; pointer-events: none; }
      .streak-group:hover .streak-tooltip { opacity: 1; }
      .streak-group:hover { cursor: pointer; }
      .streak-cell { transition: filter 0.2s ease, stroke 0.2s ease, stroke-width 0.2s ease; }
      ${sortedYears.map(y => `svg:has(.streak-group-${y}:hover) .streak-cell-${y} { filter: brightness(1.4) saturate(1.2); stroke: #ed1c24; stroke-width: 2; }`).join('\n      ')}
      .days-active-tooltip { opacity: 0; transition: opacity 0.2s ease; pointer-events: none; }
      .days-active-group:hover .days-active-tooltip { opacity: 1; }
      .days-active-group:hover { cursor: pointer; }
      .items-tooltip { opacity: 0; transition: opacity 0.2s ease; pointer-events: none; }
      .items-group:hover .items-tooltip { opacity: 1; }
      .items-group:hover { cursor: pointer; }
      ]]>
    </style>
  </defs>
  
  <!-- Main Card -->
  <rect width="100%" height="100%" rx="12" fill="${t.bg}" stroke="${t.cardBorder}" stroke-width="1" filter="url(#shadow)"/>

  <!-- Header Section -->
  <g transform="translate(25, 20)">
    <!-- Profile Image (clickable) -->
    <a href="https://trakt.tv/users/${username}" target="_blank">
      <circle cx="40" cy="40" r="42" fill="${t.cardBorder}"/>
      ${profileImage ? `<image href="${profileImage}" x="0" y="0" width="80" height="80" clip-path="url(#profileClip)" style="cursor: pointer;"/>` : `<circle cx="40" cy="40" r="40" fill="${t.colors[2]}"/>`}
    </a>

    <!-- Name and Info (clickable) -->
    <a href="https://trakt.tv/users/${username}" target="_blank">
      <text x="100" y="35" font-family="'Segoe UI', Inter, Arial, sans-serif" font-size="28" font-weight="600" fill="${usernameGradient ? 'url(#usernameGradient)' : t.text}" style="cursor: pointer;">${escapeXml(displayName)}</text>
    </a>

    <text x="100" y="60" font-family="'Segoe UI', Inter, Arial, sans-serif" font-size="14" font-weight="500">
      <a href="https://trakt.tv/users/${username}" target="_blank" style="cursor: pointer;">
        <tspan fill="${t.textMuted}">@${escapeXml(username)}</tspan>
      </a>
      ${moviesCount > 0 ? `
      <tspan dx="5" fill="${t.textMuted}">•</tspan>
      <tspan dx="5" fill="${t.text}">${moviesCount}</tspan>
      <tspan fill="${t.textMuted}"> Movies</tspan>` : ''}
      ${episodesCount > 0 ? `
      <tspan dx="5" fill="${t.textMuted}">•</tspan>
      <tspan dx="5" fill="${t.text}">${episodesCount}</tspan>
      <tspan fill="${t.textMuted}"> Episodes</tspan>` : ''}
      ${followers > 0 ? `
      <tspan dx="5" fill="${t.textMuted}">•</tspan>
      <tspan dx="5" fill="${t.text}">${followers}</tspan>
      <tspan fill="${t.textMuted}"> Followers</tspan>` : ''}
    </text>

    <!-- Trakt Logo (clickable) -->
    ${logoBase64 ? `<a href="https://trakt.tv/" target="_blank">
      <g transform="translate(${SVG_WIDTH - 117}, 0)">
        <image href="${logoBase64}" x="0" y="4" width="72" height="72" style="cursor: pointer;"/>
      </g>
    </a>` : ''}
  </g>`;

  // Generate each year
  sortedYears.forEach((year, yearIndex) => {
    const yearOffset = HEADER_HEIGHT + 40 + (yearIndex * YEAR_HEIGHT);
    
    // Filter entries for this year
    const yearEntries = entries.filter(entry => entry.date.getFullYear() === year);
    const streak = calculateStreak(yearEntries);
    const daysActive = calculateDaysActive(yearEntries);
    const totalItems = yearEntries.length;
    const itemsPerDay = groupEntriesByDate(yearEntries);
    
    // Calculate weekly distribution for this year
    const weeklyDistribution = [0, 0, 0, 0, 0, 0, 0];
    yearEntries.forEach(entry => {
      weeklyDistribution[entry.date.getDay()]++;
    });
    const maxWeeklyCount = Math.max(...weeklyDistribution);
    
    // Calculate rating distribution for this year
    const ratingDistribution = {};
    const ratingLabels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    ratingLabels.forEach(r => ratingDistribution[r] = 0);
    ratingDistribution['unrated'] = 0;
    
    yearEntries.forEach(entry => {
      if (entry.rating && entry.rating > 0) {
        const ratingKey = String(Math.round(entry.rating));
        if (ratingDistribution.hasOwnProperty(ratingKey)) {
          ratingDistribution[ratingKey]++;
        }
      } else {
        ratingDistribution['unrated']++;
      }
    });
    const maxRatingCount = Math.max(...ratingLabels.map(r => ratingDistribution[r]));

    // Setup date range for this year
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31));
    
    const startDay = startDate.getUTCDay();
    const dayShift = weekStart === 'monday' ? (startDay + 6) % 7 : startDay;
    if (dayShift > 0) {
      startDate.setUTCDate(startDate.getUTCDate() - dayShift);
    }

    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const totalWeeks = Math.ceil(totalDays / 7);

    // Build activity grid for this year
    const grid = Array(7).fill(0).map(() => Array(totalWeeks).fill(0));
    let maxCount = 0;

    yearEntries.forEach(entry => {
      const daysSinceStart = Math.floor((entry.date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const weekIndex = Math.floor(daysSinceStart / 7);
      const dayIndex = weekStart === 'monday' ? (entry.date.getUTCDay() + 6) % 7 : entry.date.getUTCDay();

      if (weekIndex >= 0 && weekIndex < totalWeeks) {
        grid[dayIndex][weekIndex]++;
        maxCount = Math.max(maxCount, grid[dayIndex][weekIndex]);
      }
    });

    function getColor(count) {
      if (count === 0) return t.colors[0];

      if (maxCount === 0) return t.colors[0];
      const level = Math.ceil((count / maxCount) * 4);
      return t.colors[Math.min(level, 4)];
    }

    // Stats Row for this year
    svg += `
  <!-- Year ${year} -->
  <g transform="translate(25, ${yearOffset})" font-family="'Segoe UI', Inter, Arial, sans-serif">
    <text x="0" y="20" font-size="16" font-weight="600" fill="${t.text}">${year}</text>
    <!-- Items count (static, no tooltip) -->
    <g transform="translate(60, 5)">
      <text x="0" y="15" font-size="14" font-weight="500" fill="${t.textMuted}">${totalItems} ${itemLabel}</text>
    </g>
    
    <!-- Days Active with hover tooltip -->
    <g class="days-active-group" transform="translate(180, 5)">
      <text x="0" y="15" font-size="14" font-weight="500" fill="${t.textMuted}">${daysActive} Days Active</text>
      <g class="days-active-tooltip" transform="translate(-20, -115)">
        <rect x="0" y="0" width="200" height="105" rx="6" fill="${t.tooltipBg}" stroke="${t.tooltipBorder}" stroke-width="1"/>
        <text x="100" y="18" font-size="11" font-weight="600" fill="${t.tooltipText}" text-anchor="middle">Weekly Distribution</text>
        ${(weekStart === 'monday' ? ['M','T','W','T','F','S','S'] : ['S','M','T','W','T','F','S']).map((day, i) => {
          const dayIndex = weekStart === 'monday' ? (i + 1) % 7 : i;
          const count = weeklyDistribution[dayIndex];
          const barHeight = maxWeeklyCount > 0 ? Math.round((count / maxWeeklyCount) * 45) : 0;
          const x = 20 + i * 24;
          return `
        <text x="${x + 7}" y="${80 - barHeight - 3}" font-size="9" fill="${t.tooltipText}" text-anchor="middle">${count}</text>
        <rect x="${x}" y="${80 - barHeight}" width="14" height="${barHeight}" rx="2" fill="${t.colors[3]}"/>
        <text x="${x + 7}" y="100" font-size="9" fill="${t.text}" text-anchor="middle">${day}</text>`;
        }).join('')}
      </g>
    </g>
    <!-- Streak with hover tooltip -->
    <g class="streak-group streak-group-${year}" transform="translate(320, 5)">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
            stroke="${streak.length > 0 ? '#ed1c24' : t.textMuted}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="${streak.length > 0 ? '#ed1c24' : 'none'}" fill-opacity="0.2" transform="scale(0.75)"/>
      <text x="18" y="13" font-size="14" font-weight="500" fill="${t.textMuted}">${streak.length} Day Streak</text>
      ${streak.length > 0 ? `<g class="streak-tooltip" transform="translate(0, -45)">
        <rect x="-10" y="0" width="180" height="36" rx="6" fill="${t.tooltipBg}" stroke="${t.tooltipBorder}" stroke-width="1"/>
        <text x="5" y="23" font-size="12" fill="${t.tooltipText}">${streak.startDate} → ${streak.endDate}</text>
      </g>` : ''}
    </g>
    ${yearIndex === 0 ? `<g transform="translate(${SVG_WIDTH - 200}, 0)">
      <text x="0" y="20" font-size="12" fill="${t.textMuted}">Less</text>
      <rect x="35" y="7" width="13" height="13" rx="2" fill="${t.colors[0]}"/>
      <rect x="53" y="7" width="13" height="13" rx="2" fill="${t.colors[1]}"/>
      <rect x="71" y="7" width="13" height="13" rx="2" fill="${t.colors[2]}"/>
      <rect x="89" y="7" width="13" height="13" rx="2" fill="${t.colors[3]}"/>
      <rect x="107" y="7" width="13" height="13" rx="2" fill="${t.colors[4]}"/>
      <text x="130" y="20" font-size="12" fill="${t.textMuted}">More</text>
    </g>` : ''}
  </g>

  <!-- Month Labels ${year} -->
  <g transform="translate(51, ${yearOffset + 42})" font-family="'Segoe UI', Inter, Arial, sans-serif">`;

    // Generate month labels for this year
    for (let i = 0; i < 12; i++) {
      const firstDayOfMonth = new Date(Date.UTC(year, i, 1));
      const daysSinceStart = Math.floor((firstDayOfMonth.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceStart < 0) continue;
      const weekIndex = Math.floor(daysSinceStart / 7);
      const x = weekIndex * (CELL_SIZE + CELL_GAP);
      svg += `<text x="${x}" y="0" font-size="11" fill="${t.textMuted}" font-weight="500">${MONTHS[i]}</text>`;
    }

    svg += `
  </g>

  <!-- Day Labels ${year} -->
  <g transform="translate(26, ${yearOffset + 50})" font-family="'Segoe UI', Inter, Arial, sans-serif">
    <text x="0" y="${0 * (CELL_SIZE + CELL_GAP) + 11}" font-size="10" fill="${t.textMuted}" text-anchor="end">${DAYS[0].charAt(0)}</text>
    <text x="0" y="${1 * (CELL_SIZE + CELL_GAP) + 11}" font-size="10" fill="${t.textMuted}" text-anchor="end">${DAYS[1].charAt(0)}</text>
    <text x="0" y="${2 * (CELL_SIZE + CELL_GAP) + 11}" font-size="10" fill="${t.textMuted}" text-anchor="end">${DAYS[2].charAt(0)}</text>
    <text x="0" y="${3 * (CELL_SIZE + CELL_GAP) + 11}" font-size="10" fill="${t.textMuted}" text-anchor="end">${DAYS[3].charAt(0)}</text>
    <text x="0" y="${4 * (CELL_SIZE + CELL_GAP) + 11}" font-size="10" fill="${t.textMuted}" text-anchor="end">${DAYS[4].charAt(0)}</text>
    <text x="0" y="${5 * (CELL_SIZE + CELL_GAP) + 11}" font-size="10" fill="${t.textMuted}" text-anchor="end">${DAYS[5].charAt(0)}</text>
    <text x="0" y="${6 * (CELL_SIZE + CELL_GAP) + 11}" font-size="10" fill="${t.textMuted}" text-anchor="end">${DAYS[6].charAt(0)}</text>
  </g>

  <!-- Activity Grid ${year} -->
  <g transform="translate(51, ${yearOffset + 50})">`;

    // Generate cells for this year
    for (let day = 0; day < 7; day++) {
    for (let week = 0; week < totalWeeks; week++) {
        const cellDate = new Date(startDate);
        cellDate.setUTCDate(cellDate.getUTCDate() + week * 7 + day);
        
        // Use local date string
        const yearVal = cellDate.getFullYear();
        const monthVal = String(cellDate.getMonth() + 1).padStart(2, '0');
        const dayOfMonthVal = String(cellDate.getDate()).padStart(2, '0');
        const tooltipDate = `${yearVal}-${monthVal}-${dayOfMonthVal}`;
        
        const itemsForDay = itemsPerDay.get(tooltipDate) || [];
        const count = itemsForDay.length;
        
        const color = getColor(count);

        const x = week * (CELL_SIZE + CELL_GAP);
        const y = day * (CELL_SIZE + CELL_GAP);

        const isOutsideYear = cellDate < new Date(Date.UTC(year, 0, 1)) || cellDate > new Date(Date.UTC(year, 11, 31));
        
        if (isOutsideYear) continue;

        const historyUrl = `https://trakt.tv/users/${username}/history`;

        // Tooltip content
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][cellDate.getDay()];
        const dayNum = cellDate.getDate();
        const monthName = MONTHS[cellDate.getMonth()];
        const tooltipTitle = `${dayName}, ${dayNum}. ${monthName} ${year}: ${count} item${count !== 1 ? 's' : ''} watched`;
        
        const lineHeight = 18;
        const tooltipHeight = 38 + itemsForDay.length * lineHeight;
        
        const formattedItems = itemsForDay.map(item => {
          if (item.type === 'episode' && item.episode) {
            return `• ${item.title} ${item.episode} (${item.year})`;
          }
          return `• ${item.title} (${item.year})`;
        });
        
        const tooltipWidth = Math.max(280, Math.max(...[tooltipTitle, ...formattedItems].map(s => s.length * 7)));

        // Position tooltip
        const tooltipX = Math.min(x, SVG_WIDTH - 51 - tooltipWidth - 10);
        
        // Check if this cell is part of the streak
        const isStreakCell = streak.length > 0 && streak.startDate && streak.endDate && 
          tooltipDate >= streak.startDate && tooltipDate <= streak.endDate;
        const cellClass = isStreakCell ? `cell streak-cell streak-cell-${year}` : 'cell';

        svg += `
    <g class="cell-group">
      <a href="${historyUrl}" target="_blank">
        <rect class="${cellClass}"
          x="${x}"
          y="${y}"
          width="${CELL_SIZE}"
          height="${CELL_SIZE}"
          rx="2"
          fill="${color}"
        />
        <g class="tooltip-group" transform="translate(${tooltipX}, ${y - tooltipHeight - 8})">
          <rect x="0" y="0" width="${tooltipWidth}" height="${tooltipHeight}" rx="6" fill="${t.tooltipBg}" stroke="${t.tooltipBorder}" stroke-width="1"/>
          <text font-family="'Segoe UI', Inter, Arial, sans-serif" font-size="12" fill="${t.tooltipText}">
            <tspan x="10" dy="22" font-weight="600">${escapeXml(tooltipTitle)}</tspan>`;
      
      itemsForDay.forEach((item) => {
        let displayText;
        if (item.type === 'episode' && item.episode) {
          displayText = `• ${item.title} ${item.episode} (${item.year})`;
        } else {
          displayText = `• ${item.title} (${item.year})`;
        }
        svg += `
            <tspan x="10" dy="${lineHeight}">${escapeXml(displayText)}</tspan>`;
      });

      svg += `
          </text>
        </g>
      </a>
    </g>`;
      }
    }

    svg += `
  </g>`;
  });

  svg += `
</svg>`;

  return svg;
}
