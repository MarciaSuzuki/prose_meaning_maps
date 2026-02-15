import { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import bhsa from './data/ruth_bhsa.json'
import { AGENT_1_PROMPT } from './prompts/agent1'
import { AGENT_2_PROMPT } from './prompts/agent2'
import './App.css'

const numberSort = (a, b) => Number(a) - Number(b)
const chapterNumbers = Object.keys(bhsa.chapters).sort(numberSort)
const totalVerseCount = chapterNumbers.reduce(
  (sum, ch) => sum + Object.keys(bhsa.chapters[ch].verses).length,
  0
)

const makeId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

const normalizeBaseUrl = (url) => url.replace(/\/$/, '')

const formatMorph = (word) => {
  const parts = [word.sp, word.vt, word.vs, word.ps, word.gn, word.nu].filter(Boolean)
  return parts.length ? parts.join(' ') : '—'
}

const formatPronoun = (word) => {
  if (!word.prs && !word.prs_ps && !word.prs_gn && !word.prs_nu) return '—'
  const parts = [word.prs, word.prs_ps, word.prs_gn, word.prs_nu].filter(Boolean)
  return parts.join(' ')
}

const renderMarkdown = (text) => DOMPurify.sanitize(marked.parse(text || ''))

const formatBhsaForPrompt = (verses) => {
  return verses
    .map((verse) => {
      const indexById = Object.fromEntries(verse.words.map((w) => [w.id, w.index]))
      const idsToIndexes = (ids) => ids.map((id) => indexById[id] ?? id).join(',')
      const words = verse.words
        .map((w) => {
          const morph = formatMorph(w)
          return `${w.index}. ${w.translit} (${w.hebrew}) | cons:${w.consonants || '—'} | lex:${w.lexeme} | ${morph} | prs:${formatPronoun(w)} | gloss:${w.gloss || '—'}`
        })
        .join('\n')

      const clauses = verse.clauses
        .map((c, idx) => `Clause ${idx + 1}: typ=${c.typ || '—'} rela=${c.rela || '—'} wordIndexes=${idsToIndexes(c.wordIds)}`)
        .join('\n')

      const phrases = verse.phrases
        .map((p, idx) => `Phrase ${idx + 1}: function=${p.function || '—'} typ=${p.typ || '—'} wordIndexes=${idsToIndexes(p.wordIds)}`)
        .join('\n')

      return [
        `## ${verse.ref}`,
        'Words:',
        words,
        'Clauses:',
        clauses || '—',
        'Phrases:',
        phrases || '—',
      ].join('\n')
    })
    .join('\n\n')
}

const parseRef = (ref) => {
  const match = /Ruth\s+(\d+):(\d+)(?:-(\d+))?/.exec(ref || '')
  if (!match) return { chapter: 0, start: 0, end: 0 }
  return {
    chapter: Number(match[1]),
    start: Number(match[2]),
    end: Number(match[3] || match[2]),
  }
}

const DISCOURSE_SYSTEM_PROMPT = `${AGENT_1_PROMPT}

## Task Override — Discourse Level Only
You must output ONLY the Discourse Level map for the requested passage.
Do not output Scene Level or Utterance Level sections.
Use this format exactly:

**[Book Chapter:Verses] — Discourse Level**
[Discourse paragraph]

**Pacing profile:** [pacing description]

Return only this section.`

const SCENE_SYSTEM_PROMPT = `${AGENT_1_PROMPT}

## Task Override — Scene Level Only
You must output ONLY the Scene Level map(s) for the requested passage.
Do not output Discourse Level or Utterance Level sections.
Use this format exactly:

**[Book Chapter:Verses] — Scene Level**
[Scene descriptions]

Return only this section.`

const UTTERANCE_SYSTEM_PROMPT = `${AGENT_1_PROMPT}

## Task Override — Utterance Level Only
You must output ONLY Utterance Level maps, one per verse or clause cluster.
Do not output Discourse Level or Scene Level sections.
Use this format for each unit:

**[Book Chapter:Verse(s)] — Utterance Level**
[Description]

**MUST COMMUNICATE:** [compressed propositions…] That is all. [specific prohibitions]

Return only Utterance Level sections.`

function App() {
  const [chapter, setChapter] = useState(chapterNumbers[0])
  const verseNumbers = useMemo(
    () => Object.keys(bhsa.chapters[chapter].verses).sort(numberSort),
    [chapter]
  )
  const [startVerse, setStartVerse] = useState(verseNumbers[0])
  const [endVerse, setEndVerse] = useState(verseNumbers[0])
  const [apiBaseUrl, setApiBaseUrl] = useState(
    import.meta.env.VITE_API_BASE_URL ||
      (import.meta.env.PROD ? window.location.origin : 'http://localhost:8787')
  )
  const [apiModel, setApiModel] = useState('claude-opus-4-6')
  const [thinkingEnabled, setThinkingEnabled] = useState(true)
  const [thinkingBudget, setThinkingBudget] = useState(2000)
  const [maxTokens, setMaxTokens] = useState(4096)
  const [temperature, setTemperature] = useState(0.2)
  const [apiError, setApiError] = useState('')
  const [runningAgent, setRunningAgent] = useState('')
  const [savedMapsLoading, setSavedMapsLoading] = useState(false)
  const effectiveTemperature = thinkingEnabled ? 1 : Number(temperature)

  const [showDiscoursePreview, setShowDiscoursePreview] = useState(true)
  const [showScenePreview, setShowScenePreview] = useState(true)
  const [showUtterancePreview, setShowUtterancePreview] = useState(true)
  const [showReviewerPreview, setShowReviewerPreview] = useState(true)

  useEffect(() => {
    setStartVerse(verseNumbers[0])
    setEndVerse(verseNumbers[0])
  }, [chapter])

  useEffect(() => {
    if (Number(startVerse) > Number(endVerse)) {
      setEndVerse(startVerse)
    }
  }, [startVerse, endVerse])

  const passageRef = `Ruth ${chapter}:${startVerse}${startVerse === endVerse ? '' : `-${endVerse}`}`

  const selectedVerses = useMemo(() => {
    const start = Number(startVerse)
    const end = Number(endVerse)
    return verseNumbers
      .filter((v) => {
        const num = Number(v)
        return num >= start && num <= end
      })
      .map((v) => bhsa.chapters[chapter].verses[v])
  }, [chapter, startVerse, endVerse, verseNumbers])

  const requiredVerseRefs = useMemo(() => selectedVerses.map((verse) => verse.ref), [selectedVerses])

  const [draftsByPassage, setDraftsByPassage] = useState(() => {
    const raw = localStorage.getItem('ruth_drafts')
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    const normalizeDraft = (draft) => {
      if (
        Object.prototype.hasOwnProperty.call(draft, 'discourseOutput') ||
        Object.prototype.hasOwnProperty.call(draft, 'sceneOutput') ||
        Object.prototype.hasOwnProperty.call(draft, 'utteranceOutput')
      ) {
        return {
          id: draft.id || makeId(),
          discourseOutput: draft.discourseOutput || '',
          discourseFeedback: draft.discourseFeedback || '',
          sceneOutput: draft.sceneOutput || '',
          sceneFeedback: draft.sceneFeedback || '',
          utteranceOutput: draft.utteranceOutput || '',
          utteranceFeedback: draft.utteranceFeedback || '',
          reviewerOutput: draft.reviewerOutput || '',
          createdAt: draft.createdAt || new Date().toISOString(),
        }
      }
      if (draft.output) {
        return {
          id: draft.id || makeId(),
          discourseOutput: '',
          discourseFeedback: '',
          sceneOutput: '',
          sceneFeedback: '',
          utteranceOutput: draft.output || '',
          utteranceFeedback: draft.feedback || '',
          reviewerOutput: '',
          createdAt: draft.createdAt || new Date().toISOString(),
        }
      }
      return {
        id: draft.id || makeId(),
        discourseOutput: '',
        discourseFeedback: '',
        sceneOutput: '',
        sceneFeedback: '',
        utteranceOutput: '',
        utteranceFeedback: '',
        reviewerOutput: '',
        createdAt: draft.createdAt || new Date().toISOString(),
      }
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([key, list]) => [
        key,
        Array.isArray(list) ? list.map(normalizeDraft) : [],
      ])
    )
  })

  useEffect(() => {
    localStorage.setItem('ruth_drafts', JSON.stringify(draftsByPassage))
  }, [draftsByPassage])

  const drafts = draftsByPassage[passageRef] ?? []
  const [activeDraftId, setActiveDraftId] = useState(drafts.at(-1)?.id ?? null)

  useEffect(() => {
    if (!drafts.find((d) => d.id === activeDraftId)) {
      setActiveDraftId(drafts.at(-1)?.id ?? null)
    }
  }, [passageRef, drafts, activeDraftId])

  const activeDraft = drafts.find((d) => d.id === activeDraftId) || null

  const [discourseOutput, setDiscourseOutput] = useState('')
  const [sceneOutput, setSceneOutput] = useState('')
  const [utteranceOutput, setUtteranceOutput] = useState('')
  const [reviewerOutput, setReviewerOutput] = useState('')

  const [discourseFeedback, setDiscourseFeedback] = useState('')
  const [sceneFeedback, setSceneFeedback] = useState('')
  const [utteranceFeedback, setUtteranceFeedback] = useState('')

  useEffect(() => {
    if (activeDraft) {
      setDiscourseOutput(activeDraft.discourseOutput || '')
      setSceneOutput(activeDraft.sceneOutput || '')
      setUtteranceOutput(activeDraft.utteranceOutput || '')
      setReviewerOutput(activeDraft.reviewerOutput || '')
      setDiscourseFeedback(activeDraft.discourseFeedback || '')
      setSceneFeedback(activeDraft.sceneFeedback || '')
      setUtteranceFeedback(activeDraft.utteranceFeedback || '')
    } else {
      setDiscourseOutput('')
      setSceneOutput('')
      setUtteranceOutput('')
      setReviewerOutput('')
      setDiscourseFeedback('')
      setSceneFeedback('')
      setUtteranceFeedback('')
    }
  }, [activeDraftId, passageRef])

  const combinedOutput = [discourseOutput, sceneOutput, utteranceOutput]
    .map((section) => section.trim())
    .filter(Boolean)
    .join('\n\n')

  const missingUtteranceRefs = useMemo(() => {
    if (!utteranceOutput) return []
    return requiredVerseRefs.filter((ref) => {
      const safe = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return !new RegExp(safe, 'i').test(utteranceOutput)
    })
  }, [utteranceOutput, requiredVerseRefs])

  const discourseUserPrompt = useMemo(() => {
    const bhsaBlock = formatBhsaForPrompt(selectedVerses)
    return [
      `Passage: ${passageRef}`,
      'Task: Produce ONLY the Discourse Level map for this passage.',
      'Include a pacing profile.',
      'BHSA Data:',
      bhsaBlock,
      'Previous Draft:',
      discourseOutput.trim() || 'None',
      'Human Feedback:',
      discourseFeedback.trim() || 'None',
      'Return only the discourse-level section in the required format.',
    ].join('\n\n')
  }, [selectedVerses, passageRef, discourseOutput, discourseFeedback])

  const sceneUserPrompt = useMemo(() => {
    const bhsaBlock = formatBhsaForPrompt(selectedVerses)
    return [
      `Passage: ${passageRef}`,
      'Task: Produce ONLY the Scene Level map for this passage.',
      'Use the discourse-level output below to align pacing and structure.',
      'Discourse Level Output:',
      discourseOutput.trim() || 'None',
      'BHSA Data:',
      bhsaBlock,
      'Previous Draft:',
      sceneOutput.trim() || 'None',
      'Human Feedback:',
      sceneFeedback.trim() || 'None',
      'Return only the scene-level section in the required format.',
    ].join('\n\n')
  }, [selectedVerses, passageRef, discourseOutput, sceneOutput, sceneFeedback])

  const utteranceUserPrompt = useMemo(() => {
    const bhsaBlock = formatBhsaForPrompt(selectedVerses)
    return [
      `Passage: ${passageRef}`,
      'Task: Produce ONLY the Utterance Level map for each verse or clause cluster.',
      `Required utterance-level sections: ${requiredVerseRefs.join(', ') || 'None'}. Do not omit any verse.`,
      'Discourse Level Output:',
      discourseOutput.trim() || 'None',
      'Scene Level Output:',
      sceneOutput.trim() || 'None',
      'BHSA Data:',
      bhsaBlock,
      'Previous Draft:',
      utteranceOutput.trim() || 'None',
      'Human Feedback:',
      utteranceFeedback.trim() || 'None',
      'Return only utterance-level sections in the required format.',
    ].join('\n\n')
  }, [
    selectedVerses,
    passageRef,
    requiredVerseRefs,
    discourseOutput,
    sceneOutput,
    utteranceOutput,
    utteranceFeedback,
  ])

  const reviewerUserPrompt = useMemo(() => {
    return [
      `Passage: ${passageRef}`,
      'Meaning Map Draft (Discourse + Scene + Utterance):',
      combinedOutput || 'None',
      'Task: Produce the reviewer checklist for this passage and map.',
    ].join('\n\n')
  }, [passageRef, combinedOutput])

  const [savedMaps, setSavedMaps] = useState([])

  const refreshSavedMaps = async () => {
    setApiError('')
    setSavedMapsLoading(true)
    try {
      const response = await fetch(`${normalizeBaseUrl(apiBaseUrl)}/api/maps`)
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load shared maps.')
      }
      setSavedMaps(Array.isArray(payload.maps) ? payload.maps : [])
    } catch (error) {
      setApiError(error.message || 'Failed to load shared maps.')
    } finally {
      setSavedMapsLoading(false)
    }
  }

  useEffect(() => {
    refreshSavedMaps()
  }, [apiBaseUrl])

  const [copyStatus, setCopyStatus] = useState('')

  const handleCopy = async (label, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus(label)
      setTimeout(() => setCopyStatus(''), 1500)
    } catch (error) {
      console.error('Clipboard copy failed', error)
    }
  }

  const runAgent = async ({ label, systemPrompt, userPrompt, onOutput }) => {
    setApiError('')
    setRunningAgent(label)
    try {
      const response = await fetch(`${normalizeBaseUrl(apiBaseUrl)}/api/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt,
          userPrompt,
          model: apiModel,
          maxTokens: Number(maxTokens),
          temperature: effectiveTemperature,
          thinking: {
            enabled: thinkingEnabled,
            budgetTokens: Number(thinkingBudget),
          },
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'API request failed.')
      }
      onOutput(payload.output || '')
    } catch (error) {
      setApiError(error.message || 'Failed to call API.')
    } finally {
      setRunningAgent('')
    }
  }

  const handleSaveDraftSet = () => {
    if (!discourseOutput.trim() && !sceneOutput.trim() && !utteranceOutput.trim()) return
    const newDraft = {
      id: makeId(),
      discourseOutput: discourseOutput.trim(),
      discourseFeedback: discourseFeedback.trim(),
      sceneOutput: sceneOutput.trim(),
      sceneFeedback: sceneFeedback.trim(),
      utteranceOutput: utteranceOutput.trim(),
      utteranceFeedback: utteranceFeedback.trim(),
      reviewerOutput: reviewerOutput.trim(),
      createdAt: new Date().toISOString(),
    }
    setDraftsByPassage((prev) => ({
      ...prev,
      [passageRef]: [...(prev[passageRef] ?? []), newDraft],
    }))
    setActiveDraftId(newDraft.id)
  }

  const handleDeleteDraft = (draftId) => {
    setDraftsByPassage((prev) => {
      const next = (prev[passageRef] ?? []).filter((d) => d.id !== draftId)
      return { ...prev, [passageRef]: next }
    })
  }

  const handleApprove = async () => {
    if (!combinedOutput || !reviewerOutput.trim()) return
    const entry = {
      id: makeId(),
      passageRef,
      builderOutput: combinedOutput,
      reviewerOutput: reviewerOutput.trim(),
      createdAt: new Date().toISOString(),
    }
    try {
      const response = await fetch(`${normalizeBaseUrl(apiBaseUrl)}/api/maps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save shared map.')
      }
      setSavedMaps(Array.isArray(payload.maps) ? payload.maps : [])
    } catch (error) {
      setApiError(error.message || 'Failed to save shared map.')
      setSavedMaps((prev) => {
        const next = prev.filter((item) => item.passageRef !== passageRef)
        return [
          ...next,
          entry,
        ].sort((a, b) => {
          const pa = parseRef(a.passageRef)
          const pb = parseRef(b.passageRef)
          if (pa.chapter !== pb.chapter) return pa.chapter - pb.chapter
          return pa.start - pb.start
        })
      })
    }
  }

  const coveredVerses = useMemo(() => {
    const covered = new Set()
    savedMaps.forEach((entry) => {
      const { chapter: ch, start, end } = parseRef(entry.passageRef)
      for (let v = start; v <= end; v += 1) {
        covered.add(`${ch}:${v}`)
      }
    })
    return covered.size
  }, [savedMaps])

  const downloadFile = (filename, content, type) => {
    const blob = new Blob([content], { type })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(link.href)
  }

  const exportMarkdown = () => {
    const content = savedMaps
      .map((entry) => {
        return [
          `# ${entry.passageRef}`,
          '',
          '## Meaning Map',
          '',
          entry.builderOutput,
          '',
          '## Reviewer Checklist',
          '',
          entry.reviewerOutput,
          '',
        ].join('\n')
      })
      .join('\n')
    downloadFile('ruth-meaning-maps.md', content, 'text/markdown')
  }

  const exportJson = () => {
    downloadFile('ruth-meaning-maps.json', JSON.stringify(savedMaps, null, 2), 'application/json')
  }

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Tripod Method • Ruth Studio</p>
          <h1>Ruth Meaning Map Studio</h1>
          <p className="subtitle">
            Build, review, and store prose meaning maps for the book of Ruth using BHSA data.
          </p>
        </div>
        <div className="hero-meta">
          <div className="metric">
            <span className="metric-value">{coveredVerses}</span>
            <span className="metric-label">verses approved</span>
          </div>
          <div className="metric">
            <span className="metric-value">{totalVerseCount}</span>
            <span className="metric-label">total verses</span>
          </div>
          <div className="metric">
            <span className="metric-value">{drafts.length}</span>
            <span className="metric-label">draft sets</span>
          </div>
        </div>
      </header>

      <section className="control-bar">
        <div className="control-group">
          <label htmlFor="chapter">Chapter</label>
          <select id="chapter" value={chapter} onChange={(e) => setChapter(e.target.value)}>
            {chapterNumbers.map((ch) => (
              <option key={ch} value={ch}>
                {ch}
              </option>
            ))}
          </select>
        </div>
        <div className="control-group">
          <label htmlFor="start-verse">Start Verse</label>
          <select
            id="start-verse"
            value={startVerse}
            onChange={(e) => setStartVerse(e.target.value)}
          >
            {verseNumbers.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="control-group">
          <label htmlFor="end-verse">End Verse</label>
          <select id="end-verse" value={endVerse} onChange={(e) => setEndVerse(e.target.value)}>
            {verseNumbers.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="control-summary">
          <span>{passageRef}</span>
          <span>{selectedVerses.length} verse(s)</span>
        </div>
      </section>

      <section className="api-bar">
        <div className="api-field">
          <label htmlFor="api-base">API Base URL</label>
          <input
            id="api-base"
            type="text"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
          />
        </div>
        <div className="api-field">
          <label htmlFor="api-model">Model</label>
          <input
            id="api-model"
            type="text"
            value={apiModel}
            onChange={(e) => setApiModel(e.target.value)}
          />
        </div>
        <div className="api-field">
          <label htmlFor="thinking-toggle">Extended Thinking</label>
          <div className="toggle">
            <input
              id="thinking-toggle"
              type="checkbox"
              checked={thinkingEnabled}
              onChange={(e) => setThinkingEnabled(e.target.checked)}
            />
            <span>{thinkingEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>
        </div>
        <div className="api-field">
          <label htmlFor="thinking-budget">Thinking Budget</label>
          <input
            id="thinking-budget"
            type="number"
            min="256"
            step="256"
            value={thinkingBudget}
            onChange={(e) => setThinkingBudget(e.target.value)}
          />
        </div>
        <div className="api-field">
          <label htmlFor="max-tokens">Max Tokens</label>
          <input
            id="max-tokens"
            type="number"
            min="512"
            step="256"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
          />
        </div>
        <div className="api-field">
          <label htmlFor="temperature">Temperature</label>
          <input
            id="temperature"
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={thinkingEnabled ? 1 : temperature}
            onChange={(e) => setTemperature(e.target.value)}
            disabled={thinkingEnabled}
          />
          {thinkingEnabled && <span className="api-hint">Fixed at 1 when Extended Thinking is enabled.</span>}
        </div>
        {apiError && <div className="api-error">{apiError}</div>}
      </section>

      <main className="grid">
        <section className="panel span-4">
          <div className="panel-header">
            <div>
              <h2>Agent 1 — Discourse Level</h2>
              <p>Generate the discourse-level description and pacing profile.</p>
            </div>
            {copyStatus && <span className="copy-status">Copied {copyStatus}</span>}
          </div>

          <div className="panel-actions">
            <button className="ghost" onClick={() => handleCopy('System Prompt', DISCOURSE_SYSTEM_PROMPT)}>
              Copy System Prompt
            </button>
            <button className="ghost" onClick={() => handleCopy('User Prompt', discourseUserPrompt)}>
              Copy User Prompt
            </button>
            <button
              className="primary"
              onClick={() =>
                runAgent({
                  label: 'discourse',
                  systemPrompt: DISCOURSE_SYSTEM_PROMPT,
                  userPrompt: discourseUserPrompt,
                  onOutput: setDiscourseOutput,
                })
              }
              disabled={runningAgent === 'discourse'}
            >
              {runningAgent === 'discourse' ? 'Running…' : 'Run Agent 1'}
            </button>
          </div>

          <details className="prompt-box">
            <summary>System Prompt (Discourse)</summary>
            <pre>{DISCOURSE_SYSTEM_PROMPT}</pre>
          </details>

          <details className="prompt-box">
            <summary>User Prompt (auto-generated)</summary>
            <pre>{discourseUserPrompt}</pre>
          </details>

          <div className="field">
            <label htmlFor="discourse-feedback">Feedback for Discourse</label>
            <textarea
              id="discourse-feedback"
              placeholder="Notes for revising the discourse-level output."
              value={discourseFeedback}
              onChange={(e) => setDiscourseFeedback(e.target.value)}
              rows={3}
            />
          </div>

          <div className="field">
            <label htmlFor="discourse-output">Discourse Output</label>
            <textarea
              id="discourse-output"
              placeholder="Paste discourse output here."
              value={discourseOutput}
              onChange={(e) => setDiscourseOutput(e.target.value)}
              rows={8}
            />
            <label className="preview-toggle">
              <input
                type="checkbox"
                checked={showDiscoursePreview}
                onChange={(e) => setShowDiscoursePreview(e.target.checked)}
              />
              Readable view
            </label>
            {showDiscoursePreview && discourseOutput.trim() && (
              <div
                className="markdown-preview"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(discourseOutput) }}
              />
            )}
          </div>
        </section>

        <section className="panel span-4">
          <div className="panel-header">
            <div>
              <h2>Agent 2 — Scene Level</h2>
              <p>Generate scene-level summaries aligned to the discourse output.</p>
            </div>
            {copyStatus && <span className="copy-status">Copied {copyStatus}</span>}
          </div>

          <div className="panel-actions">
            <button className="ghost" onClick={() => handleCopy('System Prompt', SCENE_SYSTEM_PROMPT)}>
              Copy System Prompt
            </button>
            <button className="ghost" onClick={() => handleCopy('User Prompt', sceneUserPrompt)}>
              Copy User Prompt
            </button>
            <button
              className="primary"
              onClick={() =>
                runAgent({
                  label: 'scene',
                  systemPrompt: SCENE_SYSTEM_PROMPT,
                  userPrompt: sceneUserPrompt,
                  onOutput: setSceneOutput,
                })
              }
              disabled={runningAgent === 'scene'}
            >
              {runningAgent === 'scene' ? 'Running…' : 'Run Agent 2'}
            </button>
          </div>

          <details className="prompt-box">
            <summary>System Prompt (Scene)</summary>
            <pre>{SCENE_SYSTEM_PROMPT}</pre>
          </details>

          <details className="prompt-box">
            <summary>User Prompt (auto-generated)</summary>
            <pre>{sceneUserPrompt}</pre>
          </details>

          <div className="field">
            <label htmlFor="scene-feedback">Feedback for Scene Level</label>
            <textarea
              id="scene-feedback"
              placeholder="Notes for revising the scene-level output."
              value={sceneFeedback}
              onChange={(e) => setSceneFeedback(e.target.value)}
              rows={3}
            />
          </div>

          <div className="field">
            <label htmlFor="scene-output">Scene Output</label>
            <textarea
              id="scene-output"
              placeholder="Paste scene output here."
              value={sceneOutput}
              onChange={(e) => setSceneOutput(e.target.value)}
              rows={8}
            />
            <label className="preview-toggle">
              <input
                type="checkbox"
                checked={showScenePreview}
                onChange={(e) => setShowScenePreview(e.target.checked)}
              />
              Readable view
            </label>
            {showScenePreview && sceneOutput.trim() && (
              <div
                className="markdown-preview"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(sceneOutput) }}
              />
            )}
          </div>
        </section>

        <section className="panel span-4">
          <div className="panel-header">
            <div>
              <h2>Agent 3 — Utterance Level</h2>
              <p>Generate verse-level utterance maps with MUST COMMUNICATE boundaries.</p>
            </div>
            {copyStatus && <span className="copy-status">Copied {copyStatus}</span>}
          </div>

          <div className="panel-actions">
            <button className="ghost" onClick={() => handleCopy('System Prompt', UTTERANCE_SYSTEM_PROMPT)}>
              Copy System Prompt
            </button>
            <button className="ghost" onClick={() => handleCopy('User Prompt', utteranceUserPrompt)}>
              Copy User Prompt
            </button>
            <button
              className="primary"
              onClick={() =>
                runAgent({
                  label: 'utterance',
                  systemPrompt: UTTERANCE_SYSTEM_PROMPT,
                  userPrompt: utteranceUserPrompt,
                  onOutput: setUtteranceOutput,
                })
              }
              disabled={runningAgent === 'utterance'}
            >
              {runningAgent === 'utterance' ? 'Running…' : 'Run Agent 3'}
            </button>
          </div>

          <details className="prompt-box">
            <summary>System Prompt (Utterance)</summary>
            <pre>{UTTERANCE_SYSTEM_PROMPT}</pre>
          </details>

          <details className="prompt-box">
            <summary>User Prompt (auto-generated)</summary>
            <pre>{utteranceUserPrompt}</pre>
          </details>

          <div className="field">
            <label htmlFor="utterance-feedback">Feedback for Utterance Level</label>
            <textarea
              id="utterance-feedback"
              placeholder="Notes for revising the utterance-level output."
              value={utteranceFeedback}
              onChange={(e) => setUtteranceFeedback(e.target.value)}
              rows={3}
            />
          </div>

          <div className="field">
            <label htmlFor="utterance-output">Utterance Output</label>
            <textarea
              id="utterance-output"
              placeholder="Paste utterance output here."
              value={utteranceOutput}
              onChange={(e) => setUtteranceOutput(e.target.value)}
              rows={10}
            />
            <label className="preview-toggle">
              <input
                type="checkbox"
                checked={showUtterancePreview}
                onChange={(e) => setShowUtterancePreview(e.target.checked)}
              />
              Readable view
            </label>
            {showUtterancePreview && utteranceOutput.trim() && (
              <div
                className="markdown-preview"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(utteranceOutput) }}
              />
            )}
            {missingUtteranceRefs.length > 0 && (
              <div className="warning">
                Missing verse-level sections for: {missingUtteranceRefs.join(', ')}.
              </div>
            )}
          </div>

          <div className="panel-actions">
            <button className="primary" onClick={handleSaveDraftSet}>
              Save Draft Set
            </button>
            <button
              className="ghost"
              onClick={() => {
                setDiscourseOutput('')
                setSceneOutput('')
                setUtteranceOutput('')
                setReviewerOutput('')
                setDiscourseFeedback('')
                setSceneFeedback('')
                setUtteranceFeedback('')
              }}
            >
              Clear All Draft Fields
            </button>
          </div>

          <div className="draft-list">
            <h3>Draft History</h3>
            {drafts.length === 0 ? (
              <p className="muted">No draft sets saved yet for this passage.</p>
            ) : (
              drafts.map((draft, index) => (
                <div
                  key={draft.id}
                  className={`draft-item ${draft.id === activeDraftId ? 'active' : ''}`}
                >
                  <div>
                    <strong>Draft {index + 1}</strong>
                    <p className="muted">{new Date(draft.createdAt).toLocaleString()}</p>
                    <p className="draft-preview">
                      {(draft.utteranceOutput || draft.sceneOutput || draft.discourseOutput || '—').slice(0, 140)}
                    </p>
                  </div>
                  <div className="draft-actions">
                    <button className="ghost" onClick={() => setActiveDraftId(draft.id)}>
                      Load Draft
                    </button>
                    <button className="danger" onClick={() => handleDeleteDraft(draft.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel span-6">
          <div className="panel-header">
            <div>
              <h2>Agent 4 — Meaning Map Reviewer</h2>
              <p>Generate the review checklist from the combined map.</p>
            </div>
            {copyStatus && <span className="copy-status">Copied {copyStatus}</span>}
          </div>

          <div className="panel-actions">
            <button className="ghost" onClick={() => handleCopy('System Prompt', AGENT_2_PROMPT)}>
              Copy System Prompt
            </button>
            <button className="ghost" onClick={() => handleCopy('User Prompt', reviewerUserPrompt)}>
              Copy User Prompt
            </button>
            <button
              className="primary"
              onClick={() =>
                runAgent({
                  label: 'reviewer',
                  systemPrompt: AGENT_2_PROMPT,
                  userPrompt: reviewerUserPrompt,
                  onOutput: setReviewerOutput,
                })
              }
              disabled={runningAgent === 'reviewer' || !combinedOutput}
            >
              {runningAgent === 'reviewer' ? 'Running…' : 'Run Reviewer'}
            </button>
          </div>

          <details className="prompt-box">
            <summary>System Prompt (Reviewer)</summary>
            <pre>{AGENT_2_PROMPT}</pre>
          </details>

          <details className="prompt-box">
            <summary>User Prompt (auto-generated)</summary>
            <pre>{reviewerUserPrompt}</pre>
          </details>

          <div className="field">
            <label htmlFor="reviewer-output">Reviewer Checklist Output</label>
            <textarea
              id="reviewer-output"
              placeholder={combinedOutput ? 'Paste reviewer output here.' : 'Generate the map first.'}
              value={reviewerOutput}
              onChange={(e) => setReviewerOutput(e.target.value)}
              rows={12}
              disabled={!combinedOutput}
            />
            <label className="preview-toggle">
              <input
                type="checkbox"
                checked={showReviewerPreview}
                onChange={(e) => setShowReviewerPreview(e.target.checked)}
              />
              Readable view
            </label>
            {showReviewerPreview && reviewerOutput.trim() && (
              <div
                className="markdown-preview"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(reviewerOutput) }}
              />
            )}
          </div>

          <div className="panel-actions">
            <button className="primary" onClick={handleApprove} disabled={!reviewerOutput.trim()}>
              Approve & Save to Book
            </button>
          </div>

          <div className="saved-list">
            <h3>Approved Meaning Maps</h3>
            {savedMaps.length === 0 ? (
              <p className="muted">No approved passages yet.</p>
            ) : (
              savedMaps.map((entry) => (
                <details key={entry.id} className="saved-item">
                  <summary>
                    <span>{entry.passageRef}</span>
                    <span className="muted">{new Date(entry.createdAt).toLocaleDateString()}</span>
                  </summary>
                  <div className="saved-body">
                    <h4>Meaning Map</h4>
                    <pre>{entry.builderOutput}</pre>
                    <h4>Reviewer Checklist</h4>
                    <pre>{entry.reviewerOutput}</pre>
                  </div>
                </details>
              ))
            )}
            <div className="panel-actions">
              <button className="ghost" onClick={exportMarkdown} disabled={savedMaps.length === 0}>
                Export Markdown
              </button>
              <button className="ghost" onClick={exportJson} disabled={savedMaps.length === 0}>
                Export JSON
              </button>
              <button className="ghost" onClick={refreshSavedMaps} disabled={savedMapsLoading}>
                {savedMapsLoading ? 'Refreshing…' : 'Refresh Shared Maps'}
              </button>
            </div>
          </div>
        </section>

        <section className="panel data-panel span-6">
          <div className="panel-header">
            <div>
              <h2>BHSA Data — {passageRef}</h2>
              <p>Full word-level and clause-level data for the selected passage.</p>
            </div>
          </div>

          <div className="verse-list">
            {selectedVerses.map((verse) => {
              const hebrewLine = verse.words.map((w) => w.hebrew).join(' ')
              const translitLine = verse.words.map((w) => w.translit).join(' ')
              return (
                <article key={verse.ref} className="verse-card">
                  <div className="verse-head">
                    <h3>{verse.ref}</h3>
                    <span className="muted">
                      {verse.words.length} words • {verse.clauses.length} clauses • {verse.phrases.length} phrases
                    </span>
                  </div>
                  <div className="verse-lines">
                    <div className="hebrew" dir="rtl">
                      {hebrewLine}
                    </div>
                    <div className="translit">{translitLine}</div>
                  </div>
                  <div className="word-grid">
                    {verse.words.map((word) => (
                      <div key={word.id} className="word-chip">
                        <div className="word-main">
                          <span className="word-he">{word.hebrew}</span>
                          <span className="word-tr">{word.translit}</span>
                        </div>
                        <div className="word-meta">
                          <span>lex {word.lexeme}</span>
                          <span>{formatMorph(word)}</span>
                          <span>gloss {word.gloss || '—'}</span>
                          <span>prs {formatPronoun(word)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <details className="clause-box">
                    <summary>Clauses & Phrases</summary>
                    <div className="clause-grid">
                      {verse.clauses.map((clause, idx) => (
                        <div key={clause.id} className="clause-item">
                          <strong>Clause {idx + 1}</strong>
                          <span>typ {clause.typ || '—'}</span>
                          <span>rela {clause.rela || '—'}</span>
                        </div>
                      ))}
                    </div>
                    <div className="phrase-grid">
                      {verse.phrases.map((phrase, idx) => (
                        <div key={phrase.id} className="phrase-item">
                          <strong>Phrase {idx + 1}</strong>
                          <span>function {phrase.function || '—'}</span>
                          <span>typ {phrase.typ || '—'}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                </article>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
