interface RoomWireframeProps {
  className?: string;
  /** When true the SVG is hidden from assistive tech (purely decorative use). */
  decorative?: boolean;
}

/*
  Thin-line isometric room schematic, drawn in 1px strokes (currentColor) with no
  fills or gradients. This is a Pravah-style technical wireframe, the brand's
  substitute for decorative imagery. Parent sets the colour via text-* utilities.
*/
export default function RoomWireframe({
  className = "",
  decorative = false,
}: RoomWireframeProps) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1,
    strokeLinejoin: "round" as const,
    vectorEffect: "non-scaling-stroke" as const,
  };

  return (
    <svg
      viewBox="0 0 520 400"
      className={className}
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": "Schematische Darstellung eines begehbaren Raums" })}
    >
      {/* floor */}
      <path d="M50 250 L260 360 L470 250 L260 140 Z" {...stroke} />
      {/* left wall */}
      <path d="M50 250 L50 130 L260 20 L260 140 Z" {...stroke} />
      {/* right wall */}
      <path d="M260 140 L260 20 L470 130 L470 250 Z" {...stroke} />

      {/* doorway on the left wall */}
      <path d="M102 222 L155 195 L155 105 L102 132 Z" {...stroke} />
      <path d="M128 208 L128 118" {...stroke} />

      {/* window with mullions on the right wall */}
      <path d="M354 69 L428 108 L428 178 L354 139 Z" {...stroke} />
      <path d="M391 88 L391 158" {...stroke} />
      <path d="M354 104 L428 143" {...stroke} />

      {/* walkable path across the floor */}
      <path
        d="M232 322 L300 250 L250 178"
        {...stroke}
        strokeDasharray="2 7"
        strokeLinecap="round"
      />

      {/* pointillist corner nodes */}
      {[
        [50, 250],
        [260, 360],
        [470, 250],
        [260, 140],
        [50, 130],
        [260, 20],
        [470, 130],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2.5} fill="currentColor" />
      ))}
    </svg>
  );
}
