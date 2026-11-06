import type { CSSProperties } from 'react';
import { textColorForBackground } from './appearance';

export function CommitCountBadge({
  direction,
  count,
  label,
  color,
}: {
  direction: 'pull' | 'push';
  count: number;
  label: string;
  color?: string;
}) {
  if (!Number.isFinite(count) || count <= 0) return null;
  return (
    <span
      className={`notification-badge notification-badge-${direction}`}
      role="img"
      aria-label={label}
      title={label}
      style={
        color
          ? ({
              '--notification-badge': color,
              '--notification-badge-fg': textColorForBackground(color),
            } as CSSProperties)
          : undefined
      }
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
