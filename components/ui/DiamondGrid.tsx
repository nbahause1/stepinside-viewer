interface DiamondGridProps {
  /** Grid is n x n diamonds. */
  n?: number;
  className?: string;
}

/*
  The diamond/rhombus marker (from the earlier Pravah cards): an n x n grid of
  small rotated squares. Uses currentColor, so the parent sets the colour.
  Purely decorative.
*/
export default function DiamondGrid({ n = 3, className = "" }: DiamondGridProps) {
  const cells = Array.from({ length: n * n });
  return (
    <div
      aria-hidden="true"
      className={`grid w-max gap-[3px] text-current ${className}`}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
    >
      {cells.map((_, i) => (
        <span key={i} className="block size-[5px] rotate-45 bg-current" />
      ))}
    </div>
  );
}
