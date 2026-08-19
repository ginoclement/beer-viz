import { useEffect, useMemo, useRef, useState } from 'react'
import { AnalysisProvider, GUIDES, useAnalysis } from './state/useAnalysis'
import type { GuideId } from './lib/types'
import SpaceView from './views/SpaceView'
import SimilarityView from './views/SimilarityView'
import VitalsView from './views/VitalsView'
import MatrixView from './views/MatrixView'
import CompareView from './views/CompareView'
import RecipeView from './views/RecipeView'
import StyleExplorerView from './views/StyleExplorerView'
import RecipeSpaceView from './views/RecipeSpaceView'
import BrowseView from './views/BrowseView'
import HopsView from './views/HopsView'
import IngredientsView from './views/IngredientsView'
import TaxonomyView from './views/TaxonomyView'

/**
 * Two-level navigation: each visualization is its own page, and pages are
 * organized into groups. The header shows the group tabs; a sub-nav below
 * lists the pages of the active group. One graphic per page.
 */
const NAV = [
  {
    group: 'Style Space',
    pages: [
      { id: 'space', label: '3D Space' },
      { id: 'taxonomy', label: 'Family Tree of Beer' },
      { id: 'similarity', label: 'Similarity Network' },
      { id: 'matrix', label: 'Similarity Matrix' },
      { id: 'tree', label: 'Family Tree' },
    ],
  },
  {
    group: 'Vitals',
    pages: [
      { id: 'vitals-strength', label: 'Bitterness × Strength' },
      { id: 'vitals-ferment', label: 'Fermentability' },
      { id: 'vitals-color', label: 'Color Ladder' },
    ],
  },
  {
    group: 'Hops',
    pages: [
      { id: 'hops-pairing', label: 'Style Pairing' },
      { id: 'hops-aroma', label: 'Aroma Map' },
      { id: 'hops-space', label: '3D Aroma Space' },
      { id: 'hops-network', label: 'Kinship Network' },
    ],
  },
  {
    group: 'Ingredients',
    pages: [
      { id: 'ing-usage', label: 'Hop Usage' },
      { id: 'ing-grist', label: 'Grist by Family' },
      { id: 'ing-outcome', label: 'Ingredients → Outcome' },
    ],
  },
  {
    group: 'Recipes',
    pages: [
      { id: 'recipes-explore', label: 'Style Explorer' },
      { id: 'recipes-space', label: '3D Recipe Space' },
    ],
  },
  {
    group: 'Guidelines',
    pages: [
      { id: 'compare-map', label: 'Overlay Map' },
      { id: 'compare-drift', label: 'Drift Table' },
    ],
  },
  {
    group: 'Explore',
    pages: [
      { id: 'browse', label: 'Browse Styles' },
      { id: 'recipes', label: 'My Recipes' },
    ],
  },
] as const

type PageId = (typeof NAV)[number]['pages'][number]['id']

const PAGE_IDS = NAV.flatMap((g) => g.pages.map((p) => p.id)) as PageId[]
const isPage = (t: string): t is PageId => (PAGE_IDS as string[]).includes(t)
const groupOf = (page: PageId) => NAV.find((g) => g.pages.some((p) => p.id === page))!.group

/** Old single-tab hashes → their new page id, so existing links still work. */
const LEGACY: Record<string, PageId> = {
  hops: 'hops-pairing',
  ingredients: 'ing-usage',
  vitals: 'vitals-strength',
  compare: 'compare-map',
}

/** #page/guideId/styleId — shareable app state in the URL hash. */
function parseHash(): { page?: PageId; guide?: GuideId; styleId?: string } {
  const parts = decodeURIComponent(window.location.hash.replace(/^#\/?/, '')).split('/')
  const out: { page?: PageId; guide?: GuideId; styleId?: string } = {}
  const first = parts[0]
  if (first && isPage(first)) out.page = first
  else if (first && LEGACY[first]) out.page = LEGACY[first]
  if (parts[1] && GUIDES.some((g) => g.guide === parts[1])) out.guide = parts[1] as GuideId
  if (parts[2]) out.styleId = parts[2]
  return out
}

function Shell() {
  const initial = useRef(parseHash())
  const [page, setPage] = useState<PageId>(initial.current.page ?? 'space')
  const { guideId, setGuideId, recipes, selectedId, setSelectedId } = useAnalysis()

  const activeGroup = groupOf(page)
  // remember the last page visited within each group so switching groups
  // returns you to where you were, not always the first page
  const lastByGroup = useRef<Record<string, PageId>>({})
  lastByGroup.current[activeGroup] = page

  // apply guide/style from the URL once on mount
  useEffect(() => {
    const { guide, styleId } = initial.current
    if (guide) setGuideId(guide)
    if (styleId) setSelectedId(styleId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keep the hash in sync so any page is linkable
  useEffect(() => {
    const next = `#${page}/${guideId}${selectedId ? `/${encodeURIComponent(selectedId)}` : ''}`
    if (window.location.hash !== next) window.history.replaceState(null, '', next)
  }, [page, guideId, selectedId])

  const subPages = useMemo(() => NAV.find((g) => g.group === activeGroup)!.pages, [activeGroup])
  const [aboutOpen, setAboutOpen] = useState(false)

  const goToPage = (p: PageId) => setPage(p)

  return (
    <div className="app">
      <header className="header">
        <div className="header-top">
          <h1>
            <span className="mug" aria-hidden>
              🍺
            </span>
            Beer Style Space
          </h1>
          <nav className="tabs" aria-label="Sections">
            {NAV.map((g) => (
              <button
                key={g.group}
                className={g.group === activeGroup ? 'active' : ''}
                onClick={() => setPage(lastByGroup.current[g.group] ?? g.pages[0].id)}
              >
                {g.group}
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
            <button className="helpx" onClick={() => setAboutOpen(true)} title="About the data" aria-label="About the data">
              ⓘ
            </button>
          </div>
        </div>
        <nav className="subtabs" aria-label={`${activeGroup} pages`}>
          {subPages.map((p) => (
            <button key={p.id} className={page === p.id ? 'active' : ''} onClick={() => setPage(p.id)}>
              {p.label}
              {p.id === 'recipes' && recipes.length > 0 ? ` (${recipes.length})` : ''}
            </button>
          ))}
        </nav>
      </header>

      {aboutOpen && (
        <div className="modal-backdrop" onClick={() => setAboutOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="About the data" onClick={(e) => e.stopPropagation()}>
            <button className="closex" onClick={() => setAboutOpen(false)} aria-label="Close">
              ×
            </button>
            <h2>About the data</h2>
            <p>
              Style data: BJCP 2021 &amp; 2015 Beer Style Guidelines (© Beer Judge
              Certification Program) and Brewers Association 2017 Beer Style Guidelines,
              via the MIT-licensed{' '}
              <a href="https://github.com/beerjson/bjcp-json" target="_blank" rel="noreferrer">
                beerjson/bjcp-json
              </a>{' '}
              dataset.
            </p>
            <p>
              Hop chemistry merges Yakima Chief, Barth-Haas, Hopsteiner &amp; Crosby
              published ranges. Recipe corpus: BrewDog DIY Dog (415 published recipes,
              © BrewDog) via the MIT-licensed alxiw/punkapi archive.
            </p>
            <p>
              All analysis (PCA, UMAP, k-means, hierarchical clustering, Jaccard
              similarity) runs live in your browser — nothing is uploaded anywhere.
            </p>
          </div>
        </div>
      )}

      {page === 'space' && <SpaceView />}
      {page === 'taxonomy' && <TaxonomyView goToSpace={() => goToPage('space')} />}
      {page === 'similarity' && <SimilarityView goToSpace={() => goToPage('space')} />}
      {page === 'matrix' && <MatrixView page="matrix" goToSpace={() => goToPage('space')} />}
      {page === 'tree' && <MatrixView page="tree" goToSpace={() => goToPage('space')} />}

      {page === 'vitals-strength' && <VitalsView page="strength" goToSpace={() => goToPage('space')} />}
      {page === 'vitals-ferment' && <VitalsView page="ferment" goToSpace={() => goToPage('space')} />}
      {page === 'vitals-color' && <VitalsView page="color" goToSpace={() => goToPage('space')} />}

      {page === 'hops-pairing' && <HopsView page="pairing" />}
      {page === 'hops-aroma' && <HopsView page="aroma" />}
      {page === 'hops-space' && <HopsView page="space" />}
      {page === 'hops-network' && <HopsView page="network" />}

      {page === 'ing-usage' && <IngredientsView page="usage" goToHops={() => goToPage('hops-pairing')} />}
      {page === 'ing-grist' && <IngredientsView page="grist" goToHops={() => goToPage('hops-pairing')} />}
      {page === 'ing-outcome' && <IngredientsView page="outcome" goToHops={() => goToPage('hops-pairing')} />}

      {page === 'compare-map' && <CompareView page="map" />}
      {page === 'compare-drift' && <CompareView page="drift" />}

      {page === 'recipes-explore' && <StyleExplorerView />}
      {page === 'recipes-space' && <RecipeSpaceView />}
      {page === 'browse' && <BrowseView goToSpace={() => goToPage('space')} />}
      {page === 'recipes' && <RecipeView goToSpace={() => goToPage('space')} />}


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
