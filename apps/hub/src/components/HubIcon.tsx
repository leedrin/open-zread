import type { ReactNode, SVGProps } from 'react';

const paths: Record<string, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
  projects: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v5" /><path d="m10 14 2 2 4-4" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
  tasks: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12 2.5 2.5L16 9" /></>,
  provider: <><path d="M12 3v5m0 8v5M3 12h5m8 0h5" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="9" /></>,
  settings: <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="m19.4 15 .1.1 1.2 1-1.4 2.4-1.5-.6a8 8 0 0 1-1.6.9l-.3 1.6h-2.8l-.3-1.6a8 8 0 0 1-1.6-.9l-1.5.6-1.4-2.4 1.2-1a7 7 0 0 1 0-1.9l-1.2-1 1.4-2.4 1.5.6a8 8 0 0 1 1.6-.9l.3-1.6h2.8l.3 1.6a8 8 0 0 1 1.6.9l1.5-.6 1.4 2.4-1.2 1a7 7 0 0 1-.1 1.9Z" transform="translate(-1 -1)" /></>,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3" /></>,
  folder: <><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6m-6 4h6" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  close: <><path d="m18 6-12 12M6 6l12 12" /></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22Z" /><path d="M4 5v17m4-14h8m-8 4h8" /></>,
  code: <><path d="m8 8-4 4 4 4m8-8 4 4-4 4m-2-11-4 14" /></>,
};

export type HubIconName = keyof typeof paths;

export function HubIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: HubIconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {paths[name]}
    </svg>
  );
}
