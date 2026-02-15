export default function handler(_req, res) {
  res.json({
    ok: true,
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-6',
    thinkingBudget: Number(process.env.ANTHROPIC_THINKING_BUDGET || 2000),
  })
}
