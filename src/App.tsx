import { HashRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Library from './views/Library'
import People from './views/People'
import PersonDetail from './views/PersonDetail'
import Settings from './views/Settings'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Library />} />
          <Route path="people" element={<People />} />
          <Route path="people/:personId" element={<PersonDetail />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
