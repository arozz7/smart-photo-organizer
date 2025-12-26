import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ScanProvider } from './context/ScanContext'
import { AIProvider } from './context/AIContext'
import { PeopleProvider } from './context/PeopleContext'
import { AlertProvider } from './context/AlertContext'
import { ToastProvider } from './context/ToastContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <AlertProvider>
        <AIProvider>
          <ScanProvider>
            <PeopleProvider>
              <App />
            </PeopleProvider>
          </ScanProvider>
        </AIProvider>
      </AlertProvider>
    </ToastProvider>
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
