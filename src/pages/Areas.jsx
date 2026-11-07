import AreaShell from './AreaShell.jsx'
import { AccountsPage, AlertsPage, KitchenPage, OrdersPage, Overview, TablesPage } from '../admin/OperationPages.jsx'
import { CustomersPage, MenuAdminPage, QrPage } from '../admin/CatalogPages.jsx'
import { SettingsPage, TeamPage, WaitersReportPage } from '../admin/TeamPages.jsx'
import SalesPage from '../admin/SalesPage.jsx'

// 2) Salão e caixa: endereço /salao — garçons (e gerência).
const GARCOM = {
  key: 'salao', base: '/salao', title: 'Salão e caixa', subtitle: 'Acesso dos garçons',
  roles: ['waiter', 'manager', 'admin'], alerts: true, sound: true,
  nav: [
    { path: 'mesas', label: '🪑 Salão', render: (p) => <TablesPage {...p} /> },
    { path: 'pedidos', label: '🧾 Pedidos', render: (p) => <OrdersPage {...p} /> },
    { path: 'alertas', label: '🔔 Chamados', badge: true, render: (p) => <AlertsPage {...p} /> },
    { path: 'contas', label: '💳 Contas', render: (p) => <AccountsPage {...p} /> },
  ],
  links: [{ to: '/gerencia', label: '🛠️ Ir para a Gerência', roles: ['manager', 'admin'] }, { to: '/cozinha', label: '👨‍🍳 Ir para a Cozinha', roles: ['manager', 'admin'] }],
}

// 3) Cozinha: endereço /cozinha — só o painel de pedidos, em tela cheia para o tablet.
const COZINHA = {
  key: 'cozinha', base: '/cozinha', title: 'Cozinha', subtitle: 'Acesso da cozinha',
  roles: ['kitchen', 'manager', 'admin'], sound: true, bare: true,
  nav: [{ path: 'pedidos', label: '👨‍🍳 Pedidos da cozinha', render: (p) => <KitchenPage {...p} /> }],
  links: [{ to: '/gerencia', label: '🛠️ Ir para a Gerência', roles: ['manager', 'admin'] }, { to: '/salao', label: '🍽️ Ir para o Salão', roles: ['manager', 'admin'] }],
}

// 4) Gerência: endereço /gerencia — cardápio, QR Codes, equipe, vendas, configurações + atalhos para as outras áreas.
const GERENTE = {
  key: 'gerencia', base: '/gerencia', title: 'Gerência', subtitle: 'Acesso da gerência do restaurante',
  roles: ['manager', 'admin'],
  nav: [
    { path: 'dashboard', label: '📊 Visão geral', render: (p) => <Overview {...p} /> },
    { path: 'vendas', label: '📈 Vendas', render: (p) => <SalesPage {...p} /> },
    { path: 'garcons', label: '🧑‍🍳 Taxa por garçom', render: (p) => <WaitersReportPage {...p} /> },
    { path: 'cardapio', label: '🍔 Cardápio', render: (p) => <MenuAdminPage {...p} /> },
    { path: 'qrcodes', label: '📱 QR Codes das mesas', render: (p) => <QrPage {...p} /> },
    { path: 'clientes', label: '👥 Clientes', render: (p) => <CustomersPage {...p} /> },
    { path: 'equipe', label: '🪪 Equipe', render: (p) => <TeamPage {...p} /> },
    { path: 'config', label: '⚙️ Configurações', render: (p) => <SettingsPage {...p} /> },
  ],
  links: [{ to: '/salao', label: '🍽️ Abrir Salão e caixa' }, { to: '/cozinha', label: '👨‍🍳 Abrir Cozinha' }],
}

export const GarcomArea = () => <AreaShell area={GARCOM} />
export const CozinhaArea = () => <AreaShell area={COZINHA} />
export const GerenteArea = () => <AreaShell area={GERENTE} />
