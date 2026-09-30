import { PortalOrder } from "./PortalOrder";

export default async function PortalOrderPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  return <PortalOrder locale={locale} id={id} />;
}
