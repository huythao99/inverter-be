import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface VirtualListProps<T> {
  items: T[];
  /** Fixed height (px) of every row, including the gap below it. */
  itemHeight: number;
  /** Height (px) of the scroll viewport. */
  height?: number;
  /** Extra rows rendered above/below the viewport to avoid blank flashes. */
  overscan?: number;
  renderItem: (item: T, index: number) => ReactNode;
}

/**
 * Lightweight windowed list: only rows visible in the viewport are mounted,
 * so it can handle very large lists (e.g. 10000 messages) without lag.
 * Requires a fixed row height.
 */
function VirtualList<T>({
  items,
  itemHeight,
  height = 600,
  overscan = 6,
  renderItem,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const total = items.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(height / itemHeight) + overscan * 2;
  const endIndex = Math.min(total, startIndex + visibleCount);
  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <div
      ref={containerRef}
      className="virtual-list"
      style={{ height, overflowY: 'auto', position: 'relative' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: total * itemHeight, position: 'relative' }}>
        {visibleItems.map((item, i) => {
          const index = startIndex + i;
          return (
            <div
              key={index}
              className="virtual-list-row"
              style={{
                position: 'absolute',
                top: index * itemHeight,
                left: 0,
                right: 0,
                height: itemHeight,
              }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VirtualList;
