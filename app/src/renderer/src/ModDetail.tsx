import { useState } from 'react'
import Markdown from 'react-markdown'
import type { DownloadFile, ModImage, Relation } from '@catalog/schema'
import { matchInstalled, targetKey } from '@shared/match'
import { KIND_LABEL, resolveTarget, steamUrl, useData } from './data'
import { CreatorSection } from './Creators'

const RELATION_TITLE: Record<Relation['kind'], string> = {
  requires: 'Requires',
  recommends: 'Recommended',
  optional: 'Optional add-ons',
  incompatible: 'Incompatible',
  extends: 'Extends',
  supersedes: 'Replaces'
}

function Gallery({ images }: { images: ModImage[] }) {
  const [big, setBig] = useState<ModImage | null>(null)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  images = images.filter((i) => !broken.has(i.url))
  if (!images.length) return null
  return (
    <>
      <div className="gallery">
        {images.map((img) => (
          <figure key={img.url} onClick={() => setBig(img)}>
            <img src={img.thumb ?? img.url} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken((s) => new Set(s).add(img.url))} />
            {img.caption && <figcaption>{img.caption}</figcaption>}
          </figure>
        ))}
      </div>
      {big && (
        <div className="lightbox" onClick={() => setBig(null)}>
          <img src={big.url} referrerPolicy="no-referrer" />
          {big.caption && <p>{big.caption}</p>}
        </div>
      )}
    </>
  )
}

/** Download files, with alternatives ("pick one") grouped together. */
function Downloads({ files }: { files: DownloadFile[] }) {
  const groups = new Map<string, DownloadFile[]>()
  for (const f of files) {
    const key = f.exclusiveGroup ?? ''
    groups.set(key, [...(groups.get(key) ?? []), f])
  }
  return (
    <div className="downloads">
      {[...groups.entries()].map(([group, list]) => (
        <div key={group} className={group ? 'download-group' : ''}>
          {group && <div className="small muted">Pick one ({group}):</div>}
          <ul>
            {list.map((d) => (
              <li key={d.name + d.url}>
                {d.url ? <a href={d.url} target="_blank">{d.name}</a> : d.name}
                {d.optional && <span className="badge">optional</span>}
                {(d.description ?? d.note) && <span className="muted small"> – {d.description ?? d.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function ModDetail({ id, onClose }: { id: string; onClose(): void }) {
  const data = useData()
  const mod = data.index.mods.get(id)
  if (!mod) return null
  const installed = data.scan ? matchInstalled(data.index, data.scan.packs).known.get(targetKey({ mod: mod.id })) : undefined
  const byKind = new Map<Relation['kind'], Relation[]>()
  for (const r of mod.relations) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r])
  const ll = mod.sources.loverslab

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>×</button>
        <h2>{mod.name}</h2>
        <div className="badges">
          <span className="badge">{KIND_LABEL[mod.kind]}</span>
          {mod.status && <span className={`badge status-${mod.status}`}>{mod.status}</span>}
          {mod.campaigns?.map((c) => <span key={c} className="badge">{c}</span>)}
          {installed ? <span className="badge ok">installed</span> : <span className="badge">not installed</span>}
          {mod.curation.confidence !== 'high' && <span className="badge warn">{mod.curation.confidence} confidence</span>}
        </div>
        {mod.authors.length > 0 && <p className="muted">by {mod.authors.join(', ')}</p>}
        <CreatorSection mod={mod} />
        {mod.communityReports && (
          <p className="small">
            Community: <span className="ok-text">{mod.communityReports.works} works</span> · <span className="warn-text">{mod.communityReports.issues} with issues</span> ·{' '}
            <span className="danger">{mod.communityReports.broken} broken</span>
            {mod.communityReports.lastReport && <span className="muted"> (last {mod.communityReports.lastReport})</span>}
          </p>
        )}
        {mod.curation.openQuestions?.some((q) => q.startsWith('Automatic entry')) && (
          <p className="callout warn small">Added automatically from the mod page and not reviewed yet. Requirements may be incomplete; feedback and corrections help.</p>
        )}
        <div className="contrib-actions">
          <button onClick={() => data.contribute({ type: 'feedback', modId: mod.id })}>Give feedback</button>
          <button onClick={() => data.contribute({ type: 'rule', modId: mod.id })}>Suggest a rule</button>
          <button onClick={() => data.contribute({ type: 'correction', modId: mod.id })}>Suggest a correction</button>
        </div>

        {mod.images && mod.images.length > 0 && <Gallery images={mod.images} />}

        <div className="markdown">
          <Markdown>{mod.description ?? mod.summary}</Markdown>
        </div>

        {mod.features && mod.features.length > 0 && (
          <section>
            <h3>Features</h3>
            <ul>{mod.features.map((f) => <li key={f}>{f}</li>)}</ul>
          </section>
        )}
        {mod.recommendedFor && (
          <section className="callout">
            <h3>Worth adding if…</h3>
            <p>{mod.recommendedFor}</p>
          </section>
        )}
        {mod.playAs && mod.playAs.length > 0 && (
          <section>
            <h3>Play as</h3>
            <ul>{mod.playAs.map((p) => <li key={p.character}>{p.character}{p.note ? ` – ${p.note}` : ''}</li>)}</ul>
          </section>
        )}

        {[...byKind.entries()].map(([kind, rels]) => (
          <section key={kind}>
            <h3 className={kind === 'incompatible' ? 'danger' : ''}>{RELATION_TITLE[kind]}</h3>
            <ul className="relations">
              {rels.map((r, i) => {
                const t = resolveTarget(data, r.target)
                return (
                  <li key={i}>
                    {t.kind === 'mod' ? (
                      <a onClick={() => data.openMod(t.mod.id)}>{t.mod.name}</a>
                    ) : t.kind === 'external' ? (
                      <span>{t.ext.name}</span>
                    ) : (
                      <span>{t.label}</span>
                    )}
                    {r.condition && <em> (only {r.condition})</em>}
                    {r.note && <div className="muted small">{r.note}</div>}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        {mod.loadOrder?.note && (
          <section>
            <h3>Load order</h3>
            <p className="small">{mod.loadOrder.note}</p>
          </section>
        )}
        {(mod.installNotes?.length || mod.cleanup) && (
          <section>
            <h3>Installation notes</h3>
            <ul>{mod.installNotes?.map((n) => <li key={n}>{n}</li>)}</ul>
            {mod.cleanup && <p className="callout warn">{mod.cleanup.note}</p>}
          </section>
        )}
        {mod.communityNotes && mod.communityNotes.length > 0 && (
          <section>
            <h3>Community notes</h3>
            <ul>
              {mod.communityNotes.map((n) => (
                <li key={n.text}>{n.text} <span className="muted small">({n.date}{n.url ? <>, <a href={n.url} target="_blank">source</a></> : null})</span></li>
              ))}
            </ul>
          </section>
        )}
        {mod.knownIssues && mod.knownIssues.length > 0 && (
          <section>
            <h3>Known issues</h3>
            <ul>{mod.knownIssues.map((n) => <li key={n}>{n}</li>)}</ul>
          </section>
        )}

        <section>
          <h3>Sources</h3>
          <ul className="links">
            {ll && <li><a href={ll.url} target="_blank">LoversLab {ll.version ? `v${ll.version}` : ''} ({ll.updated?.slice(0, 10)})</a></li>}
            {mod.sources.nexus && (
              <li><a href={mod.sources.nexus.url} target="_blank">Nexus Mods{mod.sources.nexus.adult ? ' (adult content, sign-in needed)' : ''}</a></li>
            )}
            {mod.sources.steam?.map((s) => (
              <li key={s.id}><a href={steamUrl(s.id)} target="_blank">Steam: {s.title ?? s.id}{s.unlisted ? ' (unlisted)' : ''}</a></li>
            ))}
            {mod.sources.discord?.map((d, i) => (
              <li key={i}>{d.messageUrl ? <a href={d.messageUrl} target="_blank">Discord {d.channel}</a> : `Discord ${d.channel}`}</li>
            ))}
          </ul>
          {mod.sources.downloads && mod.sources.downloads.length > 0 && <Downloads files={mod.sources.downloads} />}
          {ll?.singleFile && <p className="small muted">LoversLab offers a single file ({ll.singleFile}).</p>}
          {ll?.externalDownload && <p className="small muted">The LoversLab download points to another site.</p>}
          {installed && (
            <p className="small muted">Installed packs: {installed.map((p) => `${p.file} (${p.source})`).join(', ')}</p>
          )}
        </section>
        {mod.curation.openQuestions && mod.curation.openQuestions.length > 0 && (
          <section>
            <h3>Open questions</h3>
            <ul className="small muted">{mod.curation.openQuestions.map((q) => <li key={q}>{q}</li>)}</ul>
          </section>
        )}
      </aside>
    </div>
  )
}
