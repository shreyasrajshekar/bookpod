export function Ornament({ className = '' }) {
  return (
    <svg className={`ornament ${className}`} viewBox="0 0 220 24" aria-hidden="true">
      <path d="M10 12h78M132 12h78" stroke="currentColor" strokeWidth="1" />
      <path d="M110 3c4 5 9 7 14 9-5 2-10 4-14 9-4-5-9-7-14-9 5-2 10-4 14-9z" fill="currentColor" />
      <circle cx="92" cy="12" r="2" fill="currentColor" />
      <circle cx="128" cy="12" r="2" fill="currentColor" />
    </svg>
  )
}

export function Icon({ name }) {
  const p = {
    play: <path d="M8 5v14l11-7z" fill="currentColor" />,
    pause: <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />,
    next: <path d="M6 5l9 7-9 7zM17 5h2v14h-2z" fill="currentColor" />,
    prev: <path d="M18 5l-9 7 9 7zM5 5h2v14H5z" fill="currentColor" />,
    back: <path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" fill="currentColor" />,
    fwd: <path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z" fill="currentColor" />,
    moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" fill="currentColor" />,
    trash: <path d="M9 4h6l1 2h4v2H4V6h4zM6 9h12l-1 11H7z" fill="currentColor" />,
    plus: <path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z" fill="currentColor" />,
    book: <path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v13c-3-1-6-1-8 1-2-2-5-2-8-1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />,
  }
  return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">{p[name]}</svg>
}
