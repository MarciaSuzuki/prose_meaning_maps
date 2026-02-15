import { deleteSavedMap, getSavedMaps, upsertSavedMap } from '../server/store.js'

const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method === 'GET') {
    const maps = await getSavedMaps()
    return res.json({ maps })
  }

  if (req.method === 'POST') {
    const { entry } = req.body || {}
    if (!entry || !entry.passageRef) {
      return res.status(400).json({ error: 'entry with passageRef is required.' })
    }
    const normalized = {
      id: entry.id || `map-${Date.now()}`,
      passageRef: entry.passageRef,
      builderOutput: entry.builderOutput || '',
      reviewerOutput: entry.reviewerOutput || '',
      createdAt: entry.createdAt || new Date().toISOString(),
    }
    const maps = await upsertSavedMap(normalized)
    return res.json({ maps })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    if (!id) {
      return res.status(400).json({ error: 'id is required.' })
    }
    const maps = await deleteSavedMap(id)
    return res.json({ maps })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
