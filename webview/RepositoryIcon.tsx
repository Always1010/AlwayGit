/** A filled box with a cutout check distinguishes the active repository in every theme. */
export function RepositoryIcon({current}:{current:boolean}) {
  return <svg className="repository-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {current
      ? <path fill="currentColor" fillRule="evenodd" d="M4 1h16l3 6v15H1V7l3-6Zm1.5 2L4 6h16l-1.5-3h-13Zm12.4 7.1-7 7-3-3-1.8 1.8 4.8 4.8 8.8-8.8-1.8-1.8Z"/>
      : <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" d="M4 1h16l3 6v15H1V7l3-6ZM1 7h22M8 12h8"/>}
  </svg>;
}

function CollectionBox({transform}:{transform:string}) {
  return <g transform={transform}>
    <path className="repository-box-top" d="M8.5 0 17 4.5 8.5 9 0 4.5Z"/>
    <path fill="currentColor" d="m0 4.5 8.5 4.5v10L0 14.5Z"/>
    <path className="repository-box-side" d="M8.5 9 17 4.5v10L8.5 19Z"/>
    <path className="repository-box-edge" d="m0 4.5 8.5 4.5L17 4.5M8.5 9v10"/>
    <path className="repository-box-handle" d="m2.3 9.5 3.8 2"/>
    <path className="repository-box-rim" d="M8.5 0 17 4.5v10L8.5 19 0 14.5v-10Z"/>
  </g>;
}

/** One neutral group icon: a box behind two overlapping boxes in a compact triangle. */
export function RepositoryCollectionIcon() {
  return <svg className="repository-icon repository-collection-icon" width="18" height="18" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
    <CollectionBox transform="translate(9.5 1) scale(1.13 1.03)"/>
    <CollectionBox transform="translate(1 11) scale(1.13 1.03)"/>
    <CollectionBox transform="translate(15.5 14.5) scale(1.13 1.03)"/>
  </svg>;
}
