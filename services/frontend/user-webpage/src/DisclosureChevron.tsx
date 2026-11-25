/** One chevron for every disclosure: it points right when collapsed and down when expanded. */
export function DisclosureChevron({ expanded, size = 12 }: { expanded: boolean; size?: number }) {
  return (
    <svg
      className="ui-disclosure-chevron"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      data-expanded={expanded}
    >
      <path
        d="m6 3 5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
