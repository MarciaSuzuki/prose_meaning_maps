import Anthropic from '@anthropic-ai/sdk'

const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
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

  const defaultModel = process.env.ANTHROPIC_MODEL || 'claude-opus-4-6'
  const defaultBudget = Number(process.env.ANTHROPIC_THINKING_BUDGET || 2000)
  const defaultMaxTokens = Number(process.env.ANTHROPIC_MAX_TOKENS || 4096)

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

  if (typeof temperature === 'number') {
    payload.temperature = temperature
  }

  if (thinking && thinking.enabled) {
    payload.thinking = {
      type: 'enabled',
      budget_tokens: resolvedBudget,
    }
  }

  try {
    const anthropic = new Anthropic({ apiKey })
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
    return res.status(error.status || 500).json({
      error: error.message || 'Failed to call Anthropic API',
    })
  }
}
