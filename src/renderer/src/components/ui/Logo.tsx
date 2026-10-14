import { useId } from 'react';

/** The Ultima mark, filled with the current color gradient (`--grad-1…3`). */
export function Logo({ size = 34 }: { size?: number }) {
  const id = `ultima-logo-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--grad-1)' }} />
          <stop offset="0.5" style={{ stopColor: 'var(--grad-2)' }} />
          <stop offset="1" style={{ stopColor: 'var(--grad-3)' }} />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="14" fill={`url(#${id})`} />
      <path d="M20 18v17a12 12 0 0 0 24 0V18" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}
