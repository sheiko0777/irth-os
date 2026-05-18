"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, ShoppingCart, Package } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

export function Sidebar({ locale }: { locale: string }) {
  const pathname = usePathname()
  const t = useTranslations("nav")

  const links = [
    { href: `/${locale}/dashboard`, label: t("dashboard"), icon: LayoutDashboard },
    { href: `/${locale}/orders`, label: t("orders"), icon: ShoppingCart },
    { href: `/${locale}/products`, label: t("products"), icon: Package },
  ]

  return (
    <div className="flex h-screen w-64 flex-col border-e bg-white">
      <div className="flex h-14 items-center border-b px-4">
        <span className="font-bold text-lg">IRTH OS Admin</span>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {links.map((link) => {
          const isActive = pathname.startsWith(link.href)
          const Icon = link.icon
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-gray-100 text-gray-900" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <Icon className="h-4 w-4" />
              {link.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
