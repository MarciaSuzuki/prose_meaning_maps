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
  const match = /Ruth\s+(\d+):(\d+)(?:-(\d+))?/.exec(ref)
  if (!match) return { chapter: 0, start: 0, end: 0 }
  return {
    chapter: Number(match[1]),
    start: Number(match[2]),
    end: Number(match[3] || match[2]),
  }
}

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
  const [showBuilderPreview, setShowBuilderPreview] = useState(true)
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
    return raw ? JSON.parse(raw) : {}
  })
  const [savedMaps, setSavedMaps] = useState(() => {
    const raw = localStorage.getItem('ruth_saved_maps')
    return raw ? JSON.parse(raw) : []
  })
  const [reviewerByDraft, setReviewerByDraft] = useState(() => {
    const raw = localStorage.getItem('ruth_reviewer')
    return raw ? JSON.parse(raw) : {}
  })

  useEffect(() => {
    localStorage.setItem('ruth_drafts', JSON.stringify(draftsByPassage))
  }, [draftsByPassage])

  useEffect(() => {
    localStorage.setItem('ruth_saved_maps', JSON.stringify(savedMaps))
  }, [savedMaps])

  useEffect(() => {
    localStorage.setItem('ruth_reviewer', JSON.stringify(reviewerByDraft))
  }, [reviewerByDraft])

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

  const drafts = draftsByPassage[passageRef] ?? []
  const [activeDraftId, setActiveDraftId] = useState(drafts.at(-1)?.id ?? null)

  useEffect(() => {
    if (!drafts.find((d) => d.id === activeDraftId)) {
      setActiveDraftId(drafts.at(-1)?.id ?? null)
    }
  }, [passageRef, drafts, activeDraftId])

  const activeDraft = drafts.find((d) => d.id === activeDraftId) || null

  const [builderOutput, setBuilderOutput] = useState('')
  const [builderFeedback, setBuilderFeedback] = useState('')
  const coverageText = activeDraft?.output || builderOutput
  const missingUtteranceRefs = useMemo(() => {
    if (!coverageText) return []
    return requiredVerseRefs.filter((ref) => {
      const safe = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return !new RegExp(safe, 'i').test(coverageText)
    })
  }, [coverageText, requiredVerseRefs])

  const builderUserPrompt = useMemo(() => {
    const bhsaBlock = formatBhsaForPrompt(selectedVerses)
    return [
      `Passage: ${passageRef}`,
      'Task: Produce or revise the Prose Meaning Map using the BHSA data below.',
      'BHSA Data:',
      bhsaBlock,
      `Required utterance-level sections: ${requiredVerseRefs.join(', ') || 'None'}. Do not omit any verse.`,
      'Previous Draft:',
      activeDraft?.output || 'None',
      'Human Feedback:',
      builderFeedback.trim() || 'None',
      'Return only the meaning map in the required format.',
    ].join('\n\n')
  }, [selectedVerses, passageRef, activeDraft, builderFeedback])

  const reviewerUserPrompt = useMemo(() => {
    return [
      `Passage: ${passageRef}`,
      'Meaning Map Draft:',
      activeDraft?.output || 'None',
      'Task: Produce the reviewer checklist for this passage and map.',
    ].join('\n\n')
  }, [passageRef, activeDraft])

  const reviewerOutput = activeDraftId ? reviewerByDraft[activeDraftId] ?? '' : ''

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

  const handleRunAgent1 = () =>
    runAgent({
      label: 'agent1',
      systemPrompt: AGENT_1_PROMPT,
      userPrompt: builderUserPrompt,
      onOutput: setBuilderOutput,
    })

  const handleRunAgent2 = () => {
    if (!activeDraftId) return
    runAgent({
      label: 'agent2',
      systemPrompt: AGENT_2_PROMPT,
      userPrompt: reviewerUserPrompt,
      onOutput: (text) =>
        setReviewerByDraft((prev) => ({
          ...prev,
          [activeDraftId]: text,
        })),
    })
  }

  const handleSaveDraft = () => {
    if (!builderOutput.trim()) return
    const newDraft = {
      id: makeId(),
      output: builderOutput.trim(),
      feedback: builderFeedback.trim(),
      createdAt: new Date().toISOString(),
    }
    setDraftsByPassage((prev) => ({
      ...prev,
      [passageRef]: [...(prev[passageRef] ?? []), newDraft],
    }))
    setActiveDraftId(newDraft.id)
    setBuilderOutput('')
    setBuilderFeedback('')
  }

  const handleDeleteDraft = (draftId) => {
    setDraftsByPassage((prev) => {
      const next = (prev[passageRef] ?? []).filter((d) => d.id !== draftId)
      return { ...prev, [passageRef]: next }
    })
    setReviewerByDraft((prev) => {
      const next = { ...prev }
      delete next[draftId]
      return next
    })
  }

  const handleApprove = async () => {
    if (!activeDraft || !reviewerOutput.trim()) return
    setApiError('')
    const entry = {
      id: makeId(),
      passageRef,
      builderOutput: activeDraft.output,
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
            <span className="metric-label">drafts in range</span>
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
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Agent 1 — Prose Meaning Map Builder</h2>
              <p>Use the system prompt and BHSA data to draft the meaning map.</p>
            </div>
            {copyStatus && <span className="copy-status">Copied {copyStatus}</span>}
          </div>

          <div className="panel-actions">
            <button className="ghost" onClick={() => handleCopy('System Prompt', AGENT_1_PROMPT)}>
              Copy System Prompt
            </button>
            <button className="ghost" onClick={() => handleCopy('User Prompt', builderUserPrompt)}>
              Copy User Prompt
            </button>
            <button
              className="primary"
              onClick={handleRunAgent1}
              disabled={runningAgent === 'agent1'}
            >
              {runningAgent === 'agent1' ? 'Running Agent 1…' : 'Run Agent 1'}
            </button>
          </div>

          <details className="prompt-box">
            <summary>System Prompt (Agent 1)</summary>
            <pre>{AGENT_1_PROMPT}</pre>
          </details>

          <details className="prompt-box">
            <summary>User Prompt (auto-generated)</summary>
            <pre>{builderUserPrompt}</pre>
          </details>

          <div className="field">
            <label htmlFor="builder-feedback">Human Feedback / Revisions</label>
            <textarea
              id="builder-feedback"
              placeholder="Notes for the next draft (issues to fix, clarity notes, required changes)."
              value={builderFeedback}
              onChange={(e) => setBuilderFeedback(e.target.value)}
              rows={4}
            />
          </div>

          <div className="field">
            <label htmlFor="builder-output">Meaning Map Draft Output</label>
            <textarea
              id="builder-output"
              placeholder="Paste the agent output here."
              value={builderOutput}
              onChange={(e) => setBuilderOutput(e.target.value)}
              rows={12}
            />
            <label className="preview-toggle">
              <input
                type="checkbox"
                checked={showBuilderPreview}
                onChange={(e) => setShowBuilderPreview(e.target.checked)}
              />
              Readable view
            </label>
            {showBuilderPreview && builderOutput.trim() && (
              <div
                className="markdown-preview"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(builderOutput) }}
              />
            )}
            {missingUtteranceRefs.length > 0 && (
              <div className="warning">
                Missing verse-level sections for: {missingUtteranceRefs.join(', ')}.
              </div>
            )}
          </div>

          <div className="panel-actions">
            <button className="primary" onClick={handleSaveDraft}>
              Save Draft
            </button>
            <button
              className="ghost"
              onClick={() => {
                setBuilderOutput('')
                setBuilderFeedback('')
              }}
            >
              Clear Draft Fields
            </button>
          </div>

          <div className="draft-list">
            <h3>Draft History</h3>
            {drafts.length === 0 ? (
              <p className="muted">No drafts saved yet for this passage.</p>
            ) : (
              drafts.map((draft, index) => (
                <div
                  key={draft.id}
                  className={`draft-item ${draft.id === activeDraftId ? 'active' : ''}`}
                >
                  <div>
                    <strong>Draft {index + 1}</strong>
                    <p className="muted">{new Date(draft.createdAt).toLocaleString()}</p>
                    <p className="draft-preview">{draft.output.slice(0, 140) || '—'}</p>
                  </div>
                  <div className="draft-actions">
                    <button className="ghost" onClick={() => setActiveDraftId(draft.id)}>
                      Use for Review
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

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Agent 2 — Meaning Map Reviewer</h2>
              <p>Generate the review checklist from the selected draft.</p>
            </div>
            {copyStatus && <span className="copy-status">Copied {copyStatus}</span>}
          </div>

          <div className="panel-actions">
            <button className="ghost" onClick={() => handleCopy('System Prompt', AGENT_2_PROMPT)}>
              Copy System Prompt
            </button>
            <button
              className="ghost"
              onClick={() => handleCopy('User Prompt', reviewerUserPrompt)}
              disabled={!activeDraft}
            >
              Copy User Prompt
            </button>
            <button
              className="primary"
              onClick={handleRunAgent2}
              disabled={!activeDraft || runningAgent === 'agent2'}
            >
              {runningAgent === 'agent2' ? 'Running Agent 2…' : 'Run Agent 2'}
            </button>
          </div>

          <details className="prompt-box">
            <summary>System Prompt (Agent 2)</summary>
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
              placeholder={activeDraft ? 'Paste reviewer output here.' : 'Select a draft first.'}
              value={reviewerOutput}
              onChange={(e) =>
                activeDraftId &&
                setReviewerByDraft((prev) => ({ ...prev, [activeDraftId]: e.target.value }))
              }
              rows={12}
              disabled={!activeDraft}
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
            <button className="primary" onClick={handleApprove} disabled={!activeDraft || !reviewerOutput.trim()}>
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

        <section className="panel data-panel">
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
