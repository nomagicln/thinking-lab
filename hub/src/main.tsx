import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../shared/styles/lab.css'
import Hub from './Hub'

const host = document.getElementById('root')
if (!host) throw new Error('找不到 #root 挂载点')

createRoot(host).render(
  <StrictMode>
    <Hub />
  </StrictMode>
)
