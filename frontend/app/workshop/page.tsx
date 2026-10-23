import type { Metadata } from "next";
import { getPublicSiteUrl } from "../../lib/site-url";
import SalesLanding from "./sales-landing";

const siteUrl = getPublicSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl ?? "http://localhost:3000"),
  title: "Business AI Workshop | Techiesee",
  description: "A practical AI business management workspace for Indian small businesses. Organize leads, customer conversations, appointments, and automations in one place. Plans from ₹99.",
  keywords: [
    "AI business management",
    "business management workshop India",
    "small business CRM India",
    "lead management software",
    "customer conversation management",
    "AI tools for small business",
    "appointment management for business",
    "Techiesee",
  ],
  alternates: siteUrl ? { canonical: `${siteUrl}/workshop` } : undefined,
  openGraph: {
    title: "A calmer way to run your business | Techiesee",
    description: "Manage leads, conversations, appointments, and AI workflows in one business workspace. Explore workshop plans from ₹99.",
    type: "website",
    locale: "en_IN",
    siteName: "Techiesee",
    url: siteUrl ? `${siteUrl}/workshop` : undefined,
    ...(siteUrl ? { images: [{ url: "/workshop/opengraph-image", width: 1200, height: 630, alt: "Techiesee — one calm workspace for your business" }] } : {}),
  },
  twitter: {
    card: "summary_large_image",
    title: "A calmer way to run your business | Techiesee",
    description: "Manage leads, customer conversations, appointments, and AI workflows in one business workspace.",
    ...(siteUrl ? { images: ["/workshop/opengraph-image"] } : {}),
  },
  robots: { index: true, follow: true },
};

export default function WorkshopPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        ...(siteUrl ? { "@id": `${siteUrl}/#organization`, url: siteUrl } : {}),
        name: "Techiesee",
      },
      {
        "@type": "SoftwareApplication",
        name: "Techiesee Business Workspace",
        ...(siteUrl ? { url: `${siteUrl}/workshop`, provider: { "@id": `${siteUrl}/#organization` } } : {}),
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: "A business workspace for managing leads, customer conversations, contacts, appointments, AI agents, and automations.",
        offers: [
          { "@type": "Offer", name: "1 month access", price: "99", priceCurrency: "INR", category: "Manual access request" },
          { "@type": "Offer", name: "6 months access", price: "199", priceCurrency: "INR", category: "Manual access request" },
          { "@type": "Offer", name: "7 months access", price: "299", priceCurrency: "INR", category: "Manual access request" },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "How do I get access to the business workshop?",
            acceptedAnswer: { "@type": "Answer", text: "Choose a plan and send an access request. Techiesee will contact you to arrange payment and manually activate your business workspace." },
          },
          {
            "@type": "Question",
            name: "Does the plan request take payment online?",
            acceptedAnswer: { "@type": "Answer", text: "No. The website sends an access request only. Payment is arranged directly after the team contacts you." },
          },
          {
            "@type": "Question",
            name: "What can I manage in the business workspace?",
            acceptedAnswer: { "@type": "Answer", text: "The workspace brings together business leads, customer conversations, contacts, appointments, AI agents, and automations." },
          },
        ],
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <SalesLanding />
    </>
  );
}
