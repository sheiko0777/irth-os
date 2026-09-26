import { PortalHome } from "./PortalHome";

export default async function PortalPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <PortalHome locale={locale} />;
}
