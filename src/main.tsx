import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ScanProvider } from './context/ScanContext'
import { AIProvider } from './context/AIContext'
import { PeopleProvider } from './context/PeopleContext'
import { AlertProvider } from './context/AlertContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AlertProvider>
      <AIProvider>
        <ScanProvider>
          <PeopleProvider>
            <App />
          </PeopleProvider>
        </ScanProvider>
      </AIProvider>
    </AlertProvider>
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
