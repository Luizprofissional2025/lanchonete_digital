import './HomePage.css'

function HomePage() {
  return (
    <div className="home-page">
      <header className="home-header">
        <div className="container">
          <h1 className="logo">SABOR DIGITAL</h1>
          <p className="tagline">Cardápio digital por QR Code e gestão de restaurante</p>
        </div>
      </header>
      <main className="home-main">
        <div className="container">
          <div className="hero">
            <h2>Escaneie o QR Code da sua mesa para pedir</h2>
            <p>Use a câmera do celular no QR Code que está na sua mesa.</p>
          </div>
          <div className="features">
            <div className="feature-card"><h3>📱 Cardápio digital</h3><p>Acesso pelo QR Code da mesa</p></div>
            <div className="feature-card"><h3>🛒 Pedidos</h3><p>Direto do celular, com acompanhamento</p></div>
            <div className="feature-card"><h3>👨‍🍳 Cozinha</h3><p>Fila com tempos de espera</p></div>
            <div className="feature-card"><h3>💰 Contas e vendas</h3><p>Fechamento por cliente e relatórios</p></div>
          </div>
        </div>
      </main>
      <footer className="home-footer"><div className="container"><p>&copy; Sabor Digital</p></div></footer>
    </div>
  )
}

export default HomePage
