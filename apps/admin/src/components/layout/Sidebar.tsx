"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LayoutDashboard, ShoppingCart, Package, LogOut } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { signOut, useSession } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"

export function Sidebar({ locale }: { locale: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const t = useTranslations("nav")
  const tAuth = useTranslations("auth")

  const { data: session } = useSession()

  const links = [
    { href: `/${locale}/dashboard`, label: t("dashboard"), icon: LayoutDashboard },
    { href: `/${locale}/orders`, label: t("orders"), icon: ShoppingCart },
    { href: `/${locale}/products`, label: t("products"), icon: Package },
  ]

  const handleLogout = async () => {
    await signOut()
    router.push(`/${locale}/login`)
    router.refresh()
  }

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
      
      <div className="border-t p-4 space-y-4">
        {session?.user?.email && (
          <div className="text-sm text-gray-500 truncate px-2" dir="ltr">
            {session.user.email}
          </div>
        )}
        <Button 
          variant="outline" 
          className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50" 
          onClick={handleLogout}
        >
          <LogOut className="mr-2 h-4 w-4" />
          {tAuth("logout")}
        </Button>
      </div>
    </div>
  )
}
