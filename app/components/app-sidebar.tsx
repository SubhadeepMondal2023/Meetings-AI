'use client'
import { Home, Layers3, Settings, Bot, GitFork } from "lucide-react"
import { usePathname } from "next/navigation";
import { 
    Sidebar, 
    SidebarContent, 
    SidebarGroup, 
    SidebarGroupContent, 
    SidebarHeader, 
    SidebarMenu, 
    SidebarMenuButton, 
    SidebarMenuItem, 
    SidebarSeparator
} from "@/components/ui/sidebar";
import Link from "next/link";

const items = [
    { title: "Home", url: "/home", icon: Home },
    { title: "Graph", url: "/graph", icon: GitFork },
    { title: "Integrations", url: "/integrations", icon: Layers3 },
    { title: "Settings", url: "/settings", icon: Settings },
    { title: "Chat with AI", url: "/chat", icon: Bot },
]

export function AppSidebar() {
    const pathname = usePathname()

    return (
        <Sidebar collapsible="none" className="border-r border-sidebar-border h-screen bg-card">
            {/* HEADER: App Brand */}
            <SidebarHeader className="p-4 pb-2">
                <div className="flex flex-col gap-4">
                    {/* App Brand */}
                    <div className="flex items-center gap-2 px-1">
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 text-white">
                            <Bot className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-semibold">Meetings AI</span>
                    </div>
                </div>
            </SidebarHeader>

            <SidebarSeparator className="mx-4 my-2" />

            {/* NAVIGATION MENU */}
            <SidebarContent className="flex-1 px-3">
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu className="space-y-1">
                            {items.map((item) => {
                                const isActive = pathname === item.url
                                return (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton
                                            asChild
                                            isActive={isActive}
                                            className={`w-full justify-start gap-3 rounded-lg px-3 py-2 text-sm transition-all 
                                            ${isActive 
                                                ? "bg-blue-50 text-blue-600 font-semibold dark:bg-blue-900/20 dark:text-blue-400" 
                                                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                                            }`}
                                        >
                                            <Link href={item.url}>
                                                <item.icon className={`w-4 h-4 ${isActive ? "text-blue-500" : "text-muted-foreground"}`} />
                                                <span>{item.title}</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                )
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>

            

                {/* User Profile Row (Optional, if not in top navbar) */}
                {/* <div className="mt-4 flex items-center gap-3 px-1">
                    <UserButton />
                    <div className="flex flex-col text-xs">
                        <span className="font-medium text-foreground">{user?.fullName}</span>
                        <span className="text-muted-foreground truncate w-32">{user?.primaryEmailAddress?.emailAddress}</span>
                    </div>
                </div> */}
        </Sidebar>
    )
}