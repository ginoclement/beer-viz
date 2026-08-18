import { useEffect, useRef, useState } from 'react'
import { AnalysisProvider, GUIDES, useAnalysis } from './state/useAnalysis'
import type { GuideId } from './lib/types'
import SpaceView from './views/SpaceView'
import SimilarityView from './views/SimilarityView'
import VitalsView from './views/VitalsView'
import MatrixView from './views/MatrixView'
import CompareView from './views/CompareView'
import RecipeView from './views/RecipeView'
import BrowseView from './views/BrowseView'
import HopsView from './views/HopsView'

const TABS = [
  { id: 'space', label: '3D Style Space' },
  { id: 'similarity', label: 'Similarity' },
  { id: 'hops', label: 'Hops' },
  { id: 'browse', label: 'Browse' },
  { id: 'vitals', label: 'Vital Statistics' },
  { id: 'matrix', label: 'Matrix' },
  { id: 'compare', label: 'Guidelines' },
  { id: 'recipes', label: 'My Recipes' },
] as const

type TabId = (typeof TABS)[number]['id']

const isTab = (t: string): t is TabId => TABS.some((x) => x.id === t)

/** #tab/guideId/styleId — shareable app state in the URL hash. */
function parseHash(): { tab?: TabId; guide?: GuideId; styleId?: string } {
  const parts = decodeURIComponent(window.location.hash.replace(/^#\/?/, '')).split('/')
  const out: { tab?: TabId; guide?: GuideId; styleId?: string } = {}
  if (parts[0] && isTab(parts[0])) out.tab = parts[0]
  if (parts[1] && GUIDES.some((g) => g.guide === parts[1])) out.guide = parts[1] as GuideId
  if (parts[2]) out.styleId = parts[2]
  return out
}

function Shell() {
  const initial = useRef(parseHash())
  const [tab, setTab] = useState<TabId>(initial.current.tab ?? 'space')
  const { guideId, setGuideId, recipes, selectedId, setSelectedId } = useAnalysis()

  // apply guide/style from the URL once on mount
  useEffect(() => {
    const { guide, styleId } = initial.current
    if (guide) setGuideId(guide)
    if (styleId) setSelectedId(styleId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keep the hash in sync so any view is linkable
  useEffect(() => {
    const next = `#${tab}/${guideId}${selectedId ? `/${encodeURIComponent(selectedId)}` : ''}`
    if (window.location.hash !== next) window.history.replaceState(null, '', next)
  }, [tab, guideId, selectedId])

  return (
    <div className="app">
      <header className="header">
        <h1>
          <span className="mug" aria-hidden>
            🍺
          </span>
          Beer Style Space
        </h1>
        <nav className="tabs" aria-label="Views">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === 'recipes' && recipes.length > 0 ? ` (${recipes.length})` : ''}
            </button>
          ))}
        </nav>
        <div className="guide-picker">
          <span>Guideline</span>
          <select
            value={guideId}
            onChange={(e) => setGuideId(e.target.value as GuideId)}
            aria-label="Style guideline"
          >
            {GUIDES.map((g) => (
              <option key={g.guide} value={g.guide}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {tab === 'space' && <SpaceView />}
      {tab === 'similarity' && <SimilarityView />}
      {tab === 'browse' && <BrowseView />}
      {tab === 'hops' && <HopsView />}
      {tab === 'vitals' && <VitalsView />}
      {tab === 'matrix' && <MatrixView />}
      {tab === 'compare' && <CompareView />}
      {tab === 'recipes' && <RecipeView goToSpace={() => setTab('space')} />}

      <footer className="foot">
        Style data: BJCP 2021 &amp; 2015 Beer Style Guidelines (© Beer Judge Certification
        Program) and Brewers Association 2017 Beer Style Guidelines, via the MIT-licensed{' '}
        <a href="https://github.com/beerjson/bjcp-json" target="_blank" rel="noreferrer">
          beerjson/bjcp-json
        </a>{' '}
        dataset. Analysis (PCA, UMAP, k-means, Jaccard) runs live in your browser.
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <AnalysisProvider>
      <Shell />
    </AnalysisProvider>
  )
}
