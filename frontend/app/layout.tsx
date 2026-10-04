import "./globals.css";
import { getPublicSiteUrl } from "../lib/site-url";

const siteUrl = getPublicSiteUrl();

export const metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  metadataBase: new URL(siteUrl ?? "http://localhost:3000"),
  title: "Rohit AI Studio | Business, in motion",
  description: "A thoughtful command center for your leads, conversations, appointments, and AI-powered customer care.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}