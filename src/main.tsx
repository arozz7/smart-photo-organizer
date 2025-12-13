import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ScanProvider } from './context/ScanContext'
import { AIProvider } from './context/AIContext'
import { PeopleProvider } from './context/PeopleContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AIProvider>
      <ScanProvider>
        <PeopleProvider>
          <App />
        </PeopleProvider>
      </ScanProvider>
    </AIProvider>
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
