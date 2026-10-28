/** The YANTRA mark: a yantra-like square-in-circle in the accent colour. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--accent)" />
      <circle cx="12" cy="12" r="6.6" fill="none" stroke="var(--accent-fg)" strokeWidth="1.6" />
      <path d="M12 6.2 17 15H7z" fill="none" stroke="var(--accent-fg)" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12.1" r="1.3" fill="var(--accent-fg)" />
    </svg>
  );
}
