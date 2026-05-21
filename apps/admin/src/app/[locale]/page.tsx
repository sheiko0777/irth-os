import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

export default function HomePage() {
  const t = useTranslations("Index");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">{t("title")}</h1>
      <Link href="/login" className="text-blue-500 hover:underline">
        Login
      </Link>
    </div>
  );
}
