import { ImageResponse } from "next/og";

// Social share card shown when stepinside.eu is linked (WhatsApp, LinkedIn,
// iMessage, …). Mirrors the hero: white wordmark on the brand-dark canvas.
export const alt = "StepInside — Räume begehbar machen. Von überall.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#070707",
          backgroundImage:
            "radial-gradient(58% 58% at 50% 36%, rgba(183,89,40,0.18), rgba(7,7,7,0) 70%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand lockup: diamond + wordmark, as in the nav. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 52,
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              backgroundColor: "#ffffff",
              transform: "rotate(45deg)",
            }}
          />
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: "0.01em" }}>
            StepInside
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontSize: 78,
              fontWeight: 600,
              lineHeight: 1.04,
              letterSpacing: "-0.02em",
            }}
          >
            Räume begehbar machen.
          </div>
          <div
            style={{
              fontSize: 78,
              fontWeight: 600,
              lineHeight: 1.04,
              letterSpacing: "-0.02em",
            }}
          >
            Von überall.
          </div>
        </div>

        {/* Subline */}
        <div style={{ fontSize: 28, color: "#9a9a9a", marginTop: 38 }}>
          Fotorealistische, frei begehbare 3D-Touren
        </div>
      </div>
    ),
    { ...size },
  );
}
