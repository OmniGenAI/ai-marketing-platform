/**
 * Scrollbar utility for applying custom scrollbar colors
 * Supports Tailwind color names with optional intensity levels
 * 
 * Usage:
 * - className={getScrollbarClass('purple')}
 * - className={getScrollbarClass('purple-500')}
 * - className={getScrollbarClass('red')}
 */

type TailwindColor = 
  | 'slate' | 'gray' | 'zinc' | 'neutral' | 'stone'
  | 'red' | 'orange' | 'amber' | 'yellow' | 'lime' | 'green' | 'emerald'
  | 'teal' | 'cyan' | 'sky' | 'blue' | 'indigo' | 'violet' | 'purple'
  | 'fuchsia' | 'pink' | 'rose';

type ColorIntensity = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950';

// Tailwind color to RGB mapping (standard shades)
const TAILWIND_COLORS: Record<string, string> = {
  // Slate
  'slate': 'rgb(100 116 139)',
  'slate-300': 'rgb(203 213 225)',
  'slate-500': 'rgb(100 116 139)',
  'slate-600': 'rgb(71 85 105)',
  'slate-700': 'rgb(51 65 85)',

  // Gray
  'gray': 'rgb(107 114 128)',
  'gray-300': 'rgb(209 213 219)',
  'gray-500': 'rgb(107 114 128)',
  'gray-600': 'rgb(75 85 99)',
  'gray-700': 'rgb(55 65 81)',

  // Zinc
  'zinc': 'rgb(113 113 122)',
  'zinc-300': 'rgb(212 212 216)',
  'zinc-500': 'rgb(113 113 122)',
  'zinc-600': 'rgb(82 82 91)',
  'zinc-700': 'rgb(63 63 70)',

  // Red
  'red': 'rgb(239 68 68)',
  'red-300': 'rgb(252 165 165)',
  'red-500': 'rgb(239 68 68)',
  'red-600': 'rgb(220 38 38)',
  'red-700': 'rgb(185 28 28)',

  // Orange
  'orange': 'rgb(249 115 22)',
  'orange-300': 'rgb(253 186 116)',
  'orange-500': 'rgb(249 115 22)',
  'orange-600': 'rgb(234 88 12)',
  'orange-700': 'rgb(194 65 12)',

  // Amber
  'amber': 'rgb(245 158 11)',
  'amber-300': 'rgb(253 224 71)',
  'amber-500': 'rgb(245 158 11)',
  'amber-600': 'rgb(217 119 6)',
  'amber-700': 'rgb(180 83 9)',

  // Yellow
  'yellow': 'rgb(234 179 8)',
  'yellow-300': 'rgb(253 224 71)',
  'yellow-500': 'rgb(234 179 8)',
  'yellow-600': 'rgb(202 138 4)',
  'yellow-700': 'rgb(161 98 7)',

  // Lime
  'lime': 'rgb(132 204 22)',
  'lime-300': 'rgb(190 242 100)',
  'lime-500': 'rgb(132 204 22)',
  'lime-600': 'rgb(101 163 13)',
  'lime-700': 'rgb(77 124 15)',

  // Green
  'green': 'rgb(34 197 94)',
  'green-300': 'rgb(134 239 172)',
  'green-500': 'rgb(34 197 94)',
  'green-600': 'rgb(22 163 74)',
  'green-700': 'rgb(16 185 129)',

  // Emerald
  'emerald': 'rgb(16 185 129)',
  'emerald-300': 'rgb(110 231 183)',
  'emerald-500': 'rgb(16 185 129)',
  'emerald-600': 'rgb(5 150 105)',
  'emerald-700': 'rgb(4 120 87)',

  // Teal
  'teal': 'rgb(20 184 166)',
  'teal-300': 'rgb(94 234 212)',
  'teal-500': 'rgb(20 184 166)',
  'teal-600': 'rgb(13 148 136)',
  'teal-700': 'rgb(15 118 110)',

  // Cyan
  'cyan': 'rgb(34 211 238)',
  'cyan-300': 'rgb(165 243 252)',
  'cyan-500': 'rgb(34 211 238)',
  'cyan-600': 'rgb(8 145 178)',
  'cyan-700': 'rgb(14 116 144)',

  // Sky
  'sky': 'rgb(56 189 248)',
  'sky-300': 'rgb(125 211 252)',
  'sky-500': 'rgb(56 189 248)',
  'sky-600': 'rgb(7 168 213)',
  'sky-700': 'rgb(3 102 214)',

  // Blue
  'blue': 'rgb(59 130 246)',
  'blue-300': 'rgb(147 197 253)',
  'blue-500': 'rgb(59 130 246)',
  'blue-600': 'rgb(37 99 235)',
  'blue-700': 'rgb(29 78 216)',

  // Indigo
  'indigo': 'rgb(99 102 241)',
  'indigo-300': 'rgb(165 180 252)',
  'indigo-500': 'rgb(99 102 241)',
  'indigo-600': 'rgb(79 70 229)',
  'indigo-700': 'rgb(67 56 202)',

  // Violet
  'violet': 'rgb(139 92 246)',
  'violet-300': 'rgb(196 181 253)',
  'violet-500': 'rgb(139 92 246)',
  'violet-600': 'rgb(124 58 255)',
  'violet-700': 'rgb(109 40 217)',

  // Purple
  'purple': 'rgb(168 85 247)',
  'purple-300': 'rgb(216 180 254)',
  'purple-500': 'rgb(168 85 247)',
  'purple-600': 'rgb(147 51 234)',
  'purple-700': 'rgb(126 34 206)',

  // Fuchsia
  'fuchsia': 'rgb(232 5 140)',
  'fuchsia-300': 'rgb(244 114 182)',
  'fuchsia-500': 'rgb(232 5 140)',
  'fuchsia-600': 'rgb(219 39 119)',
  'fuchsia-700': 'rgb(190 24 93)',

  // Pink
  'pink': 'rgb(236 72 153)',
  'pink-300': 'rgb(249 168 212)',
  'pink-500': 'rgb(236 72 153)',
  'pink-600': 'rgb(219 39 119)',
  'pink-700': 'rgb(190 24 93)',

  // Rose
  'rose': 'rgb(244 63 94)',
  'rose-300': 'rgb(253 164 175)',
  'rose-500': 'rgb(244 63 94)',
  'rose-600': 'rgb(225 29 72)',
  'rose-700': 'rgb(190 24 93)',
};

/**
 * Get the RGB value for a Tailwind color
 * @param color - Tailwind color name (e.g., 'purple', 'purple-500', 'red')
 * @returns RGB value string (e.g., 'rgb(168 85 247)')
 */
export function getTailwindColorRGB(color: string): string {
  // Check exact match first
  if (TAILWIND_COLORS[color]) {
    return TAILWIND_COLORS[color];
  }

  // Try to find base color match
  const baseColor = color.split('-')[0];
  if (TAILWIND_COLORS[baseColor]) {
    return TAILWIND_COLORS[baseColor];
  }

  // Default to gray
  return TAILWIND_COLORS['gray'];
}

/**
 * Generate inline styles for a scrollbar with a specific color
 * @param color - Tailwind color name (e.g., 'purple', 'red-500')
 * @returns CSS styles object
 */
export function getScrollbarStyles(color: string) {
  const rgb = getTailwindColorRGB(color);
  
  return {
    '--scrollbar-color': rgb,
  } as React.CSSProperties & { '--scrollbar-color': string };
}

/**
 * Get predefined scrollbar class name
 * Useful for commonly used colors without inline styles
 * @param color - 'purple', 'red', 'blue', 'green', 'gray'
 * @returns Class name
 */
export function getScrollbarClass(color: string): string {
  const scrollbarClasses: Record<string, string> = {
    purple: 'scrollbar-purple',
    red: 'scrollbar-red',
    blue: 'scrollbar-blue',
    green: 'scrollbar-green',
    gray: 'scrollbar-thin',
    default: 'scrollbar-thin',
  };

  return scrollbarClasses[color] || scrollbarClasses.default;
}

export default {
  getTailwindColorRGB,
  getScrollbarStyles,
  getScrollbarClass,
};
