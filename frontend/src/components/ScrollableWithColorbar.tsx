/**
 * ScrollableWithColorbar Component
 * 
 * A wrapper component that applies custom scrollbar colors to any element
 * 
 * Usage:
 * <ScrollableWithColorbar color="purple" className="h-96">
 *   <div>Your content here</div>
 * </ScrollableWithColorbar>
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { getScrollbarClass } from '@/utils/scrollbar';

interface ScrollableWithColorbarProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Tailwind color name
   * @example 'purple', 'red', 'blue', 'green'
   */
  color?: 'purple' | 'red' | 'blue' | 'green' | 'gray';
  
  /**
   * Children to render inside the scrollable container
   */
  children: React.ReactNode;
}

const ScrollableWithColorbar = React.forwardRef<HTMLDivElement, ScrollableWithColorbarProps>(
  ({ color = 'gray', className, children, ...props }, ref) => {
    const scrollbarClass = getScrollbarClass(color);

    return (
      <div
        ref={ref}
        className={cn('overflow-y-auto', scrollbarClass, className)}
        {...props}
      >
        {children}
      </div>
    );
  },
);

ScrollableWithColorbar.displayName = 'ScrollableWithColorbar';

export { ScrollableWithColorbar };
export default ScrollableWithColorbar;
