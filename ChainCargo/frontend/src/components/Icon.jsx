const paths = {
  box: ['m12 3 9 5v8l-9 5-9-5V8l9-5Z', 'm3 8 9 5 9-5', 'M12 13v8', 'm7.5 5.5 9 5'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  arrows: ['M4 7h16m-4-4 4 4-4 4', 'M20 17H4m4-4-4 4 4 4'],
  wallet: ['M20 8V5H5a2 2 0 0 0 0 4h15v11H5a2 2 0 0 1-2-2V7', 'M20 12h-5v4h5'],
  shield: ['m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z', 'm8 12 3 3 5-6'],
  user: ['M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', 'M4 21v-2a8 8 0 0 1 16 0v2'],
  settings: ['M4 7h16M4 17h16', 'M8 4v6m8 4v6'],
  arrow: ['M5 12h14m-6-6 6 6-6 6'],
  chevron: ['m9 5 7 7-7 7'],
  external: ['M14 3h7v7m0-7L10 14', 'M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5'],
  plus: ['M12 5v14M5 12h14'],
  search: ['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', 'm15 15 6 6'],
  menu: ['M4 6h16M4 12h16M4 18h16'],
  close: ['m6 6 12 12M6 18 18 6'],
  check: ['m5 12 4 4L19 6'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M12 7v5l3 2'],
  file: ['M14 2H5v20h14V7l-5-5Z', 'M14 2v6h5M8 13h8M8 17h5'],
  truck: ['M3 5h11v12H3z', 'M14 9h4l3 4v4h-7', 'M8 17a2 2 0 1 1-4 0m16 0a2 2 0 1 1-4 0'],
  download: ['M12 3v12m-5-5 5 5 5-5', 'M4 16v5h16v-5'],
  globe: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z'],
  lock: ['M5 10h14v11H5z', 'M8 10V6a4 4 0 0 1 8 0v4M12 14v3'],
};
export default function Icon({ name, size = 20, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(paths[name] || paths.box).map((d, index) => <path className={index === 1 ? 'icon-detail' : undefined} d={d} key={index} />)}
    </svg>
  );
}
