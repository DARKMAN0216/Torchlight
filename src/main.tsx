import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { initializeUserData } from './storage/userData'

const root = createRoot(document.getElementById('root')!)
root.render(<p role="status">正在加载保存的数据…</p>)
initializeUserData().then(() => root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)).catch(error => root.render(<main style={{ padding: 24 }}>
  <h1>数据保护：已暂停启动</h1>
  <p role="alert">{String(error)}</p>
  <p>保存数据无法可靠读取，未用默认局面覆盖。请保留数据目录和备份，修复后重新启动客户端。</p>
  <button onClick={() => location.reload()}>重新读取</button>
</main>))
