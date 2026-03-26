-- Tabela de Resumo para Alta Performance do Dashboard
CREATE TABLE IF NOT EXISTS dashboard_resumo (
    vehicle_code INTEGER PRIMARY KEY,
    motorista_nome TEXT,
    gestor_nome TEXT,
    status_atual TEXT DEFAULT 'Desconhecido',
    ultima_posicao_texto TEXT,
    total_jornada_hoje TEXT DEFAULT '00:00',
    alertas_count INTEGER DEFAULT 0,
    data_referencia DATE DEFAULT CURRENT_DATE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para garantir velocidade
CREATE INDEX IF NOT EXISTS idx_dashboard_resumo_gestor ON dashboard_resumo(gestor_nome);
CREATE INDEX IF NOT EXISTS idx_dashboard_resumo_status ON dashboard_resumo(status_atual);

COMMENT ON TABLE dashboard_resumo IS 'Armazena o estado pré-calculado de cada motorista/veículo para evitar processamento pesado na dashboard-api.';
