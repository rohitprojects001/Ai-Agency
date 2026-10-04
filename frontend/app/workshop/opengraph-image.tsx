import { ImageResponse } from "next/og";

export const alt = "Rohit AI Studio — a calmer way to run your business";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "58px 68px",
          background: "linear-gradient(135deg, #101713 0%, #1c2921 65%, #273322 100%)",
          color: "#fbfcf7",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 15, fontSize: 23, fontWeight: 700, letterSpacing: 2 }}>
          <div style={{ display: "flex", width: 32, height: 32, flexWrap: "wrap", gap: 4 }}>
            {["#d1f36b", "#a8ca55", "#78933f", "#c1e463"].map((color) => (
              <div key={color} style={{ width: 14, height: 14, borderRadius: 3, background: color }} />
            ))}
          </div>
          ROHIT AI <span style={{ color: "#d1f36b" }}>STUDIO</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 900 }}>
          <div style={{ color: "#bdc9b9", fontSize: 18, letterSpacing: 4 }}>YOUR BUSINESS, IN MOTION</div>
          <div style={{ marginTop: 18, fontFamily: "Georgia, serif", fontSize: 75, lineHeight: 1.04, letterSpacing: -2 }}>
            Run your business.
          </div>
          <div style={{ color: "#d1f36b", fontFamily: "Georgia, serif", fontSize: 75, fontStyle: "italic", lineHeight: 1.04, letterSpacing: -2 }}>
            Not after it.
          </div>
          <div style={{ marginTop: 24, color: "#bdc9b9", fontSize: 21 }}>
            Leads, conversations, appointments & AI — together.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #ffffff30", paddingTop: 18, color: "#d1f36b", fontSize: 16, letterSpacing: 2 }}>
          <span>BUSINESS AI WORKSHOP</span>
          <span>PLANS FROM ₹99 ↗</span>
        </div>
      </div>
    ),
    size,
  );
}
