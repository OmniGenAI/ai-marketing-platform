# Custom Scrollbar Guide

This guide explains how to use custom scrollbars with Tailwind colors in your application.

## Quick Start

### Method 1: Using Predefined Classes

Apply a scrollbar class directly to any scrollable element:

```tsx
// Purple scrollbar
<div className="h-96 overflow-y-auto scrollbar-purple">
  <div>Your content</div>
</div>

// Red scrollbar
<div className="h-96 overflow-y-auto scrollbar-red">
  <div>Your content</div>
</div>

// Blue scrollbar
<div className="h-96 overflow-y-auto scrollbar-blue">
  <div>Your content</div>
</div>

// Green scrollbar
<div className="h-96 overflow-y-auto scrollbar-green">
  <div>Your content</div>
</div>

// Default gray scrollbar
<div className="h-96 overflow-y-auto scrollbar-thin">
  <div>Your content</div>
</div>
```

### Method 2: Using the ScrollableWithColorbar Component

Use the provided React component for easier usage:

```tsx
import { ScrollableWithColorbar } from '@/components/ScrollableWithColorbar';

export function MyComponent() {
  return (
    <ScrollableWithColorbar color="purple" className="h-96">
      <div>Your content here</div>
    </ScrollableWithColorbar>
  );
}
```

Supported colors:
- `purple` (default theme color)
- `red` (error/destructive)
- `blue` (info)
- `green` (success)
- `gray` (neutral)

### Method 3: Using the Utility Function

For custom colors not in the predefined list:

```tsx
import { getScrollbarClass } from '@/utils/scrollbar';

export function MyComponent() {
  const scrollbarClass = getScrollbarClass('purple');
  
  return (
    <div className={`overflow-y-auto ${scrollbarClass}`}>
      <div>Your content</div>
    </div>
  );
}
```

## Available Scrollbar Classes

These classes are pre-defined in `src/app/globals.css`:

| Class | Color | Usage |
|-------|-------|-------|
| `scrollbar-thin` | Gray | Default, neutral theme |
| `scrollbar-purple` | Purple | Primary brand color |
| `scrollbar-red` | Red | Errors, destructive actions |
| `scrollbar-blue` | Blue | Info, links |
| `scrollbar-green` | Green | Success, positive actions |

## Customizing Colors

To add more scrollbar colors, edit `src/app/globals.css` and add a new class block:

```css
/* Scrollbar with orange color */
.scrollbar-orange {
  scrollbar-width: thin;
  scrollbar-color: rgb(249 115 22) transparent;
}

.scrollbar-orange::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.scrollbar-orange::-webkit-scrollbar-track {
  background: transparent;
}

.scrollbar-orange::-webkit-scrollbar-thumb {
  background-color: rgb(249 115 22);
  border-radius: 3px;
  border: 1px solid transparent;
  background-clip: padding-box;
}

.scrollbar-orange::-webkit-scrollbar-thumb:hover {
  background-color: rgb(234 88 12);
}
```

Then update the `ScrollableWithColorbar` component to accept the new color.

## Real-World Example

### Example 1: Sidebar with Purple Scrollbar

```tsx
<Card className="h-[calc(100vh-13rem)]">
  <CardHeader className="shrink-0">
    <CardTitle>Options</CardTitle>
  </CardHeader>
  <CardContent className="flex-1 overflow-y-auto scrollbar-purple space-y-4">
    {/* Content here will scroll with purple scrollbar */}
  </CardContent>
</Card>
```

### Example 2: Dynamic Scrollbar Color

```tsx
import { ScrollableWithColorbar } from '@/components/ScrollableWithColorbar';

export function ConfigPanel({ theme }: { theme: 'purple' | 'red' | 'blue' | 'green' }) {
  return (
    <ScrollableWithColorbar color={theme} className="h-96 p-4">
      <div>Dynamic themed scrollbar</div>
    </ScrollableWithColorbar>
  );
}
```

## Browser Support

- ✅ Chrome/Edge (using `::-webkit-scrollbar`)
- ✅ Firefox (using `scrollbar-width` and `scrollbar-color`)
- ✅ Safari (using `::-webkit-scrollbar`)
- ⚠️ Mobile browsers may show native scrollbars

## CSS Properties

The scrollbar styling uses:

1. **`scrollbar-width: thin`** - Sets scrollbar width in Firefox (6px)
2. **`scrollbar-color`** - Firefox scrollbar colors
3. **`::-webkit-scrollbar`** - Webkit browser scrollbar styling
4. **`background-clip: padding-box`** - Creates visual gap effect

## Performance

The custom scrollbars are pure CSS and have minimal performance impact.
