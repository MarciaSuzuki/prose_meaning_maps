import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import { deleteSavedMap, getSavedMaps, upsertSavedMap } from './store.js'

dotenv.config()

const app = express()
const port = process.env.PORT || 8787

app.use(cors())
app.use(express.json({ limit: '2mb' }))

const apiKey = process.env.ANTHROPIC_API_KEY
const defaultModel = process.env.ANTHROPIC_MODEL || 'claude-opus-4-6'
const defaultBudget = Number(process.env.ANTHROPIC_THINKING_BUDGET || 2000)
const defaultMaxTokens = Number(process.env.ANTHROPIC_MAX_TOKENS || 4096)

if (!apiKey) {
  console.warn('ANTHROPIC_API_KEY is not set. API calls will fail until it is configured.')
}

const anthropic = apiKey ? new Anthropic({ apiKey }) : null

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    model: defaultModel,
    thinkingBudget: defaultBudget,
  })
})

app.post('/api/agent', async (req, res) => {
  try {
    if (!anthropic) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server.' })
    }

    const {
      systemPrompt,
      userPrompt,
      model,
      maxTokens,
      temperature,
      thinking,
    } = req.body || {}

    if (!systemPrompt || !userPrompt) {
      return res.status(400).json({ error: 'systemPrompt and userPrompt are required.' })
    }

    const resolvedModel = model || defaultModel
    const resolvedMaxTokens = Number(maxTokens || defaultMaxTokens)
    const requestedBudget = Number(thinking?.budgetTokens || defaultBudget)
    const resolvedBudget = Number.isFinite(requestedBudget) ? requestedBudget : defaultBudget

    const payload = {
      model: resolvedModel,
      max_tokens: Math.max(resolvedMaxTokens, resolvedBudget + 128),
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }

    if (thinking && thinking.enabled) {
      payload.thinking = {
        type: 'enabled',
        budget_tokens: resolvedBudget,
      }
      payload.temperature = 1
    } else if (typeof temperature === 'number') {
      payload.temperature = temperature
    }

    const message = await anthropic.messages.create(payload)

    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')

    return res.json({
      output: text,
      usage: message.usage,
      model: message.model || resolvedModel,
    })
  } catch (error) {
    console.error('Anthropic API error:', error)
    const status = error.status || 500
    return res.status(status).json({
      error: error.message || 'Failed to call Anthropic API',
    })
  }
})

app.get('/api/maps', async (_req, res) => {
  const maps = await getSavedMaps()
  res.json({ maps })
})

app.post('/api/maps', async (req, res) => {
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
})

app.delete('/api/maps', async (req, res) => {
  const { id } = req.body || {}
  if (!id) {
    return res.status(400).json({ error: 'id is required.' })
  }
  const maps = await deleteSavedMap(id)
  return res.json({ maps })
})

app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`)
})
