'use client'

import { Bot, DollarSign, Home, Layers3, Settings, Sparkles, User } from "lucide-react";
import { usePathname } from "next/navigation";
import { useUsage } from "../contexts/UsageContext";
import { 
    Sidebar, 
    SidebarContent, 
    SidebarFooter, 
    SidebarGroup, 
    SidebarGroupContent, 
    SidebarHeader, 
    SidebarMenu, 
    SidebarMenuButton, 
    SidebarMenuItem, 
    SidebarSeparator
} from "@/components/ui/sidebar";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const items = [
    { title: "Home", url: "/home", icon: Home },
    { title: "Integrations", url: "/integrations", icon: Layers3 },
    { title: "Settings", url: "/settings", icon: Settings },
    { title: "Chat with AI", url: "/chat", icon: Bot },
    { title: "Pricing", url: "/pricing", icon: DollarSign },
]

export function AppSidebar() {
    const pathname = usePathname()
    const { usage, limits } = useUsage()

    // Calculate Usage Percentages
    const meetingProgress = usage && limits.meetings !== -1
        ? Math.min((usage.meetingsThisMonth / limits.meetings) * 100, 100)
        : 0

    const chatProgress = usage && limits.chatMessages !== -1
        ? Math.min((usage.chatMessagesToday / limits.chatMessages) * 100, 100)
        : 0

    // Dynamic Upgrade Banner
    const getUpgradeInfo = () => {
        if (!usage) return null
        switch (usage.currentPlan) {
            case 'free': return { title: "Upgrade to Starter", description: "Get 10 meetings/mo", showButton: true }
            case 'starter': return { title: "Upgrade to Pro", description: "Get 30 meetings/mo", showButton: true }
            case 'pro': return { title: "Upgrade to Premium", description: "Unlock unlimited access", showButton: true }
            case 'premium': return { title: "Premium Plan", description: "You have unlimited access", showButton: false }
            default: return null
        }
    }
    const upgradeInfo = getUpgradeInfo()

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
                        <span className="text-sm font-semibold">MeetingBot AI</span>
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

            {/* FOOTER: Usage Stats & Upgrade */}
            <SidebarFooter className="p-4 border-t border-sidebar-border">
                {usage && (
                    <div className="rounded-xl bg-sidebar-accent/40 p-4 border border-sidebar-border/50">
                        
                        {/* Plan Badge */}
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                                <span className="text-xs font-bold text-foreground tracking-wide">
                                    {usage.currentPlan.toUpperCase()}
                                </span>
                            </div>
                            <Link href="/settings" className="text-[10px] text-muted-foreground hover:text-primary underline">
                                Manage
                            </Link>
                        </div>

                        {/* Meetings Usage */}
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <div className="flex justify-between text-[10px] font-medium text-muted-foreground">
                                    <span>Meetings</span>
                                    <span>{usage.meetingsThisMonth} / {limits.meetings === -1 ? '∞' : limits.meetings}</span>
                                </div>
                                {limits.meetings !== -1 && (
                                    <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
                                        <div 
                                            className="bg-blue-500 h-full rounded-full transition-all duration-500" 
                                            style={{ width: `${meetingProgress}%` }}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Chat Usage */}
                            <div className="space-y-1">
                                <div className="flex justify-between text-[10px] font-medium text-muted-foreground">
                                    <span>AI Chat</span>
                                    <span>{usage.chatMessagesToday} / {limits.chatMessages === -1 ? '∞' : limits.chatMessages}</span>
                                </div>
                                {limits.chatMessages !== -1 && (
                                    <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
                                        <div 
                                            className="bg-purple-500 h-full rounded-full transition-all duration-500" 
                                            style={{ width: `${chatProgress}%` }}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Upgrade Button */}
                        {upgradeInfo && upgradeInfo.showButton && (
                            <Link href="/pricing" className="block mt-4">
                                <Button className="w-full h-8 text-xs bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-sm border-0">
                                    {upgradeInfo.title}
                                </Button>
                            </Link>
                        )}
                    </div>
                )}

                {/* User Profile Row (Optional, if not in top navbar) */}
                {/* <div className="mt-4 flex items-center gap-3 px-1">
                    <UserButton />
                    <div className="flex flex-col text-xs">
                        <span className="font-medium text-foreground">{user?.fullName}</span>
                        <span className="text-muted-foreground truncate w-32">{user?.primaryEmailAddress?.emailAddress}</span>
                    </div>
                </div> */}
            </SidebarFooter>
        </Sidebar>
    )
}