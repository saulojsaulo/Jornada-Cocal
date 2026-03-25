import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileBarChart, ClipboardList } from "lucide-react";
import { Truck, Calendar, CarFront, Users, Shield, RefreshCw, CloudDownload, LogOut, UserCog, FolderOpen, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo-header.png";
import { JourneyProvider, useJourneyStore } from "@/context/JourneyContext";
import XlsxImporter from "@/components/XlsxImporter";
import ControleTab from "@/components/ControleTab";
import RankingTab from "@/components/RankingTab";
import CadastroVeiculoTab from "@/components/CadastroVeiculoTab";
import CadastroMotoristaTab from "@/components/CadastroMotoristaTab";
import CadastroGestorTab from "@/components/CadastroGestorTab";
import RelatoriosTab from "@/components/RelatoriosTab";
import UsuariosTab from "@/components/UsuariosTab";
import MovimentoCondutorTab from "@/components/MovimentoCondutorTab";
import { TabType } from "@/types/journey";

type MainTab = "controle" | "cadastros" | "relatorios" | "movimento";
type CadastroSubTab = "cadastro_veiculo" | "cadastro_motorista" | "cadastro_gestor" | "usuarios";
type RelatorioSubTab = "ficha_ponto" | "filtro_motorista" | "ranking";

function JourneyDashboard() {
  const [activeTab, setActiveTab] = useState<MainTab>("controle");
  const [cadastroSub, setCadastroSub] = useState<CadastroSubTab>("cadastro_veiculo");
  const [relatorioSub, setRelatorioSub] = useState<RelatorioSubTab>("ficha_ponto");
  const [isAdmin, setIsAdmin] = useState(false);
  const { selectedDate, setSelectedDate, vehicles, isLoading, isSyncing, refreshData, lastSyncAt, syncFromAutotrac, error } = useJourneyStore();
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsAdmin(user?.email === "saulosantosj@gmail.com");
    });
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  const mainTabs: { id: MainTab; label: string; icon: typeof Truck }[] = [
    { id: "controle", label: "Controle", icon: Truck },
    { id: "movimento", label: "Movimento do Condutor", icon: ClipboardList },
    { id: "cadastros", label: "Cadastros", icon: FolderOpen },
    { id: "relatorios", label: "Relatórios", icon: FileBarChart },
  ];

  const cadastroSubTabs: { id: CadastroSubTab; label: string; icon: typeof CarFront; adminOnly?: boolean }[] = [
    { id: "cadastro_veiculo", label: "Veículos", icon: CarFront },
    { id: "cadastro_motorista", label: "Motoristas", icon: Users },
    { id: "cadastro_gestor", label: "Gestores", icon: Shield },
    { id: "usuarios", label: "Usuários", icon: UserCog, adminOnly: true },
  ];

  const visibleCadastroSubs = cadastroSubTabs.filter(s => !s.adminOnly || isAdmin);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40" style={{ background: "hsl(var(--header-bg))", color: "hsl(var(--header-fg))" }}>
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <img src={logo} alt="Jornada de Motorista" className="h-8" />
              <span className="text-xs opacity-60 hidden sm:inline">
                {isLoading ? "Carregando..." : `${vehicles.length} veículo(s)`}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {activeTab === "controle" && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 opacity-50" />
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="border border-white/20 rounded px-2 py-1 text-xs bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              )}
              <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded bg-green-500/10 text-green-500 border border-green-500/20 mr-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Live</span>
              </div>
              <button
                onClick={syncFromAutotrac}
                disabled={isSyncing}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded bg-primary/90 text-primary-foreground hover:bg-primary transition-colors disabled:opacity-50"
                title="Sincronizar dados da API Autotrac"
              >
                <CloudDownload className={`h-3.5 w-3.5 ${isSyncing ? "animate-pulse" : ""}`} />
                <span className="hidden sm:inline">Autotrac</span>
              </button>
              <button
                onClick={refreshData}
                disabled={isSyncing}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
                title={lastSyncAt ? `Última sync: ${lastSyncAt.toLocaleTimeString("pt-BR")}` : "Recarregar dados locais"}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
              <XlsxImporter />
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded bg-white/10 hover:bg-destructive/80 hover:text-white transition-colors"
                title="Sair do sistema"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          </div>

          {/* Main Tabs integrated into header */}
          <nav className="flex gap-0.5 -mb-px">
            {mainTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-primary text-white"
                    : "border-transparent text-white/50 hover:text-white/80 hover:border-white/20"
                }`}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Cadastros Sub-tabs */}
      {activeTab === "cadastros" && (
        <div className="border-b bg-card">
          <div className="container mx-auto px-4">
            <nav className="flex gap-0.5">
              {visibleCadastroSubs.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setCadastroSub(sub.id)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                    cadastroSub === sub.id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  <sub.icon className="h-3.5 w-3.5" />
                  {sub.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}

      {error && (
        <div className="container mx-auto px-4 pt-3">
          <div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={refreshData}
              className="inline-flex items-center justify-center rounded-md border border-destructive/40 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="container mx-auto px-4 py-4">
        {activeTab === "controle" && <ControleTab />}
        {activeTab === "movimento" && <MovimentoCondutorTab />}
        {activeTab === "cadastros" && cadastroSub === "cadastro_veiculo" && <CadastroVeiculoTab />}
        {activeTab === "cadastros" && cadastroSub === "cadastro_motorista" && <CadastroMotoristaTab />}
        {activeTab === "cadastros" && cadastroSub === "cadastro_gestor" && <CadastroGestorTab />}
        {activeTab === "cadastros" && cadastroSub === "usuarios" && <UsuariosTab />}
        {activeTab === "relatorios" && <RelatoriosTab />}
      </main>
    </div>
  );
}

export default function Index() {
  return (
    <JourneyProvider>
      <JourneyDashboard />
    </JourneyProvider>
  );
}
