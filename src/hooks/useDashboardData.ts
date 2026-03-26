import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface DashboardData {
  vehicles: any[];
  cadastros: any[];
  motoristas: any[];
  events: any[];
  positions: any[];
  overrides: any[];
  telemetry: any[];
  resumo?: any[];
  syncedAt: string;
}

export function useDashboardData(daysWindow: number = 2) {
  return useQuery({
    queryKey: ["dashboard-data", daysWindow],
    queryFn: async (): Promise<DashboardData> => {
      console.log(`[API] Buscando dados consolidados do dashboard (${daysWindow} dias)...`);
      
      const { data, error } = await supabase.functions.invoke(`dashboard-api?days=${daysWindow}`, {
        method: "GET"
      });

      if (error) {
        console.error("[API] Erro ao invocar dashboard-api:", error);
        // If the error has a context or response, try to extract the message
        const responseError = (error as any)?.context || error;
        throw responseError;
      }

      return data as DashboardData;
    },
    staleTime: 30 * 1000, // 30 segundos
    gcTime: 5 * 60 * 1000, // 5 minutos
    retry: 2,
    refetchOnWindowFocus: false, // Evita refetch ao alternar entre abas do navegador
  });
}
