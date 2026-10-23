import type { Metadata } from "next";
import WorkspaceAccess from "./workspace-access";

export const metadata: Metadata = {
  title: "Workspace access | Techiesee",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function WorkspaceAccessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <WorkspaceAccess slug={slug} />;
}
