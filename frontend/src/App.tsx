import Navigation from './components/Navigation'

function App() {
  return (
    <div
      className="flex min-h-screen"
      style={{ backgroundColor: 'var(--app-bg)', color: 'var(--app-text)' }}
    >
      <Navigation />

      <main className="flex-1 px-8 py-8">
      </main>
    </div>
  )
}

export default App
