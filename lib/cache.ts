import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();
export async function getCachedResponse(prompt: string, userId: string) {
    try {
        const sanitizedPrompt = prompt.trim().toLowerCase();
        const key = `cache:${userId}:${Buffer.from(sanitizedPrompt).toString('base64')}`;

        const cached = await redis.get(key);
        return cached as string | null;
    } catch (error) {
        console.error("Cache Read Failed", error);
        return null;
    }
}

export async function setCachedResponse(prompt: string, response: string, userId: string) {
    try {
        const sanitizedPrompt = prompt.trim().toLowerCase();
        const key = `cache:${userId}:${Buffer.from(sanitizedPrompt).toString('base64')}`;

        // Save for 1 hour (3600 seconds) to keep data fresh but fast
        await redis.set(key, response, { ex: 3600 });
    } catch (error) {
        console.error("Cache Set Failed", error);
    }
}