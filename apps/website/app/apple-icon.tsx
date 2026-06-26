import { ImageResponse } from "next/og";

// Apple touch icon (iOS home screen): same brand diamond, larger, with a bit
// more padding so it reads well inside iOS's rounded-square mask.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
            width: 78,
            height: 78,
            backgroundColor: "#ffffff",
            transform: "rotate(45deg)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
