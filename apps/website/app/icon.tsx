import { ImageResponse } from "next/og";

// Brand favicon: the StepInside diamond (a rotated square) in white on the
// brand-dark canvas — matching the mark used in the nav, hero and intro.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#070707",
        }}
      >
        <div
          style={{
            width: 15,
            height: 15,
            backgroundColor: "#ffffff",
            transform: "rotate(45deg)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
