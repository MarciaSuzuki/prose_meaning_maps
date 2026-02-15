import { Redis } from '@upstash/redis'

const STORE_KEY = 'ruth:savedMaps'

const memoryStore = globalThis.__RUTH_MM_STORE__ || { maps: [] }
if (!globalThis.__RUTH_MM_STORE__) {
  globalThis.__RUTH_MM_STORE__ = memoryStore
}

const parseRef = (ref) => {
  const match = /Ruth\s+(\d+):(\d+)(?:-(\d+))?/.exec(ref || '')
  if (!match) return { chapter: 0, start: 0 }
  return { chapter: Number(match[1]), start: Number(match[2]) }
}

const sortMaps = (maps) =>
  maps.sort((a, b) => {
    const pa = parseRef(a.passageRef)
    const pb = parseRef(b.passageRef)
    if (pa.chapter !== pb.chapter) return pa.chapter - pb.chapter
    return pa.start - pb.start
  })

const hasRedis = () => Boolean(process.env.UPSTASH_REDIS_REST_URL)
const redis = hasRedis() ? Redis.fromEnv() : null

export const getSavedMaps = async () => {
  if (redis) {
    const maps = await redis.get(STORE_KEY)
    return Array.isArray(maps) ? maps : []
  }
  return memoryStore.maps
}

export const upsertSavedMap = async (entry) => {
  const maps = await getSavedMaps()
  const filtered = maps.filter((item) => item.passageRef !== entry.passageRef)
  const next = sortMaps([...filtered, entry])
  if (redis) {
    await redis.set(STORE_KEY, next)
  } else {
    memoryStore.maps = next
  }
  return next
}

export const deleteSavedMap = async (id) => {
  const maps = await getSavedMaps()
  const next = maps.filter((item) => item.id !== id)
  if (redis) {
    await redis.set(STORE_KEY, next)
  } else {
    memoryStore.maps = next
  }
  return next
}
