/** A filled box with a cutout check distinguishes the active repository in every theme. */
export function RepositoryIcon({current}:{current:boolean}) {
  return <svg className="repository-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {current
      ? <path fill="currentColor" fillRule="evenodd" d="M4 1h16l3 6v15H1V7l3-6Zm1.5 2L4 6h16l-1.5-3h-13Zm12.4 7.1-7 7-3-3-1.8 1.8 4.8 4.8 8.8-8.8-1.8-1.8Z"/>
      : <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" d="M4 1h16l3 6v15H1V7l3-6ZM1 7h22M8 12h8"/>}
  </svg>;
}
