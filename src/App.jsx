import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage.jsx'
import CustomerIdentification from './pages/CustomerIdentification.jsx'
import MenuPage from './pages/MenuPage.jsx'
import AdminSetup from './pages/admin/Setup.jsx'
import { CozinhaArea, GarcomArea, GerenteArea } from './pages/staff/Areas.jsx'

// Quatro áreas separadas, todas conversando com a mesma API:
//   Cliente  → só pelo QR Code da mesa (/m/:token → /cardapio)
//   Salão    → /salao   (garçons)
//   Cozinha  → /cozinha  (cozinha)
//   Gerência → /gerencia  (gerente/administrador; vê todas as áreas)
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/m/:token" element={<CustomerIdentification />} />
        <Route path="/cardapio" element={<MenuPage />} />
        <Route path="/salao/*" element={<GarcomArea />} />
        <Route path="/cozinha/*" element={<CozinhaArea />} />
        <Route path="/gerencia/*" element={<GerenteArea />} />
        <Route path="/setup" element={<AdminSetup />} />
        {/* endereços antigos */}
        <Route path="/admin/*" element={<Navigate to="/gerencia" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
