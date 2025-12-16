import { useState } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Library from './views/Library'
import People from './views/People'
import PersonDetail from './views/PersonDetail'
import Settings from './views/Settings'
import Locations from './views/Locations'
import Queues from './views/Queues'
import Create from './views/Create'
import LoadingScreen from './components/LoadingScreen'
import StatusBar from './components/StatusBar'

function App() {
  const [isReady, setIsReady] = useState(false)

  if (!isReady) {
    return <LoadingScreen onReady={() => setIsReady(true)} />
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Library />} />
          <Route path="people" element={<People />} />
          <Route path="people/:personId" element={<PersonDetail />} />
          <Route path="create" element={<Create />} />
          <Route path="locations" element={<Locations />} />
          <Route path="queues" element={<Queues />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
      <StatusBar />
    </HashRouter>
  )
}

export default App
