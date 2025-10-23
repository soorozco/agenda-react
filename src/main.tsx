import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'   // <- este import es CLAVE
// (si tienes index.css, también se puede importar aquí)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

