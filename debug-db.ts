const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log("🔍 INSPECTING LATEST 5 MEETINGS...")

  const meetings = await prisma.meeting.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  })

  if (meetings.length === 0) {
      console.log("❌ No meetings found in database.")
  }

  // FIXED: Added ': any' to satisfy TypeScript
  meetings.forEach((m: any) => {
    console.log("\n------------------------------------------------")
    console.log(`📌 Meeting Title: "${m.title}"`)
    console.log(`   ID: ${m.id}`)
    console.log(`   Bot ID (Saved in DB): ${m.botId ? m.botId : "❌ MISSING (Lambda didn't save it)"}`)
    console.log(`   Meeting Ended? ${m.meetingEnded ? "✅ YES" : "❌ NO (Webhook didn't process it)"}`)
    console.log(`   Created By User ID: ${m.createdById}`)
  })
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect())