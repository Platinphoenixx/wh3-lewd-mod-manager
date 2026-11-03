import { Component, Fragment, type ReactNode } from 'react'

/**
 * Keeps an error on one page from blanking the whole window: the tabs stay usable and the page says what broke
 * (a catalog entry the page did not expect, say). Remounted with each tab, so switching tabs starts fresh.
 */
export class PageGuard extends Component<{ children: ReactNode; onReset: () => void }, { error: Error | null; round: number }> {
  state = { error: null as Error | null, round: 0 }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state
    // A new round remounts the page, so it starts from its first screen instead of the one that broke.
    if (!error) return <Fragment key={this.state.round}>{this.props.children}</Fragment>
    return (
      <section className="page-error">
        <h2>This page ran into a problem</h2>
        <p className="muted">The other tabs still work. Updating the app or the catalog usually fixes it; if it keeps
          happening, please report it with the text below.</p>
        <pre className="small">{error.message}</pre>
        <button onClick={() => { this.setState({ error: null, round: this.state.round + 1 }); this.props.onReset() }}>Back to the start</button>
      </section>
    )
  }
}
