import { useMemo, useRef, useState } from 'react'
import { useAnalysis } from '../state/useAnalysis'
import { parseBrewfather } from '../lib/recipe/brewfather'
import { parseBeerXml } from '../lib/recipe/beerxml'
import { deriveRecipeTags } from '../lib/recipe/derive'
import { jaccard } from '../lib/similarity'
import { euclidean } from '../lib/similarity'
import { srmToHex } from '../lib/srm'
import type { Recipe } from '../lib/types'

function parseAny(text: string, colorUnit: 'auto' | 'srm' | 'ebc'): Recipe {
  const trimmed = text.trim()
  if (trimmed.startsWith('<')) return parseBeerXml(trimmed)
  let json: unknown
  try {
    json = JSON.parse(trimmed)
  } catch {
    throw new Error('Input is neither XML nor valid JSON')
  }
  return parseBrewfather(json, colorUnit)
}

function ManualEntry({ onAdd }: { onAdd: (r: Recipe) => void }) {
  const [name, setName] = useState('My recipe')
  const [og, setOg] = useState('1.050')
  const [fg, setFg] = useState('1.010')
  const [abv, setAbv] = useState('')
  const [ibu, setIbu] = useState('30')
  const [srm, setSrm] = useState('8')
  const [err, setErr] = useState<string | null>(null)

  const submit = () => {
    const nOg = parseFloat(og)
    const nFg = parseFloat(fg)
    const nIbu = parseFloat(ibu)
    const nSrm = parseFloat(srm)
    let nAbv = parseFloat(abv)
    if ([nOg, nFg, nIbu, nSrm].some((x) => !isFinite(x))) {
      setErr('OG, FG, IBU and SRM are required numbers')
      return
    }
    if (!isFinite(nAbv)) nAbv = (nOg - nFg) * 131.25
    setErr(null)
    const vitals = { og: nOg, fg: nFg, abv: nAbv, ibu: nIbu, srm: nSrm }
    onAdd({
      name: name.trim() || 'My recipe',
      vitals,
      tags: deriveRecipeTags(vitals, { name }),
      source: 'manual',
    })
  }

  return (
    <div className="chart-card">
      <h2>Or enter vitals by hand</h2>
      <p className="sub">ABV is computed from the gravities if left blank.</p>
      <div style={{ marginBottom: 10 }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Recipe name"
          style={{ width: '100%' }}
        />
      </div>
      <div className="manual-grid">
        <label>
          OG
          <input value={og} onChange={(e) => setOg(e.target.value)} inputMode="decimal" />
        </label>
        <label>
          FG
          <input value={fg} onChange={(e) => setFg(e.target.value)} inputMode="decimal" />
        </label>
        <label>
          ABV %
          <input value={abv} onChange={(e) => setAbv(e.target.value)} inputMode="decimal" placeholder="auto" />
        </label>
        <label>
          IBU
          <input value={ibu} onChange={(e) => setIbu(e.target.value)} inputMode="decimal" />
        </label>
        <label>
          SRM
          <input value={srm} onChange={(e) => setSrm(e.target.value)} inputMode="decimal" />
        </label>
        <button className="btn primary" onClick={submit}>
          Add
        </button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  )
}

function RecipeCard({
  recipe,
  index,
  goToSpace,
}: {
  recipe: Recipe
  index: number
  goToSpace: () => void
}) {
  const { styles, numericZ, numericTransform, alpha, removeRecipe, setSelectedId } = useAnalysis()

  const matches = useMemo(() => {
    const rz = numericTransform(recipe.vitals)
    const dists = numericZ.map((v) => euclidean(rz, v))
    const sorted = [...dists].sort((a, b) => a - b)
    const scale = sorted[Math.floor(sorted.length * 0.95)] || 1
    return styles
      .map((s, i) => {
        const jac = jaccard(recipe.tags, s.tags)
        const closeness = Math.max(0, 1 - dists[i] / scale)
        return { s, sim: alpha * jac + (1 - alpha) * closeness, jac, closeness }
      })
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 8)
  }, [recipe, styles, numericZ, numericTransform, alpha])

  const v = recipe.vitals
  return (
    <div className="recipe-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          className="srmdot"
          style={{ background: srmToHex(v.srm), width: 16, height: 16 }}
          title={`~${Math.round(v.srm)} SRM`}
        />
        <h3>{recipe.name}</h3>
        <span className="pill">{recipe.source}</span>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={goToSpace}>
          Show in 3D space
        </button>
        <button className="btn" onClick={() => removeRecipe(index)} aria-label={`Remove ${recipe.name}`}>
          ✕
        </button>
      </div>
      <dl className="statgrid" style={{ margin: '10px 0' }}>
        <dt>OG / FG</dt>
        <dd>
          {v.og.toFixed(3)} / {v.fg.toFixed(3)}
        </dd>
        <dt>ABV</dt>
        <dd>{v.abv.toFixed(1)}%</dd>
        <dt>IBU / SRM</dt>
        <dd>
          {Math.round(v.ibu)} / {v.srm.toFixed(1)}
        </dd>
      </dl>
      <div className="tagchips">
        {recipe.tags.map((t) => (
          <span key={t} className="chip">
            {t}
          </span>
        ))}
      </div>
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.7, color: 'var(--muted)', margin: '12px 0 4px' }}>
        Closest styles
      </h3>
      {matches.map((m, mi) => (
        <div key={m.s.id} className="match-row" onClick={() => { setSelectedId(m.s.id); goToSpace() }}>
          <span className="pct">{Math.round(m.sim * 100)}%</span>
          <span
            className="srmdot"
            style={{ background: srmToHex(((m.s.stats.srm?.[0] ?? 5) + (m.s.stats.srm?.[1] ?? 5)) / 2) }}
          />
          <span className="nm">
            {mi === 0 ? <strong>{m.s.name}</strong> : m.s.name}{' '}
            <span className="id">{m.s.categoryId ? m.s.id : ''}</span>
          </span>
          <span className="id" title="tag similarity / numeric closeness">
            tags {Math.round(m.jac * 100)}% · nums {Math.round(m.closeness * 100)}%
          </span>
        </div>
      ))}
    </div>
  )
}

export default function RecipeView({ goToSpace }: { goToSpace: () => void }) {
  const { recipes, addRecipe, guide, alpha, setAlpha } = useAnalysis()
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [colorUnit, setColorUnit] = useState<'auto' | 'srm' | 'ebc'>('auto')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const importText = (t: string) => {
    try {
      addRecipe(parseAny(t, colorUnit))
      setErr(null)
      setText('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const readFiles = (files: FileList | null) => {
    if (!files) return
    for (const f of Array.from(files)) {
      f.text().then(importText, () => setErr(`Could not read ${f.name}`))
    }
  }

  return (
    <div className="view">
      <div className="recipe-cols">
        <div className="col">
          <div className="chart-card">
            <h2>Import a recipe</h2>
            <p className="sub">
              Export a recipe from <strong>Brewfather</strong> (Recipe → share → JSON) or any
              software that writes <strong>BeerXML</strong>, then drop the file here or paste
              its contents. The recipe is projected into the {guide.label} style space with
              the exact same math as the styles themselves — nothing leaves your browser.
            </p>
            <div
              className={`dropzone${dragOver ? ' over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                readFiles(e.dataTransfer.files)
              }}
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              Drop a .json / .xml file here, or click to browse
              <input
                ref={fileRef}
                type="file"
                accept=".json,.xml,application/json,text/xml"
                multiple
                hidden
                onChange={(e) => readFiles(e.target.files)}
              />
            </div>
            <textarea
              placeholder='Or paste JSON/XML here, e.g. {"name":"House IPA","og":1.062,"fg":1.012,"ibu":55,"color":7.5,...}'
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
              <button className="btn primary" onClick={() => importText(text)} disabled={!text.trim()}>
                Import pasted text
              </button>
              <label className="ctl">
                Color unit
                <select value={colorUnit} onChange={(e) => setColorUnit(e.target.value as never)}>
                  <option value="auto">auto</option>
                  <option value="srm">SRM</option>
                  <option value="ebc">EBC</option>
                </select>
              </label>
              <label className="ctl" title="0 = numbers only, 1 = tags only" style={{ marginLeft: 'auto' }}>
                Match blend
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={alpha}
                  onChange={(e) => setAlpha(Number(e.target.value))}
                />
              </label>
            </div>
            {err && <div className="err">{err}</div>}
          </div>
          <ManualEntry onAdd={addRecipe} />
        </div>
        <div className="col">
          {recipes.length === 0 ? (
            <div className="chart-card">
              <h2>No recipes yet</h2>
              <p className="sub">
                Imported recipes appear here with their derived style tags and closest
                guideline styles — and as bright diamonds inside the 3D style space, so you
                can see exactly which corner of the beer world you're brewing in.
              </p>
            </div>
          ) : (
            recipes.map((r, i) => (
              <RecipeCard key={`${r.name}-${i}`} recipe={r} index={i} goToSpace={goToSpace} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
