import { useState } from 'react'
import { AnalysisProvider, GUIDES, useAnalysis } from './state/useAnalysis'
import type { GuideId } from './lib/types'
import SpaceView from './views/SpaceView'
import SimilarityView from './views/SimilarityView'
import VitalsView from './views/VitalsView'
import MatrixView from './views/MatrixView'
import CompareView from './views/CompareView'
import RecipeView from './views/RecipeView'

const TABS = [
  { id: 'space', label: '3D Style Space' },
  { id: 'similarity', label: 'Similarity' },
  { id: 'vitals', label: 'Vital Statistics' },
  { id: 'matrix', label: 'Matrix' },
  { id: 'compare', label: 'Guidelines' },
  { id: 'recipes', label: 'My Recipes' },
] as const

type TabId = (typeof TABS)[number]['id']

function Shell() {
  const [tab, setTab] = useState<TabId>('space')
  const { guideId, setGuideId, recipes } = useAnalysis()

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
